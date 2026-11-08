"""Configuration lue dans les variables d'environnement (jamais de secret en dur)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

AGENT_NAME = "interprete"

IDENTITY_HOST = "host"
IDENTITY_GUEST = "guest"

TRACK_FOR_HOST = "tr-for-host"    # traduction de la parole de l'invité, pour l'hôte
TRACK_FOR_GUEST = "tr-for-guest"  # traduction de la parole de l'hôte, pour l'invité

TOPIC_CAPTIONS = "captions"
TOPIC_BILLING = "billing"
TOPIC_FACE_TURN = "face_turn"     # indice facultatif envoyé par le client en face-à-face

TICK_SECONDS = 15


def _env(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else default


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


def _env_list(name: str, default: str) -> list[str]:
    return [x.strip() for x in _env(name, default).split(",") if x.strip()]


@dataclass(frozen=True)
class Settings:
    openai_api_key: str = ""
    realtime_model: str = "gpt-realtime-2"
    realtime_fallback_model: str = "gpt-realtime-2.1-mini"
    reasoning_effort: str = "minimal"          # "" = ne pas envoyer le champ
    transcribe_model: str = "gpt-live-transcribe"
    summary_model: str = "gpt-5-mini"
    default_voice: str = "marin"
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    vad_silence_ms: int = 350
    vad_prefix_ms: int = 250
    vad_threshold: float = 0.5
    reconnect_grace_s: float = 30.0            # attente d'un participant parti avant de clore
    flush_interval_s: float = 2.0              # lot d'écriture des phrases
    captions_only_langs: list[str] = field(default_factory=lambda: ["wo"])
    max_context_items: int = 10                # items gardés côté OpenAI (coût / latence)

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)


def load_settings() -> Settings:
    return Settings(
        openai_api_key=_env("OPENAI_API_KEY"),
        realtime_model=_env("REALTIME_MODEL", "gpt-realtime-2"),
        realtime_fallback_model=_env("REALTIME_FALLBACK_MODEL", "gpt-realtime-2.1-mini"),
        reasoning_effort=_env("REALTIME_REASONING_EFFORT", "minimal").lower()
        if os.environ.get("REALTIME_REASONING_EFFORT") is None
        else os.environ.get("REALTIME_REASONING_EFFORT", "").strip().lower(),
        transcribe_model=_env("TRANSCRIBE_MODEL", "gpt-live-transcribe"),
        summary_model=_env("SUMMARY_MODEL", "gpt-5-mini"),
        default_voice=_env("DEFAULT_VOICE", "marin"),
        supabase_url=_env("SUPABASE_URL").rstrip("/"),
        supabase_service_role_key=_env("SUPABASE_SERVICE_ROLE_KEY"),
        vad_silence_ms=int(_env_float("VAD_SILENCE_MS", 350)),
        vad_prefix_ms=int(_env_float("VAD_PREFIX_MS", 250)),
        vad_threshold=_env_float("VAD_THRESHOLD", 0.5),
        reconnect_grace_s=_env_float("RECONNECT_GRACE_S", 30.0),
        flush_interval_s=_env_float("UTTERANCE_FLUSH_S", 2.0),
        captions_only_langs=_env_list("CAPTIONS_ONLY_LANGS", "wo"),
        max_context_items=int(_env_float("MAX_CONTEXT_ITEMS", 10)),
    )
