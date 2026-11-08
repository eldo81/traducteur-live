import asyncio
import json

import pytest

from interprete.billing import ActivityTracker
from interprete.captions import (
    EchoGuard,
    SeqCounter,
    caption_message,
    encode,
    guess_lang,
    is_silent,
)
from interprete.config import Settings
from interprete.summary import build_summary_messages, parse_summary, transcript_text
from interprete.translator import Translator, realtime_model_kwargs


def test_caption_format_matches_contract():
    m = caption_message(speaker="guest", lang_src="en", text_src="Hi", lang_dst="fr", text_dst="Salut", final=True, seq=7)
    assert m == {"speaker": "guest", "lang_src": "en", "text_src": "Hi", "lang_dst": "fr", "text_dst": "Salut", "final": True, "seq": 7}
    assert json.loads(encode(m).decode()) == m
    assert "é" in encode({**m, "text_dst": "été"}).decode()   # UTF-8, pas d'échappement
    with pytest.raises(ValueError):
        caption_message(speaker="agent", lang_src="en", text_src="", lang_dst="fr", text_dst="", final=False, seq=0)
    with pytest.raises(ValueError):
        caption_message(speaker="host", lang_src="en", text_src="", lang_dst="fr", text_dst="", final=False, seq=-1)


def test_silence_marker():
    assert is_silent("·") and is_silent(" · ") and is_silent("...")
    assert not is_silent("") and not is_silent("Oui")


def test_echo_guard():
    clock = {"t": 0.0}
    g = EchoGuard(clock=lambda: clock["t"])
    g.remember("We can ship two hundred tons FOB Dakar next week")
    assert g.is_echo("we can ship two hundred tons FOB Dakar next week.")
    assert not g.is_echo("Nous pouvons expédier la semaine prochaine")
    assert not g.is_echo("ok")                      # trop court
    clock["t"] = 25
    assert not g.is_echo("we can ship two hundred tons FOB Dakar next week")  # hors fenêtre


def test_guess_lang():
    assert guess_lang("Bonjour, je vous appelle pour la commande", ["fr", "en"]) == "fr"
    assert guess_lang("Hello, I am calling about the order", ["fr", "en"]) == "en"
    assert guess_lang("مرحبا كيف حالك", ["fr", "ar"]) == "ar"
    assert guess_lang("12 345", ["fr", "en"]) is None
    assert guess_lang("Zorglub", ["fr", "ar"]) == "fr"


def test_seq_counter_monotonic():
    s = SeqCounter()
    s.reset_floor(5)
    assert [s.next(), s.next()] == [5, 6]
    s.reset_floor(3)
    assert s.next() == 7


def test_realtime_kwargs_and_plugin_accepts_them():
    st = Settings(openai_api_key="sk-test")
    kw = realtime_model_kwargs(st, model="gpt-realtime-2", voice="deep", src_lang="fr", languages=["fr", "en"], text_only=False)
    assert kw["voice"] == "cedar" and kw["modalities"] == ["audio"]
    assert kw["turn_detection"].interrupt_response is False and kw["turn_detection"].create_response is True
    assert kw["input_audio_transcription"].language == "fr"
    assert kw["reasoning"].effort == "minimal"
    mini = realtime_model_kwargs(st, model="gpt-realtime-1.5", voice="auto", src_lang="fr", languages=None, text_only=True)
    assert "reasoning" not in mini and mini["modalities"] == ["text"]
    # l'installé livekit-plugins-openai accepte ces options (aucune connexion réseau ici)
    from livekit.plugins.openai import realtime

    model = realtime.RealtimeModel(**kw)
    assert model.model == "gpt-realtime-2"
    assert model.capabilities.audio_output is True


def make_translator(face=False, settings=None):
    captions, finals = [], []

    async def on_caption(m):
        captions.append(m)

    tr = Translator(
        room=None, settings=settings or Settings(), speaker="host", out_track="tr-for-guest",
        src_lang="fr", dst_lang="en", voice="auto", seq=SeqCounter(10), activity=ActivityTracker(),
        own_src=EchoGuard(), peer_src=EchoGuard(), on_caption=on_caption, on_final=finals.append,
        on_fatal=lambda why: None, face=face,
    )
    return tr, captions, finals


