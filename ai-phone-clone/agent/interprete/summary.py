"""Résumé de fin d'appel (modèle texte OpenAI, configurable par SUMMARY_MODEL)."""

from __future__ import annotations

import json
import logging
from typing import Any

from .prompts import lang_name

log = logging.getLogger("interprete.summary")

MAX_TRANSCRIPT_CHARS = 60_000


def transcript_text(rows: list[dict], host_lang: str) -> str:
    """Transcription lisible, dans la langue de l'hôte autant que possible."""
    lines = []
    for r in sorted(rows, key=lambda x: x.get("seq", 0)):
        who = "Host" if r.get("speaker") == "host" else "Guest"
        # la version dans la langue de l'hôte : texte source pour l'hôte, traduction pour l'invité
        text = r.get("text_src") if r.get("lang_src") == host_lang else r.get("text_dst")
        text = (text or r.get("text_src") or "").strip()
        if text:
            lines.append(f"{who}: {text}")
    out = "\n".join(lines)
    if len(out) > MAX_TRANSCRIPT_CHARS:  # garde la fin, souvent la plus utile (décisions)
        out = "[...]\n" + out[-MAX_TRANSCRIPT_CHARS:]
    return out


def build_summary_messages(rows: list[dict], host_lang: str) -> list[dict]:
    lang = lang_name(host_lang)
    system = (
        "You summarise a translated phone call between a host and a guest. "
        f"Write in {lang}. Be factual, do not invent anything. "
        'Reply with a JSON object: {"summary": "<3 to 5 sentences>", "key_points": ["<short point>", ...]} '
        "with at most 8 key points (decisions, figures, dates, next steps)."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": transcript_text(rows, host_lang)},
    ]


def parse_summary(content: str | None) -> tuple[str, list[str]]:
    if not content:
        raise ValueError("empty summary")
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[text.find("{"):] if "{" in text else text
    try:
        data: Any = json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return text, []
        data = json.loads(text[start : end + 1])
    summary = str(data.get("summary", "")).strip()
    points = data.get("key_points") or []
    if not isinstance(points, list):
        points = [str(points)]
    points = [str(p).strip() for p in points if str(p).strip()][:8]
    if not summary:
        raise ValueError("summary field missing")
    return summary, points


async def generate_summary(rows: list[dict], host_lang: str, *, model: str, api_key: str, client=None) -> tuple[str, list[str]]:
    if not rows:
        raise ValueError("no utterances to summarise")
    if client is None:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=api_key)
    resp = await client.chat.completions.create(
        model=model,
        messages=build_summary_messages(rows, host_lang),
        response_format={"type": "json_object"},
    )
    return parse_summary(resp.choices[0].message.content)
