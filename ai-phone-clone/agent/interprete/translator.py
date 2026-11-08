"""Une session OpenAI Realtime qui écoute UN participant et publie sa traduction sur UNE piste.

Pourquoi pas AgentSession : AgentSession gère un seul « utilisateur » et une seule sortie
audio, écrit l'état de l'agent dans les attributs du participant local et conserve tout
l'historique de conversation. Deux AgentSession dans la même salle se marcheraient dessus
(attributs, transcriptions lk.transcription, interruptions). On utilise donc directement
la session Realtime du plugin OpenAI (reconnexion, rééchantillonnage, flux audio gérés par
le plugin) branchée à la main sur les API rtc : AudioStream sur la piste micro d'un seul
participant en entrée, AudioSource + LocalAudioTrack nommée en sortie.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections import deque
from dataclasses import replace
from collections.abc import Awaitable, Callable
from typing import Any

from livekit import rtc
from livekit.agents import llm
from livekit.plugins.openai import realtime as oai_realtime
from openai.types.realtime import AudioTranscription, RealtimeReasoning
from openai.types.realtime.realtime_audio_input_turn_detection import ServerVad

from .billing import ActivityTracker
from .captions import EchoGuard, SeqCounter, Utterance, guess_lang, is_silent, utc_now_iso, visible
from .config import Settings
from .prompts import (
    announcement_instructions,
    build_face_instructions,
    build_instructions,
    build_transcription,
    engine_voice,
)

log = logging.getLogger("interprete.translator")

SAMPLE_RATE = 24000
NUM_CHANNELS = 1
UNDECIDED_MAX_BUFFER_S = 1.0     # audio retenu tant que la transcription de sortie n'a rien dit
SRC_WAIT_AFTER_DONE_S = 4.0      # attente de la transcription source après la fin de la réponse
RESPONSE_WAIT_AFTER_SRC_S = 10.0 # attente d'une réponse après une transcription source finale
BENIGN_ERRORS = ("response_cancel_not_active", "input_audio_buffer_commit_empty", "item_delete_invalid_item_id")


def realtime_model_kwargs(
    settings: Settings,
    *,
    model: str,
    voice: str,
    src_lang: str | None,
    languages: list[str] | None,
    text_only: bool,
) -> dict[str, Any]:
    """Options du RealtimeModel (pur, testé)."""
    kwargs: dict[str, Any] = dict(
        model=model,
        voice=engine_voice(voice, settings.default_voice),
        modalities=["text"] if text_only else ["audio"],
        input_audio_transcription=AudioTranscription(
            **build_transcription(settings.transcribe_model, src_lang, languages)
        ),
        input_audio_noise_reduction="near_field",
        turn_detection=ServerVad(
            type="server_vad",
            threshold=settings.vad_threshold,
            prefix_padding_ms=settings.vad_prefix_ms,
            silence_duration_ms=settings.vad_silence_ms,
            create_response=True,
            interrupt_response=False,  # ne jamais couper une traduction en cours
        ),
        api_key=settings.openai_api_key or None,
    )
    if settings.reasoning_effort and model.startswith("gpt-realtime-2"):
        kwargs["reasoning"] = RealtimeReasoning(effort=settings.reasoning_effort)  # type: ignore[arg-type]
    return kwargs


class Translator:
    def __init__(
        self,
        *,
        room: rtc.Room,
        settings: Settings,
        speaker: str,                    # identité écoutée : "host" ou "guest"
        out_track: str,                  # "tr-for-guest" / "tr-for-host"
        src_lang: str,
        dst_lang: str,
        voice: str,
        seq: SeqCounter,
        activity: ActivityTracker,
        own_src: EchoGuard,
        peer_src: EchoGuard,
        on_caption: Callable[[dict], Awaitable[None]],
        on_final: Callable[[Utterance], None],
        on_fatal: Callable[[str], None],
        is_listening: Callable[[], bool] = lambda: True,
        face: bool = False,
    ):
        self.room = room
        self.settings = settings
        self.speaker = speaker
        self.out_track_name = out_track
        self.src_lang = src_lang
        self.dst_lang = dst_lang
        self.voice = voice
        self.face = face
        self.text_only = dst_lang.split("-")[0] in settings.captions_only_langs and not face
        self._seq = seq
        self._activity = activity
        self._own_src = own_src
        self._peer_src = peer_src
        self._on_caption = on_caption
        self._on_final = on_final
        self._on_fatal = on_fatal
        self._is_listening = is_listening
        self.face_hint: str | None = None

        self.model_name = settings.realtime_model
        self._fell_back = False
        self._model: oai_realtime.RealtimeModel | None = None
        self._session: oai_realtime.RealtimeSession | None = None
        self._source: rtc.AudioSource | None = None
        self._track_pub: rtc.LocalTrackPublication | None = None
        self._input_task: asyncio.Task | None = None
        self._input_track_sid: str | None = None
        self._player_task: asyncio.Task | None = None
        self._gen_q: asyncio.Queue[llm.GenerationCreatedEvent] = asyncio.Queue()
        self._tasks: set[asyncio.Task] = set()

        self._by_item: dict[str, Utterance] = {}
        self._by_resp: dict[str, Utterance] = {}
        self._await_resp: deque[Utterance] = deque()
        self._announce_ids: set[str] = set()
        self._done_resp: set[str] = set()
        self._suppressed_resp: set[str] = set()
        self._context_items: deque[str] = deque()
        self._closed = False

    # ------------------------------------------------------------------ cycle de vie
    async def start(self) -> None:
        self._source = rtc.AudioSource(SAMPLE_RATE, NUM_CHANNELS, queue_size_ms=1000)
        track = rtc.LocalAudioTrack.create_audio_track(self.out_track_name, self._source)
        opts = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        self._track_pub = await self.room.local_participant.publish_track(track, opts)
        await self._open_session()
        self._player_task = asyncio.create_task(self._player(), name=f"player-{self.out_track_name}")
        log.info("translator %s -> %s ready (%s, model=%s)", self.speaker, self.out_track_name,
                 "face" if self.face else f"{self.src_lang}->{self.dst_lang}", self.model_name)

    async def _open_session(self) -> None:
        self._model = oai_realtime.RealtimeModel(
            **realtime_model_kwargs(
                self.settings,
                model=self.model_name,
                voice=self.voice,
                src_lang=None if self.face else self.src_lang,
                languages=[self.src_lang, self.dst_lang],
                text_only=self.text_only,
            )
        )
        self._session = self._model.session()
        s = self._session
        s.on("openai_server_event_received", self._on_raw)
        s.on("generation_created", self._on_generation)
        s.on("error", self._on_error)
        instructions = (
            build_face_instructions(self.src_lang, self.dst_lang) if self.face
            else build_instructions(self.src_lang, self.dst_lang)
        )
        await s.update_instructions(instructions)

    async def _close_session(self) -> None:
        s, m = self._session, self._model
        self._session = self._model = None
        if s:
            with contextlib.suppress(Exception):
                await s.aclose()
        if m:
            with contextlib.suppress(Exception):
                await m.aclose()

    async def aclose(self) -> None:
        if self._closed:
            return
        # phrases en cours : on garde ce qui a déjà été dit (transcription + résumé)
        pending = {id(u): u for u in [*self._by_item.values(), *self._by_resp.values()]}
        for u in pending.values():
            with contextlib.suppress(Exception):
                self._maybe_finalize(u, force=True)
        self._closed = True
        for t in [self._input_task, self._player_task, *self._tasks]:
            if t:
                t.cancel()
        await self._close_session()
        if self._track_pub:
            with contextlib.suppress(Exception):
                await self.room.local_participant.unpublish_track(self._track_pub.sid)
        if self._source:
            with contextlib.suppress(Exception):
                await self._source.aclose()

    # ------------------------------------------------------------------ entrée audio
    def attach_track(self, track: rtc.Track) -> None:
        """Branche la piste micro du participant écouté (et seulement celle-là)."""
        if track.sid == self._input_track_sid and self._input_task and not self._input_task.done():
            return
        if self._input_task:
            self._input_task.cancel()
        self._input_track_sid = track.sid
        self._input_task = asyncio.create_task(self._pump_input(track), name=f"input-{self.speaker}")

    def detach_track(self, track_sid: str) -> None:
        if track_sid == self._input_track_sid and self._input_task:
            self._input_task.cancel()
            self._input_task = None
            self._input_track_sid = None

    async def _pump_input(self, track: rtc.Track) -> None:
        stream = rtc.AudioStream.from_track(track=track, sample_rate=SAMPLE_RATE, num_channels=NUM_CHANNELS)
        try:
            async for ev in stream:
                if self._closed:
                    break
                if self._session is not None and self._is_listening():
                    self._session.push_audio(ev.frame)
        finally:
            with contextlib.suppress(Exception):
                await stream.aclose()

    # ------------------------------------------------------------------ événements OpenAI
    def _spawn(self, coro) -> None:
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    def _new_utterance(self) -> Utterance:
        u = Utterance(seq=self._seq.next(), speaker=self.speaker, lang_src=self.src_lang, lang_dst=self.dst_lang)
        if self.face and self.face_hint in ("host", "guest"):
            # le client dit à qui c'est le tour (topic face_turn) : on s'y tient
            self._set_face_speaker(u, self.face_hint)
            u.speaker_locked = True
        return u

    def _set_face_speaker(self, u: Utterance, who: str) -> None:
        a, b = self.src_lang, self.dst_lang          # a = langue hôte, b = langue invité
        if who == "guest":
            u.speaker, u.lang_src, u.lang_dst = "guest", b, a
        else:
            u.speaker, u.lang_src, u.lang_dst = "host", a, b

    def _on_raw(self, ev: dict) -> None:
        try:
            self._handle_raw(ev)
        except Exception:
            log.exception("error handling realtime event %s", ev.get("type"))

    def _handle_raw(self, ev: dict) -> None:
        t = ev.get("type", "")
        if t == "input_audio_buffer.speech_started":
            self._activity.speech_started(self.speaker)
        elif t == "input_audio_buffer.speech_stopped":
            self._activity.speech_stopped(self.speaker)
        elif t == "input_audio_buffer.committed":
            item_id = ev.get("item_id")
            if item_id and item_id not in self._by_item:
                u = self._new_utterance()
                u.item_id = item_id
                self._by_item[item_id] = u
                self._await_resp.append(u)
        elif t in ("conversation.item.added", "conversation.item.created"):
            item = ev.get("item") or {}
            if item.get("id") and item["id"] not in self._context_items:
                self._context_items.append(item["id"])
                self._prune_context()
        elif t == "conversation.item.deleted":
            with contextlib.suppress(ValueError):
                self._context_items.remove(ev.get("item_id"))
        elif t == "conversation.item.input_audio_transcription.delta":
            u = self._by_item.get(ev.get("item_id", ""))
            if u and not u.src_final:
                u.text_src += ev.get("delta") or ""
                self._partial(u)
        elif t == "conversation.item.input_audio_transcription.completed":
            u = self._by_item.get(ev.get("item_id", ""))
            if u:
                u.text_src = (ev.get("transcript") or u.text_src or "").strip()
                u.src_final = True
                if self.face:
                    self._resolve_face_langs(u)
                if not self.face:  # face-à-face : mémorisé à la fin, pour ne pas se comparer à soi-même
                    self._own_src.remember(u.text_src)
                self._maybe_finalize(u)
                if not u.dst_final:
                    self._spawn(self._finalize_later(u, RESPONSE_WAIT_AFTER_SRC_S))
        elif t == "conversation.item.input_audio_transcription.failed":
            u = self._by_item.get(ev.get("item_id", ""))
            if u:
                u.src_final = True
                self._maybe_finalize(u)
        elif t == "response.created":
            resp = ev.get("response") or {}
            rid = resp.get("id")
            md = resp.get("metadata") or {}
            if not rid:
                return
            if isinstance(md, dict) and md.get("kind") == "announce":
                self._announce_ids.add(rid)
                return
            u = None
            while self._await_resp:
                cand = self._await_resp.popleft()
                if not cand.dst_final and not cand.published_final:
                    u = cand
                    break
            if u is None:
                u = self._new_utterance()
                u.src_final = True  # réponse sans segment audio connu
            u.response_id = rid
            self._by_resp[rid] = u
        elif t in ("response.output_audio_transcript.delta", "response.output_text.delta"):
            u = self._by_resp.get(ev.get("response_id", ""))
            if u and not u.suppressed:
                u.text_dst += ev.get("delta") or ""
                self._check_output(u)
                if not u.suppressed and visible(u.text_dst):
                    self._partial(u)
        elif t in ("response.output_audio_transcript.done", "response.output_text.done"):
            u = self._by_resp.get(ev.get("response_id", ""))
            if u and not u.suppressed:
                u.text_dst = (ev.get("transcript") or ev.get("text") or u.text_dst).strip()
                self._check_output(u)
        elif t == "response.done":
            rid = (ev.get("response") or {}).get("id", "")
            self._done_resp.add(rid)
            if rid in self._announce_ids:
                return
            u = self._by_resp.get(rid)
            if u:
                u.dst_final = True
                if self.face and not u.suppressed:
                    self._resolve_face_langs(u)
                self._maybe_finalize(u)
                if not u.src_final:
                    self._spawn(self._finalize_later(u, SRC_WAIT_AFTER_DONE_S))
        elif t == "error":
            err = ev.get("error") or {}
            code = err.get("code") or ""
            if code in BENIGN_ERRORS or "no active response" in (err.get("message") or "").lower():
                return
            log.warning("realtime error [%s] %s: %s", self.speaker, code, err.get("message"))
            msg = (err.get("message") or "").lower()
            param = (err.get("param") or "").lower()
            if "reasoning" in param or ("reasoning" in msg and code in ("unknown_parameter", "invalid_value")):
                # comme traducteur-live : un modèle qui refuse le champ reasoning -> on le retire
                if self.settings.reasoning_effort:
                    self.settings = replace(self.settings, reasoning_effort="")
                    self._spawn(self._restart())
            elif code in ("model_not_found", "invalid_model") or ("model" in msg and "transcri" not in msg
                                                                 and code in ("invalid_value", "not_found")):
                self._on_error(llm.RealtimeModelError(timestamp=time.time(), label="openai", error=RuntimeError(msg),
                                                      recoverable=False))

    def _prune_context(self) -> None:
        while len(self._context_items) > self.settings.max_context_items and self._session:
            old = self._context_items.popleft()
            self._session.send_event({"type": "conversation.item.delete", "item_id": old})

    def _check_output(self, u: Utterance) -> None:
        """« Rien à traduire » ou écho de la voix traduite : jamais prononcé, jamais affiché."""
        text = u.text_dst.strip()
        if is_silent(text) or self._peer_src.is_echo(text):
            u.suppressed = True
            if u.response_id:
                self._suppressed_resp.add(u.response_id)
            if self._session and u.response_id and u.response_id not in self._done_resp:
                self._session.interrupt()
            if self._source:
                self._source.clear_queue()

    def _resolve_face_langs(self, u: Utterance, final: bool = False) -> bool:
        """Face-à-face : qui parle ? Le locuteur est figé dès le premier sous-titre envoyé,
        car le client fusionne les sous-titres par (speaker, seq). Renvoie True si figé."""
        if u.speaker_locked:
            return True
        a, b = self.src_lang, self.dst_lang
        lang = guess_lang(u.text_src, [a, b]) if visible(u.text_src) else None
        if lang is None and visible(u.text_dst):
            out = guess_lang(u.text_dst, [a, b])
            lang = (b.split("-")[0] if out == a.split("-")[0] else a.split("-")[0]) if out else None
        if lang is None and not final:
            return False
        who = "guest" if lang is not None and lang == b.split("-")[0] else "host"
        self._set_face_speaker(u, who)
        u.speaker_locked = True
        return True

    def _partial(self, u: Utterance) -> None:
        if u.published_final or u.suppressed:
            return
        if self.face and not self._resolve_face_langs(u):
            return  # locuteur encore inconnu : pas de sous-titre partiel
        if u.should_send_partial(time.monotonic()):
            self._spawn(self._on_caption(u.caption(final=False)))

    def _maybe_finalize(self, u: Utterance, force: bool = False) -> None:
        if u.published_final or not (u.complete or force):
            return
        if self.face:
            self._resolve_face_langs(u, final=True)
        u.published_final = True
        u.ended_at = utc_now_iso()
        if self.face:
            self._own_src.remember(u.text_src)
        if visible(u.text_src) or (visible(u.text_dst) and not u.suppressed):
            self._spawn(self._on_caption(u.caption(final=True)))
        if u.item_id:
            self._by_item.pop(u.item_id, None)
        if u.response_id:
            self._by_resp.pop(u.response_id, None)
        with contextlib.suppress(ValueError):
            self._await_resp.remove(u)
        self._on_final(u)

    async def _finalize_later(self, u: Utterance, delay: float) -> None:
        await asyncio.sleep(delay)
        self._maybe_finalize(u, force=True)

    def _on_error(self, ev: llm.RealtimeModelError) -> None:
        if ev.recoverable or self._closed:
            return
        log.error("realtime session for %s failed (model=%s): %s", self.speaker, self.model_name, ev.error)
        if not self._fell_back and self.settings.realtime_fallback_model and \
                self.settings.realtime_fallback_model != self.model_name:
            self._fell_back = True
            self.model_name = self.settings.realtime_fallback_model
            self._spawn(self._restart())
        else:
            self._on_fatal(f"realtime session failed for {self.speaker}")

    async def _restart(self) -> None:
        log.warning("switching %s to fallback model %s", self.speaker, self.model_name)
        await self._close_session()
        self._await_resp.clear()
        self._context_items.clear()
        try:
            await self._open_session()
        except Exception:
            log.exception("fallback session failed")
            self._on_fatal(f"fallback session failed for {self.speaker}")

    # ------------------------------------------------------------------ sortie audio
    def _on_generation(self, ev: llm.GenerationCreatedEvent) -> None:
        self._gen_q.put_nowait(ev)

    def _decision(self, rid: str | None) -> bool | None:
        """True = jouer, False = jeter, None = pas encore décidé."""
        if rid is None or rid in self._announce_ids:
            return True
        if rid in self._suppressed_resp:
            return False
        u = self._by_resp.get(rid)
        if u is None:
            return True  # phrase déjà finalisée sans suppression : la fin de l'audio est jouée
        if visible(u.text_dst) and not is_silent(u.text_dst):
            return True
        return None

    async def _player(self) -> None:
        while True:
            gen = await self._gen_q.get()
            rid = gen.response_id
            try:
                async for msg in gen.message_stream:
                    drain = asyncio.create_task(self._drain_text(msg.text_stream))
                    await self._play(rid, msg.audio_stream)
                    await drain
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("audio playback error")

    @staticmethod
    async def _drain_text(stream) -> None:
        async for _ in stream:
            pass

    async def _play(self, rid: str | None, audio) -> None:
        assert self._source is not None
        held: list[rtc.AudioFrame] = []
        held_s = 0.0
        async for frame in audio:
            decision = self._decision(rid)
            if decision is False:
                held = []
                continue  # on vide le flux sans rien jouer
            if decision is None and held_s < UNDECIDED_MAX_BUFFER_S:
                held.append(frame)
                held_s += frame.duration
                continue
            # décidé (ou transcription en retard : on joue quand même)
            for f in held:
                await self._source.capture_frame(f)
            held = []
            await self._source.capture_frame(frame)
        if held and self._decision(rid) is not False:
            u = self._by_resp.get(rid or "")
            if u is None or (visible(u.text_dst) and not is_silent(u.text_dst)):
                for f in held:
                    await self._source.capture_frame(f)

    async def announce(self, text: str, lang: str, wait_s: float = 4.0) -> None:
        """Annonce système (solde) prononcée sur la piste de sortie, hors conversation."""
        if self._session is None or self.text_only:
            return
        deadline = time.monotonic() + wait_s
        while self._session.has_active_generation and time.monotonic() < deadline:
            await asyncio.sleep(0.2)
        self._session.send_event({
            "type": "response.create",
            "response": {
                "conversation": "none",
                "output_modalities": ["audio"],
                "instructions": announcement_instructions(text, lang),
                "metadata": {"kind": "announce"},
                "input": [],
            },
        })