async def drain():
    for _ in range(5):
        await asyncio.sleep(0)


async def test_translator_event_flow_builds_one_utterance():
    tr, captions, finals = make_translator()
    ev = tr._handle_raw
    ev({"type": "input_audio_buffer.speech_started", "item_id": "it1"})
    assert tr._activity.recently_active()
    ev({"type": "input_audio_buffer.committed", "item_id": "it1"})
    ev({"type": "conversation.item.input_audio_transcription.delta", "item_id": "it1", "delta": "Bonjour "})
    ev({"type": "response.created", "response": {"id": "r1"}})
    ev({"type": "response.output_audio_transcript.delta", "response_id": "r1", "delta": "Hello"})
    ev({"type": "conversation.item.input_audio_transcription.completed", "item_id": "it1", "transcript": "Bonjour à tous."})
    assert finals == []
    ev({"type": "response.output_audio_transcript.done", "response_id": "r1", "transcript": "Hello everyone."})
    ev({"type": "response.done", "response": {"id": "r1"}})
    await drain()
    assert len(finals) == 1
    u = finals[0]
    assert (u.seq, u.text_src, u.text_dst, u.speaker) == (10, "Bonjour à tous.", "Hello everyone.", "host")
    final = [c for c in captions if c["final"]]
    assert final == [{"speaker": "host", "lang_src": "fr", "text_src": "Bonjour à tous.", "lang_dst": "en",
                      "text_dst": "Hello everyone.", "final": True, "seq": 10}]
    assert all(c["seq"] == 10 for c in captions)
    assert tr._decision("r1") is True


async def test_translator_fifo_two_segments():
    tr, _, finals = make_translator()
    ev = tr._handle_raw
    ev({"type": "input_audio_buffer.committed", "item_id": "a"})
    ev({"type": "input_audio_buffer.committed", "item_id": "b"})
    for rid, item, src, dst in (("r1", "a", "Un", "One"), ("r2", "b", "Deux", "Two")):
        ev({"type": "response.created", "response": {"id": rid}})
        ev({"type": "conversation.item.input_audio_transcription.completed", "item_id": item, "transcript": src})
        ev({"type": "response.output_audio_transcript.done", "response_id": rid, "transcript": dst})
        ev({"type": "response.done", "response": {"id": rid}})
    await drain()
    assert [(u.seq, u.text_src, u.text_dst) for u in finals] == [(10, "Un", "One"), (11, "Deux", "Two")]


async def test_translator_suppresses_silence_and_echo():
    tr, captions, finals = make_translator()
    tr._peer_src.remember("Nous livrons deux cents tonnes à Dakar")
    ev = tr._handle_raw
    ev({"type": "input_audio_buffer.committed", "item_id": "a"})
    ev({"type": "response.created", "response": {"id": "r1"}})
    ev({"type": "response.output_audio_transcript.delta", "response_id": "r1", "delta": "·"})
    assert tr._decision("r1") is False
    ev({"type": "conversation.item.input_audio_transcription.completed", "item_id": "a", "transcript": "Euh"})
    ev({"type": "response.done", "response": {"id": "r1"}})
    ev({"type": "input_audio_buffer.committed", "item_id": "b"})
    ev({"type": "response.created", "response": {"id": "r2"}})
    ev({"type": "response.output_audio_transcript.delta", "response_id": "r2", "delta": "Nous livrons deux cents tonnes à Dakar"})
    assert tr._decision("r2") is False
    await drain()
    assert finals[0].suppressed and not finals[0].persistable()
    assert all(c["text_dst"] in ("",) for c in captions if c["final"])


async def test_announcement_response_is_not_a_caption():
    tr, captions, finals = make_translator()
    ev = tr._handle_raw
    ev({"type": "response.created", "response": {"id": "ann", "metadata": {"kind": "announce"}}})
    ev({"type": "response.output_audio_transcript.delta", "response_id": "ann", "delta": "Heads up"})
    ev({"type": "response.done", "response": {"id": "ann"}})
    await drain()
    assert captions == [] and finals == [] and tr._decision("ann") is True


