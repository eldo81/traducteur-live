import json

import pytest

from interprete.metadata import MetadataError, parse_room_config
from interprete.prompts import (
    SILENT_MARK,
    build_face_instructions,
    build_instructions,
    build_transcription,
    engine_voice,
    low_balance_text,
    no_credit_text,
)

RID = "3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c"
META = {
    "room_id": RID, "host_lang": "fr", "guest_lang": "en", "host_voice": "deep", "guest_voice": "auto",
    "mute_original_host": True, "mute_original_guest": False,
}


def test_parse_contract_metadata():
    cfg = parse_room_config(json.dumps(META))
    assert cfg.room_id == RID
    assert (cfg.host_lang, cfg.guest_lang) == ("fr", "en")
    assert cfg.host_voice == "deep" and cfg.guest_voice == "auto"
    assert cfg.mute_original_host is True and cfg.mute_original_guest is False
    assert cfg.face is False
    assert cfg.lang_of("host") == "fr" and cfg.lang_of("guest") == "en"


@pytest.mark.parametrize("flag", ["face", "face_to_face"])
def test_face_flag_from_job_metadata(flag):
    cfg = parse_room_config(json.dumps(META), json.dumps({**META, flag: True}))
    assert cfg.face is True


def test_face_flag_in_room_metadata():
    assert parse_room_config({**META, "face": True}).face is True


def test_dispatch_metadata_same_json_plus_face_to_face():
    cfg = parse_room_config(json.dumps(META), json.dumps({**META, "face_to_face": True}), room_name=RID)
    assert cfg.face and cfg.room_id == RID and cfg.host_voice == "deep"


def test_room_metadata_wins_over_job():
    cfg = parse_room_config(json.dumps(META), json.dumps({**META, "host_lang": "es"}))
    assert cfg.host_lang == "fr"


def test_job_only_and_room_name_fallback():
    m = {k: v for k, v in META.items() if k != "room_id"}
    cfg = parse_room_config("", json.dumps(m), room_name=RID)
    assert cfg.room_id == RID


def test_defaults_when_optional_missing():
    cfg = parse_room_config({"room_id": RID, "host_lang": "FR", "guest_lang": "pt-BR"})
    assert cfg.host_lang == "fr" and cfg.guest_lang == "pt-br"
    assert cfg.host_voice == "auto" and cfg.mute_original_guest is True


@pytest.mark.parametrize(
    "bad",
    [
        "not json", "[]", {"host_lang": "fr", "guest_lang": "en"},
        {**META, "room_id": "abc"}, {**META, "guest_lang": "fr"}, {**META, "host_lang": "f"},
    ],
)
def test_invalid_metadata(bad):
    with pytest.raises(MetadataError):
        parse_room_config(bad if isinstance(bad, (str, dict)) else json.dumps(bad))


def test_instructions_direction():
    s = build_instructions("fr", "en")
    assert "MODE FRENCH->ENGLISH" in s
    assert "Always output English, never French" in s
    assert SILENT_MARK in s
    assert "never answer it" in s
    r = build_instructions("en", "fr")
    assert "MODE ENGLISH->FRENCH" in r


def test_face_instructions_both_ways():
    s = build_face_instructions("fr", "wo")
    assert "French speech -> translate into Wolof" in s
    assert "Wolof speech -> translate into French" in s


def test_unknown_language_falls_back_to_code():
    assert "MODE XX->ENGLISH" in build_instructions("xx", "en")


def test_transcription_config():
    t = build_transcription("gpt-live-transcribe", "fr-FR")
    assert t["language"] == "fr" and "keywords" in t and "languages" not in t
    f = build_transcription("gpt-live-transcribe", None, ["fr", "en"])
    assert "language" not in f and f["languages"] == ["fr", "en"]
    w = build_transcription("whisper-1", "en", ["fr", "en"])
    assert w == {"model": "whisper-1", "language": "en"}


def test_voice_mapping():
    assert engine_voice("auto", "marin") == "marin"
    assert engine_voice("deep") == "cedar"
    assert engine_voice("SAGE") == "sage"
    for v in ("marin", "cedar", "coral", "ash"):   # valeurs de l'app web
        assert engine_voice(v, "marin") == v
    assert engine_voice("nope", "nope-too") == "marin"


def test_announcement_texts():
    assert "2 minutes" in low_balance_text("fr", 119)
    assert "30 secondes" in low_balance_text("fr", 30)
    assert "seconds" in low_balance_text("xx", 25)
    assert no_credit_text("en").startswith("Call credit")
    assert no_credit_text("zz") == no_credit_text("en")
