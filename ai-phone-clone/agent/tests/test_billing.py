import asyncio

import pytest

from interprete.billing import (
    REFUND_TICK,
    ActivityTracker,
    BillingTicker,
    refund_due,
    thresholds_crossed,
)


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def make_ticker(balances, billable=lambda: True, **kw):
    calls, events = [], []
    seq = list(balances)

    async def debit(tick, seconds):
        calls.append((tick, seconds))
        v = seq.pop(0)
        if isinstance(v, Exception):
            raise v
        return v

    async def on_remaining(r):
        events.append(("remaining", r))

    async def on_warning(t, r):
        events.append(("warning", t, r))

    async def on_exhausted():
        events.append(("exhausted",))

    async def on_failure():
        events.append(("failure",))

    async def no_sleep(_):
        await asyncio.sleep(0)

    t = BillingTicker(
        debit=debit, is_billable=billable, on_remaining=on_remaining, on_warning=on_warning,
        on_exhausted=on_exhausted, on_failure=on_failure, sleep=no_sleep, poll_interval=0.01, **kw,
    )
    return t, calls, events


async def test_ticks_until_minus_one_then_stops():
    t, calls, events = make_ticker([300, 285, -1])
    await asyncio.wait_for(t.run(), 2)
    assert calls == [(0, 15), (1, 15), (2, 15)]
    assert t.exhausted and t.debited_ticks == 2 and t.billed_seconds == 30
    assert events[-2:] == [("remaining", 0), ("exhausted",)]


async def test_warnings_at_120_and_30_once_each():
    t, _, events = make_ticker([150, 125, 110, 95, 40, 25, 10, -1])
    await asyncio.wait_for(t.run(), 2)
    warnings = [e for e in events if e[0] == "warning"]
    assert warnings == [("warning", 120, 110), ("warning", 30, 25)]


def test_thresholds_crossed_jumping_both():
    seen = set()
    assert thresholds_crossed(20, seen) == 30      # premier tick déjà sous les deux seuils
    assert thresholds_crossed(5, seen) is None
    assert seen == {120, 30}


async def test_debit_error_retries_same_tick_then_fails():
    errs = [RuntimeError("net")] * 5
    t, calls, events = make_ticker([200, *errs])
    await asyncio.wait_for(t.run(), 2)
    assert [c[0] for c in calls] == [0, 1, 1, 1, 1, 1]
    assert events[-1] == ("failure",)


async def test_transient_error_recovers():
    t, calls, _ = make_ticker([RuntimeError("x"), 200, -1])
    await asyncio.wait_for(t.run(), 2)
    assert [c[0] for c in calls] == [0, 0, 1]


async def test_waits_while_not_billable():
    state = {"ok": False}
    t, calls, _ = make_ticker([100, -1], billable=lambda: state["ok"])
    task = asyncio.create_task(t.run())
    await asyncio.sleep(0.05)
    assert calls == []
    state["ok"] = True
    await asyncio.wait_for(task, 2)
    assert len(calls) == 2


def test_activity_silence_pause():
    clock = FakeClock()
    a = ActivityTracker(window_s=30, clock=clock)
    assert not a.recently_active()              # personne n'a encore parlé
    a.speech_started("host")
    clock.t += 120
    assert a.recently_active()                  # parle encore (pas de speech_stopped)
    a.speech_stopped("host")
    clock.t += 29
    assert a.recently_active()
    clock.t += 2
    assert not a.recently_active()              # 31 s de silence des deux côtés : pause
    a.speech_started("guest")
    assert a.recently_active()                  # reprise à la prochaine parole


async def test_silence_pauses_billing_and_resumes_on_speech():
    clock = FakeClock()
    a = ActivityTracker(window_s=30, clock=clock)
    present = {"both": True}
    sleeps = []

    calls = []

    async def debit(tick, seconds):
        calls.append(tick)
        return 1000

    async def noop(*_):
        pass

    async def fake_sleep(s):
        sleeps.append(s)
        clock.t += s
        await asyncio.sleep(0)

    t = BillingTicker(
        debit=debit, is_billable=lambda: present["both"] and a.recently_active(),
        on_remaining=noop, on_warning=noop, on_exhausted=noop, wake=a.changed,
        sleep=fake_sleep, poll_interval=0.01,
    )
    task = asyncio.create_task(t.run())
    await asyncio.sleep(0.05)
    assert calls == []                          # pas de parole : rien n'est facturé
    a.speech_started("host")
    a.speech_stopped("host")
    await asyncio.sleep(0.05)
    # tick 0 à la parole, tick 1 et 2 dans la fenêtre de 30 s, puis pause
    assert calls == [0, 1, 2]
    await asyncio.sleep(0.05)
    assert calls == [0, 1, 2]
    a.speech_started("guest")
    await asyncio.sleep(0.05)
    assert calls[:4] == [0, 1, 2, 3]
    t.stop()
    await asyncio.wait_for(task, 1)


@pytest.mark.parametrize(
    "reason,live,debited,expected",
    [
        ("error", 20.0, 30, 30),
        ("error", None, 15, 15),
        ("error", 75.0, 75, 0),
        ("host_hangup", 10.0, 15, 0),
        ("error", 10.0, 0, 0),
        ("no_credit", 10.0, 15, 0),
    ],
)
def test_refund_rule(reason, live, debited, expected):
    assert refund_due(end_reason=reason, live_seconds=live, debited_seconds=debited) == expected


def test_refund_tick_reserved():
    assert REFUND_TICK < 0   # jamais un n° de tranche réel (0, 1, 2...)