async def test_face_mode_assigns_speaker_from_language():
    tr, captions, finals = make_translator(face=True)
    ev = tr._handle_raw
    ev({"type": "input_audio_buffer.committed", "item_id": "a"})
    ev({"type": "response.created", "response": {"id": "r1"}})
    ev({"type": "conversation.item.input_audio_transcription.completed", "item_id": "a", "transcript": "Hello, what is the price of the order?"})
    ev({"type": "response.output_audio_transcript.done", "response_id": "r1", "transcript": "Bonjour, quel est le prix de la commande ?"})
    ev({"type": "response.done", "response": {"id": "r1"}})
    await drain()
    u = finals[0]
    assert (u.speaker, u.lang_src, u.lang_dst) == ("guest", "en", "fr")


async def test_context_pruning_sends_deletes():
    sent = []

    class FakeSession:
        def send_event(self, e):
            sent.append(e)

    tr, _, _ = make_translator(settings=Settings(max_context_items=2))
    tr._session = FakeSession()
    for i in range(4):
        tr._handle_raw({"type": "conversation.item.added", "item": {"id": f"i{i}"}})
    assert sent == [{"type": "conversation.item.delete", "item_id": "i0"},
                    {"type": "conversation.item.delete", "item_id": "i1"}]


ROWS = [
    {"seq": 2, "speaker": "guest", "lang_src": "en", "text_src": "Deal.", "lang_dst": "fr", "text_dst": "Marché conclu."},
    {"seq": 1, "speaker": "host", "lang_src": "fr", "text_src": "200 tonnes FOB.", "lang_dst": "en", "text_dst": "200 tons FOB."},
]


def test_summary_prompt_uses_host_language():
    t = transcript_text(ROWS, "fr")
    assert t.splitlines() == ["Host: 200 tonnes FOB.", "Guest: Marché conclu."]
    msgs = build_summary_messages(ROWS, "fr")
    assert "Write in French" in msgs[0]["content"]


def test_parse_summary():
    s, p = parse_summary('{"summary": "Accord sur 200 t.", "key_points": ["FOB", " ", "Acompte 30 %"]}')
    assert s == "Accord sur 200 t." and p == ["FOB", "Acompte 30 %"]
    s, p = parse_summary('```json\n{"summary": "OK", "key_points": "un point"}\n```')
    assert s == "OK" and p == ["un point"]
    with pytest.raises(ValueError):
        parse_summary("")


async def test_generate_summary_with_mock_client():
    from types import SimpleNamespace

    from interprete.summary import generate_summary

    captured = {}

    class Completions:
        async def create(self, **kw):
            captured.update(kw)
            msg = SimpleNamespace(content='{"summary": "Résumé", "key_points": ["a"]}')
            return SimpleNamespace(choices=[SimpleNamespace(message=msg)])

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    s, p = await generate_summary(ROWS, "fr", model="my-model", api_key="x", client=client)
    assert (s, p) == ("Résumé", ["a"]) and captured["model"] == "my-model"


async def test_model_rejected_switches_to_fallback():
    tr, _, _ = make_translator(settings=Settings(realtime_model="gpt-realtime-2", realtime_fallback_model="gpt-realtime-2.1-mini"))
    restarts = []

    async def fake_restart():
        restarts.append(tr.model_name)

    tr._restart = fake_restart
    tr._handle_raw({"type": "error", "error": {"code": "model_not_found", "message": "The model does not exist"}})
    await drain()
    assert restarts == ["gpt-realtime-2.1-mini"]
    fatal = []
    tr._on_fatal = fatal.append
    tr._handle_raw({"type": "error", "error": {"code": "model_not_found", "message": "again"}})
    assert fatal  # le repli a déjà été utilisé : fin d'appel sur erreur


async def test_reasoning_rejected_is_dropped():
    tr, _, _ = make_translator(settings=Settings(reasoning_effort="minimal"))
    restarts = []

    async def fake_restart():
        restarts.append(tr.settings.reasoning_effort)

    tr._restart = fake_restart
    tr._handle_raw({"type": "error", "error": {"code": "unknown_parameter", "param": "session.reasoning", "message": "Unknown parameter"}})
    await drain()
    assert restarts == [""]
