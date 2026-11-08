"""Lecture des métadonnées de salle (contrat partagé avec ai-phone-clone/app/src/lib/contract.ts)."""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from typing import Any

_LANG_RE = re.compile(r"^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$")


class MetadataError(ValueError):
    pass


@dataclass(frozen=True)
class RoomConfig:
    room_id: str
    host_lang: str
    guest_lang: str
    host_voice: str = "auto"
    guest_voice: str = "auto"
    mute_original_host: bool = True
    mute_original_guest: bool = True
    face: bool = False

    def lang_of(self, role: str) -> str:
        return self.host_lang if role == "host" else self.guest_lang

    def voice_of(self, role: str) -> str:
        return self.host_voice if role == "host" else self.guest_voice


def _loads(raw: str | bytes | dict[str, Any] | None) -> dict[str, Any]:
    if raw is None or raw == "" or raw == b"":
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        data = json.loads(raw)
    except (TypeError, ValueError) as e:
        raise MetadataError(f"metadata is not valid JSON: {e}") from e
    if not isinstance(data, dict):
        raise MetadataError("metadata must be a JSON object")
    return data


def _bool(v: Any, default: bool) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(v, (int, float)):
        return bool(v)
    return default


def _lang(v: Any, field: str) -> str:
    if not isinstance(v, str) or not _LANG_RE.match(v.strip()):
        raise MetadataError(f"invalid {field}: {v!r}")
    return v.strip().lower().replace("_", "-")


def parse_room_config(
    room_metadata: str | bytes | dict[str, Any] | None,
    job_metadata: str | bytes | dict[str, Any] | None = None,
    room_name: str | None = None,
) -> RoomConfig:
    """Fusionne métadonnées de salle (prioritaires) et de dispatch (job).

    Le mode face-à-face est signalé par ``face: true`` ou ``face_to_face: true``
    (l'app web le met dans les métadonnées du job, la salle garde le contrat exact).
    """
    job = _loads(job_metadata) if job_metadata not in (None, "", b"") else {}
    room = _loads(room_metadata)
    data = {**job, **room}
    face = _bool(room.get("face", room.get("face_to_face", job.get("face", job.get("face_to_face")))), False)

    room_id = data.get("room_id") or room_name
    if not isinstance(room_id, str):
        raise MetadataError("missing room_id")
    try:
        room_id = str(uuid.UUID(room_id))
    except ValueError as e:
        raise MetadataError(f"room_id is not a uuid: {room_id!r}") from e

    host_lang = _lang(data.get("host_lang"), "host_lang")
    guest_lang = _lang(data.get("guest_lang"), "guest_lang")
    if host_lang == guest_lang:
        raise MetadataError("host_lang and guest_lang must differ")

    def voice(key: str) -> str:
        v = data.get(key)
        return v.strip() if isinstance(v, str) and v.strip() else "auto"

    return RoomConfig(
        room_id=room_id,
        host_lang=host_lang,
        guest_lang=guest_lang,
        host_voice=voice("host_voice"),
        guest_voice=voice("guest_voice"),
        mute_original_host=_bool(data.get("mute_original_host"), True),
        mute_original_guest=_bool(data.get("mute_original_guest"), True),
        face=face,
    )
