import json
import time

import httpx
import pytest

from interprete.billing import REFUND_TICK
from interprete.call import CallController, billing_message
from interprete.captions import Utterance
from interprete.config import Settings
from interprete.metadata import parse_room_config
from interprete.persistence import UtteranceBatcher
from interprete.store import StoreError, SupabaseStore

RID = "3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c"
HOST = "11111111-2222-3333-4444-555555555555"


def mock_store(handler):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return SupabaseStore("https://proj.supabase.co/", "service-key", client=client)


async def test_debit_rpc_request_and_result():
    seen = {}

    def handler(req: httpx.Request):
        seen["url"] = str(req.url)
        seen["body"] = json.loads(req.content)
        seen["auth"] = req.headers["authorization"]
        seen["apikey"] = req.headers["apikey"]
        return httpx.Response(200, json=165)

    s = mock_store(handler)
    assert await s.debit_call_tick(RID, 3, 15) == 165
    assert seen["url"] == "https://proj.supabase.co/rest/v1/rpc/debit_call_tick"
    assert seen["body"] == {"p_room": RID, "p_tick": 3, "p_seconds": 15}
    assert seen["auth"] == "Bearer service-key" and seen["apikey"] == "service-key"


async def test_debit_minus_one_and_errors():
    s = mock_store(lambda r: httpx.Response(200, json=-1))
    assert await s.debit_call_tick(RID, 0) == -1
    s = mock_store(lambda r: httpx.Response(400, json={"message": "room not found"}))
    with pytest.raises(StoreError):
        await s.debit_call_tick(RID, 0)


async def test_refund_insert_is_idempotent_upsert():
    seen = {}

    def handler(req):
        seen["params"] = dict(req.url.params)
        seen["prefer"] = req.headers.get("prefer")
        seen["body"] = json.loads(req.content)
        return httpx.Response(201)

    s = mock_store(handler)
    await s.insert_refund(room_id=RID, user_id=HOST, seconds=30, tick=REFUND_TICK)
    assert seen["params"] == {"on_conflict": "room_id,tick"}
    assert "ignore-duplicates" in seen["prefer"]
    assert seen["body"] == {"user_id": HOST, "delta_seconds": 30, "reason": "refund", "room_id": RID, "tick": -1}


async def test_room_debited_seconds_sums_call_debits():
    s = mock_store(lambda r: httpx.Response(200, json=[{"delta_seconds": -15}, {"delta_seconds": -15}]))
    assert await s.room_debited_seconds(RID) == 30


async def test_mark_ended_does_not_overwrite_closed_room():
    seen = {}

    def handler(req):
        seen["params"] = dict(req.url.params)
        seen["body"] = json.loads(req.content)
        return httpx.Response(204)

    s = mock_store(handler)
    await s.mark_ended(RID, end_reason="no_credit", ended_at="2026-11-08T10:00:00+00:00")
    assert seen["params"] == {"id": f"eq.{RID}", "status": "in.(waiting,live)"}
    assert seen["body"]["status"] == "ended" and seen["body"]["end_reason"] == "no_credit"


def utt(seq, src="Bonjour à tous", dst="Hello everyone", **kw):
    u = Utterance(seq=seq, speaker="host", lang_src="fr", lang_dst="en", **kw)
    u.text_src, u.text_dst = src, dst
    u.src_final = u.dst_final = True
    return u


async def test_batcher_orders_dedups_and_skips_silence():
    batches = []

    async def insert(rows):
        batches.append(rows)

    b = UtteranceBatcher(room_id=RID, host_id=HOST, insert=insert)
    assert b.add(utt(2))
    assert b.add(utt(1))
    assert not b.add(utt(1))                   # même seq : ignoré
    assert not b.add(utt(3, dst="·"))          # « rien à traduire »
    s = utt(4)
    s.suppressed = True
    assert not b.add(s)                        # écho supprimé
    assert await b.flush() == 2
    assert [r["seq"] for r in batches[0]] == [1, 2]
    row = batches[0][0]
    assert row["room_id"] == RID and row["host_id"] == HOST and row["speaker"] == "host"
    assert set(row) == {"room_id", "host_id", "speaker", "lang_src", "text_src", "lang_dst", "text_dst", "started_at", "ended_at", "seq"}
    assert await b.flush() == 0


async def test_batcher_keeps_rows_on_failure():
    calls = {"n": 0}

    async def insert(rows):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("down")

    b = UtteranceBatcher(room_id=RID, host_id=HOST, insert=insert)
    b.add(utt(0))
    assert await b.flush() == 0 and b.pending == 1
    assert await b.flush() == 1 and b.pending == 0


async def test_batcher_close_flushes():
    got = []

    async def insert(rows):
        got.extend(rows)

    b = UtteranceBatcher(room_id=RID, host_id=HOST, insert=insert)
    b.add(utt(5))
    await b.close()
    assert [r["seq"] for r in got] == [5]


def test_billing_message():
    assert billing_message(42) == {"remaining_seconds": 42}
    assert billing_message(25, 30) == {"remaining_seconds": 25, "warning_threshold": 30}


class FakeStore:
    def __init__(self, debited):
        self.debited = debited
        self.refunds = []

    async def room_debited_seconds(self, room_id):
        return self.debited

    async def insert_refund(self, **kw):
        # unique(room_id, tick) : une seule ligne par salle
        if not any(r["room_id"] == kw["room_id"] and r["tick"] == kw["tick"] for r in self.refunds):
            self.refunds.append(kw)


def controller(store, started_ago):
    cfg = parse_room_config({"room_id": RID, "host_lang": "fr", "guest_lang": "en"})
    c = CallController(room=None, cfg=cfg, settings=Settings(), store=store)
    c.host_id = HOST
    c.started_mono = None if started_ago is None else time.monotonic() - started_ago
    return c


async def test_controller_refunds_early_error_once():
    st = FakeStore(30)
    c = controller(st, 20)
    await c._maybe_refund("error")
    await c._maybe_refund("error")
    assert st.refunds == [{"room_id": RID, "user_id": HOST, "seconds": 30, "tick": REFUND_TICK}]


async def test_controller_no_refund_after_first_minute_or_normal_end():
    st = FakeStore(90)
    await controller(st, 90)._maybe_refund("error")
    await controller(st, 10)._maybe_refund("guest_hangup")
    assert st.refunds == []


async def test_finalize_runs_once_and_marks_ended():
    calls = []

    class Store(FakeStore):
        async def mark_ended(self, room_id, *, end_reason, ended_at):
            calls.append(end_reason)

    c = controller(Store(0), 5)
    c._last_left = "guest"
    import asyncio

    await asyncio.gather(c.finalize(), c.finalize())
    await c.finalize()
    assert calls == ["guest_hangup"]


async def test_end_reason_validation():
    c = controller(None, None)
    await c.end("weird")
    assert c.end_reason == "error" and c.ended.is_set()
    await c.end("host_hangup")          # déjà terminé : inchangé
    assert c.end_reason == "error"
