"""Sous-titres : format des messages, suivi d'une phrase, garde-fous silence / écho."""

from __future__ import annotations

import json
import re
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .prompts import SILENT_MARK, base_lang

ECHO_WINDOW_S = 20.0
ECHO_RATIO = 0.8
ECHO_MIN_CHARS = 12


def caption_message(
    *, speaker: str, lang_src: str, text_src: str, lang_dst: str, text_dst: str, final: bool, seq: int
) -> dict:
    if speaker not in ("host", "guest"):
        raise ValueError(f"invalid speaker {speaker!r}")
    if not isinstance(seq, int) or seq < 0:
        raise ValueError("seq must be a non-negative int")
    return {
        "speaker": speaker,
        "lang_src": lang_src,
        "text_src": text_src,
        "lang_dst": lang_dst,
        "text_dst": text_dst,
        "final": bool(final),
        "seq": seq,
    }


def encode(msg: dict) -> bytes:
    return json.dumps(msg, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def is_silent(text: str) -> bool:
    """Réponse « rien à traduire » : le marqueur seul, ou ponctuation seule."""
    t = (text or "").strip()
    if not t:
        return False
    if t.startswith(SILENT_MARK):
        return True
    return all(unicodedata.category(c)[0] in "PZS" for c in t)


def visible(text: str) -> bool:
    return any(unicodedata.category(c)[0] in "LN" for c in text or "")


_WORD_RE = re.compile(r"[^\w\s]", re.UNICODE)


def words_of(text: str) -> set[str]:
    t = (text or "").lower().replace("’", "").replace("'", "")
    t = _WORD_RE.sub(" ", t)
    return {w for w in t.split() if w}


class EchoGuard:
    """Détecte qu'une session re-traduit la voix traduite captée par le micro de l'autre.

    Si l'invité entend « tr-for-guest » sur son haut-parleur et que son micro le capte,
    la session de l'invité le retraduit vers la langue de l'hôte : le résultat ressemble
    alors au texte original que l'hôte vient de dire. On compare donc la sortie d'une
    session aux phrases source récentes de l'AUTRE locuteur.
    """

    def __init__(self, window_s: float = ECHO_WINDOW_S, ratio: float = ECHO_RATIO, clock=time.monotonic):
        self._recent: list[tuple[float, set[str]]] = []
        self._window = window_s
        self._ratio = ratio
        self._clock = clock

    def remember(self, text: str) -> None:
        w = words_of(text)
        if len(w) >= 2:
            self._recent.append((self._clock(), w))
            self._recent = self._recent[-6:]

    def is_echo(self, text: str) -> bool:
        if len(text or "") < ECHO_MIN_CHARS:
            return False
        w = words_of(text)
        if len(w) < 2:
            return False
        now = self._clock()
        for t, ref in self._recent:
            if now - t > self._window:
                continue
            if len(w & ref) / len(w) >= self._ratio:
                return True
        return False


# Détection de langue très légère (face-à-face : qui a parlé ?)
_STOPWORDS = {
    "fr": {"le", "la", "les", "de", "des", "et", "est", "je", "vous", "nous", "pas", "un", "une", "que", "qui", "pour", "avec", "ce", "il", "elle", "oui", "bonjour", "merci", "du", "au", "sur", "mais"},
    "en": {"the", "and", "is", "you", "we", "not", "a", "an", "that", "for", "with", "this", "it", "yes", "hello", "thanks", "of", "to", "are", "i", "do", "what", "can", "but"},
    "es": {"el", "la", "los", "las", "de", "y", "es", "yo", "usted", "no", "un", "una", "que", "para", "con", "esto", "sí", "hola", "gracias", "por", "pero", "muy"},
    "pt": {"o", "a", "os", "as", "de", "e", "é", "eu", "você", "não", "um", "uma", "que", "para", "com", "isso", "sim", "olá", "obrigado", "obrigada", "mas", "muito"},
    "de": {"der", "die", "das", "und", "ist", "ich", "sie", "wir", "nicht", "ein", "eine", "dass", "für", "mit", "ja", "hallo", "danke", "aber"},
    "it": {"il", "lo", "la", "gli", "di", "e", "è", "io", "lei", "non", "un", "una", "che", "per", "con", "sì", "ciao", "grazie", "ma"},
    "nl": {"de", "het", "een", "en", "is", "ik", "u", "wij", "niet", "dat", "voor", "met", "ja", "hallo", "bedankt", "maar"},
    "tr": {"ve", "bir", "bu", "ben", "siz", "biz", "değil", "için", "ile", "evet", "merhaba", "teşekkürler", "ama"},
    "wo": {"ak", "ci", "dafa", "dama", "nga", "naka", "jërëjëf", "waaw", "deedeet", "yaangi", "mangi", "def", "lan"},
}
_SCRIPTS = {"ar": ("ARABIC",), "zh": ("CJK",), "ja": ("HIRAGANA", "KATAKANA"), "ko": ("HANGUL",), "ru": ("CYRILLIC",), "uk": ("CYRILLIC",), "hi": ("DEVANAGARI",)}


def guess_lang(text: str, candidates: list[str]) -> str | None:
    """Choisit parmi `candidates` la langue la plus probable de `text` (None si indécis)."""
    cands = [base_lang(c) for c in candidates]
    letters = [c for c in text or "" if unicodedata.category(c)[0] == "L"]
    if not letters:
        return None
    for lang in cands:
        prefixes = _SCRIPTS.get(lang)
        if prefixes:
            n = sum(1 for c in letters if unicodedata.name(c, "").startswith(prefixes))
            if n / len(letters) > 0.5:
                return lang
    w = words_of(text)
    scores = {lang: len(w & _STOPWORDS.get(lang, set())) for lang in cands}
    best = max(scores.values()) if scores else 0
    if best == 0:
        # écriture latine sans indice : si une seule candidate est latine, c'est elle
        latin = [l for l in cands if l not in _SCRIPTS]
        return latin[0] if len(latin) == 1 else None
    winners = [l for l, s in scores.items() if s == best]
    return winners[0] if len(winners) == 1 else None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Utterance:
    """Une phrase d'un locuteur : texte source (transcription) + traduction (sortie)."""

    seq: int
    speaker: str
    lang_src: str
    lang_dst: str
    started_at: str = field(default_factory=utc_now_iso)
    item_id: str | None = None
    response_id: str | None = None
    text_src: str = ""
    text_dst: str = ""
    src_final: bool = False
    dst_final: bool = False
    suppressed: bool = False
    published_final: bool = False
    ended_at: str | None = None
    _last_partial: float = 0.0

    @property
    def complete(self) -> bool:
        return self.src_final and self.dst_final

    def caption(self, final: bool) -> dict:
        return caption_message(
            speaker=self.speaker, lang_src=self.lang_src, text_src=self.text_src.strip(),
            lang_dst=self.lang_dst, text_dst="" if self.suppressed else self.text_dst.strip(),
            final=final, seq=self.seq,
        )

    def should_send_partial(self, now: float, min_interval: float = 0.15) -> bool:
        if now - self._last_partial >= min_interval:
            self._last_partial = now
            return True
        return False

    def persistable(self) -> bool:
        return (
            not self.suppressed
            and visible(self.text_src)
            and visible(self.text_dst)
            and not is_silent(self.text_dst)
        )

    def to_row(self, room_id: str, host_id: str) -> dict:
        return {
            "room_id": room_id,
            "host_id": host_id,
            "speaker": self.speaker,
            "lang_src": self.lang_src,
            "text_src": self.text_src.strip(),
            "lang_dst": self.lang_dst,
            "text_dst": self.text_dst.strip(),
            "started_at": self.started_at,
            "ended_at": self.ended_at or utc_now_iso(),
            "seq": self.seq,
        }


class SeqCounter:
    """Numéro de phrase partagé par les deux sessions, strictement croissant."""

    def __init__(self, start: int = 0):
        self._next = start

    def reset_floor(self, floor: int) -> None:
        self._next = max(self._next, floor)

    def next(self) -> int:
        v = self._next
        self._next += 1
        return v
