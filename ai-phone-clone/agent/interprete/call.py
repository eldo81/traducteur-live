"""Orchestration d'un appel : présence, sessions de traduction, facturation, fin propre."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time

from livekit import rtc

from .billing import REFUND_TICK, ActivityTracker, BillingTicker, refund_due
from .captions import EchoGuard, SeqCounter, Utterance, encode, utc_now_iso
from .config import (
    IDENTITY_GUEST,
    IDENTITY_HOST,
    TICK_SECONDS,
    TOPIC_BILLING,
    TOPIC_CAPTIONS,
    TOPIC_FACE_TURN,
    TRACK_FOR_GUEST,
    TRACK_FOR_HOST,
    Settings,
)
from .metadata import RoomConfig
from .persistence import UtteranceBatcher
from .prompts import low_balance_text, no_credit_text
from .store import SupabaseStore
from .summary import generate_summary

log = logging.getLogger("interprete.call")

END_REASONS = {"host_hangup", "guest_hangup", "no_credit", "timeout", "error"}


def billing_message(remaining: int, warning: int | None = None) -> dict:
    msg: dict = {"remaining_seconds": int(remaining)}
    if warning is not None:
        msg["warning_threshold"] = int(warning)
    return msg


class CallController:
    def __init__(self, *, room: rtc.Room, cfg: RoomConfig, settings: Settings, store: SupabaseStore | None):
        self.room = room
        self.cfg = cfg
        self.settings = settings
        self.store = store
        self.host_id: str | None = None
        self.activity = ActivityTracker()
        self.seq = SeqCounter(0)
        self.translators: dict[str, object] = {}   # identité écoutée -> Translator
        self.present: set[str] = set()
        self.ever_present: set[str] = set()
        self.started_mono: float | None = None
        self.ended = asyncio.Event()
        self.end_reason: str | None = None
        self._last_left: str | None = None
        self._grace_task: asyncio.Task | None = None
        self._tasks: set[asyncio.Task] = set()
        self._final_task: asyncio.Task | None = None
        self._already_closed = False
        self.batcher: UtteranceBatcher | None = None
        self.ticker: BillingTicker | None = None
        self._guards = {IDENTITY_HOST: EchoGuard(), IDENTITY_GUEST: EchoGuard()}

    # ----------------------------------------------------------------- démarrage
    @property
    def required(self) -> set[str]:
        return {IDENTITY_HOST} if self.cfg.face else {IDENTITY_HOST, IDENTITY_GUEST}

    def both_present(self) -> bool:
        return self.required <= self.present

    def billable(self) -> bool:
        return not self.ended.is_set() and self.both_present() and self.activity.recently_active()

    async def setup(self) -> None:
        if self.store:
            try:
                row = await self.store.get_room(self.cfg.room_id)
                if row is None:
                    log.error("call_rooms row %s not found", self.cfg.room_id)
                else:
                    self.host_id = row["host_id"]
                    if row.get("status") in ("ended", "expired"):
                        log.warning("room %s already %s, leaving", self.cfg.room_id, row["status"])
                        self.end_reason = "timeout"
                        self._already_closed = True
                        self.ended.set()
                        return
                self.seq.reset_floor(await self.store.max_utterance_seq(self.cfg.room_id) + 1)
            except Exception:
                log.exception("could not read call room from Supabase")
            if self.host_id:
                self.batcher = UtteranceBatcher(
                    room_id=self.cfg.room_id, host_id=self.host_id, insert=self.store.insert_utterances,
                    interval_s=self.settings.flush_interval_s,
                )
                self._spawn(self.batcher.run())
        else:
            log.warning("SUPABASE_* not set: billing and persistence DISABLED (dev mode)")

        self.room.on("participant_connected", self._on_participant_connected)
        self.room.on("participant_disconnected", self._on_participant_disconnected)
        self.room.on("track_subscribed", self._on_track_subscribed)
        self.room.on("track_unsubscribed", self._on_track_unsubscribed)
        self.room.on("data_received", self._on_data)

        for p in list(self.room.remote_participants.values()):
            self._on_participant_connected(p)
            for pub in p.track_publications.values():
                if pub.track is not None and pub.subscribed:
                    self._on_track_subscribed(pub.track, pub, p)

    def _spawn(self, coro) -> asyncio.Task:
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return t

    async def _ensure_translator(self, identity: str):
        if identity in self.translators or self.ended.is_set():
            return self.translators.get(identity)
        from .translator import Translator  # import tardif : garde les modules purs testables sans rtc

        if self.cfg.face:
            if identity != IDENTITY_HOST:
                return None
            tr = Translator(
                room=self.room, settings=self.settings, speaker=IDENTITY_HOST, out_track=TRACK_FOR_HOST,
                src_lang=self.cfg.host_lang, dst_lang=self.cfg.guest_lang, voice=self.cfg.host_voice,
                seq=self.seq, activity=self.activity,
                own_src=self._guards[IDENTITY_HOST], peer_src=self._guards[IDENTITY_HOST],
                on_caption=self.publish_caption, on_final=self._on_final, on_fatal=self._on_fatal, face=True,
            )
        else:
            other = IDENTITY_GUEST if identity == IDENTITY_HOST else IDENTITY_HOST
            tr = Translator(
                room=self.room, settings=self.settings, speaker=identity,
                out_track=TRACK_FOR_GUEST if identity == IDENTITY_HOST else TRACK_FOR_HOST,
                src_lang=self.cfg.lang_of(identity), dst_lang=self.cfg.lang_of(other),
                voice=self.cfg.voice_of(identity), seq=self.seq, activity=self.activity,
                own_src=self._guards[identity], peer_src=self._guards[other],
                on_caption=self.publish_caption, on_final=self._on_final, on_fatal=self._on_fatal,
                is_listening=self.both_present,  # pas de traduction (ni de coût) avant que l'autre soit là
            )
        self.translators[identity] = tr
        try:
            await tr.start()
        except Exception:
            log.exception("translator start failed for %s", identity)
            self._on_fatal(f"translator start failed for {identity}")
        return tr

    # ----------------------------------------------------------------- présence
    def _on_participant_connected(self, p: rtc.RemoteParticipant) -> None:
        if p.identity not in (IDENTITY_HOST, IDENTITY_GUEST):
            return
        self.present.add(p.identity)
        self.ever_present.add(p.identity)
        if self._grace_task and self.both_present():
            self._grace_task.cancel()
            self._grace_task = None
        self._spawn(self._ensure_translator(p.identity))
        if self.both_present() and self.started_mono is None:
            self.started_mono = time.monotonic()
            self._spawn(self._on_call_started())
        self.activity.changed.set()

    def _on_participant_disconnected(self, p: rtc.RemoteParticipant) -> None:
        if p.identity not in (IDENTITY_HOST, IDENTITY_GUEST):
            return
        self.present.discard(p.identity)
        self._last_left = p.identity
        self.activity.speech_stopped(p.identity)
        if self.ended.is_set():
            return
        if self._grace_task:
            self._grace_task.cancel()
        self._grace_task = self._spawn(self._grace_then_end(p.identity))

    async def _grace_then_end(self, identity: str) -> None:
        await asyncio.sleep(self.settings.reconnect_grace_s)
        if identity not in self.present:
            await self.end(f"{identity}_hangup")

    def _on_track_subscribed(self, track: rtc.Track, pub: rtc.RemoteTrackPublication, p: rtc.RemoteParticipant) -> None:
        # n'écoute QUE le micro des participants host/guest : jamais les pistes traduites
        if track.kind != rtc.TrackKind.KIND_AUDIO or p.identity not in (IDENTITY_HOST, IDENTITY_GUEST):
            return
        if pub.source != rtc.TrackSource.SOURCE_MICROPHONE:
            return

        async def attach() -> None:
            tr = await self._ensure_translator(p.identity)
            if tr is not None:
                tr.attach_track(track)

        self._spawn(attach())

    def _on_track_unsubscribed(self, track: rtc.Track, pub: rtc.RemoteTrackPublication, p: rtc.RemoteParticipant) -> None:
        tr = self.translators.get(p.identity)
        if tr is not None:
            tr.detach_track(track.sid)

    def _on_data(self, packet: rtc.DataPacket) -> None:
        if packet.topic != TOPIC_FACE_TURN or not self.cfg.face:
            return
        import json

        try:
            data = json.loads(packet.data.decode("utf-8"))
        except ValueError:
            return
        speaker = data.get("speaker")
        lang = data.get("lang")
        if lang == self.cfg.host_lang:
            speaker = IDENTITY_HOST
        elif lang == self.cfg.guest_lang:
            speaker = IDENTITY_GUEST
        tr = self.translators.get(IDENTITY_HOST)
        if tr is not None and speaker in (IDENTITY_HOST, IDENTITY_GUEST):
            tr.face_hint = speaker

    # ----------------------------------------------------------------- appel en cours
    async def _on_call_started(self) -> None:
        log.info("call %s started (face=%s)", self.cfg.room_id, self.cfg.face)
        if self.store:
            with contextlib.suppress(Exception):
                await self.store.mark_live(self.cfg.room_id, utc_now_iso())
            self.ticker = BillingTicker(
                debit=lambda tick, sec: self.store.debit_call_tick(self.cfg.room_id, tick, sec),
                is_billable=self.billable,
                on_remaining=self._publish_billing,
                on_warning=self._warn_low_balance,
                on_exhausted=self._on_exhausted,
                on_failure=lambda: self.end("error"),
                wake=self.activity.changed,
                tick_seconds=TICK_SECONDS,
            )
            self._spawn(self.ticker.run())

    async def publish_caption(self, msg: dict) -> None:
        with contextlib.suppress(Exception):
            await self.room.local_participant.publish_data(encode(msg), reliable=True, topic=TOPIC_CAPTIONS)

    async def _publish_billing(self, remaining: int, warning: int | None = None) -> None:
        with contextlib.suppress(Exception):
            await self.room.local_participant.publish_data(
                encode(billing_message(remaining, warning)), reliable=True, topic=TOPIC_BILLING
            )

    async def _announce_all(self, text_for) -> None:
        """Annonce à chaque participant dans sa langue (par la session qui lui parle)."""
        jobs = []
        if self.cfg.face:
            tr = self.translators.get(IDENTITY_HOST)
            if tr:
                jobs.append(tr.announce(text_for(self.cfg.host_lang), self.cfg.host_lang))
        else:
            for listener, speaker_tr in ((IDENTITY_GUEST, IDENTITY_HOST), (IDENTITY_HOST, IDENTITY_GUEST)):
                tr = self.translators.get(speaker_tr)
                lang = self.cfg.lang_of(listener)
                if tr:
                    jobs.append(tr.announce(text_for(lang), lang))
        await asyncio.gather(*jobs, return_exceptions=True)

    async def _warn_low_balance(self, threshold: int, remaining: int) -> None:
        await self._publish_billing(remaining, threshold)
        self._spawn(self._announce_all(lambda lang: low_balance_text(lang, remaining)))

    async def _on_exhausted(self) -> None:
        await self._announce_all(no_credit_text)
        await asyncio.sleep(4.0)  # laisse le temps à l'annonce d'être entendue
        await self.end("no_credit")

    def _on_final(self, u: Utterance) -> None:
        if self.batcher:
            self.batcher.add(u)

    def _on_fatal(self, why: str) -> None:
        log.error("fatal: %s", why)
        self._spawn(self.end("error"))

    # ----------------------------------------------------------------- fin
    async def end(self, reason: str) -> None:
        if self.ended.is_set():
            return
        self.end_reason = reason if reason in END_REASONS else "error"
        log.info("ending call %s: %s", self.cfg.room_id, self.end_reason)
        self.ended.set()

    def default_end_reason(self) -> str:
        if self.end_reason:
            return self.end_reason
        if self._last_left:
            return f"{self._last_left}_hangup"
        return "timeout"

    async def finalize(self) -> None:
        """Idempotent. Tâche partagée et protégée : si l'entrypoint est annulé (salle fermée
        de l'extérieur), le callback d'arrêt attend la même tâche jusqu'au bout."""
        if self._final_task is None:
            self._final_task = asyncio.create_task(self._finalize(), name="finalize-call")
        await asyncio.shield(self._final_task)

    async def _finalize(self) -> None:
        reason = self.default_end_reason()
        if self.ticker:
            self.ticker.stop()
        for tr in list(self.translators.values()):
            with contextlib.suppress(Exception):
                await tr.aclose()
        if self.batcher:
            await self.batcher.close()
        if not self.store or self._already_closed:
            return
        try:
            await self.store.mark_ended(self.cfg.room_id, end_reason=reason, ended_at=utc_now_iso())
        except Exception:
            log.exception("mark_ended failed")
        await self._maybe_refund(reason)
        await self._summarize()

    async def _maybe_refund(self, reason: str) -> None:
        if not self.store or not self.host_id:
            return
        live_s = None if self.started_mono is None else time.monotonic() - self.started_mono
        if reason != "error" or (live_s is not None and live_s >= 60):
            return
        try:
            debited = await self.store.room_debited_seconds(self.cfg.room_id)
            seconds = refund_due(end_reason=reason, live_seconds=live_s, debited_seconds=debited)
            if seconds > 0:
                await self.store.insert_refund(
                    room_id=self.cfg.room_id, user_id=self.host_id, seconds=seconds, tick=REFUND_TICK
                )
                log.info("refunded %ds for room %s", seconds, self.cfg.room_id)
        except Exception:
            log.exception("refund failed")

    async def _summarize(self) -> None:
        if not self.store or not self.host_id or not self.settings.openai_api_key:
            return
        rows = self.batcher.transcript if self.batcher else []
        if not rows:
            with contextlib.suppress(Exception):
                rows = await self.store.fetch_utterances(self.cfg.room_id)
        if not rows:
            return
        try:
            summary, points = await asyncio.wait_for(
                generate_summary(rows, self.cfg.host_lang, model=self.settings.summary_model,
                                 api_key=self.settings.openai_api_key),
                timeout=45,
            )
            await self.store.insert_summary({
                "room_id": self.cfg.room_id, "host_id": self.host_id, "summary": summary,
                "key_points": points, "lang": self.cfg.host_lang,
            })
        except Exception:
            log.exception("summary failed")

    async def aclose(self) -> None:
        for t in list(self._tasks):
            t.cancel()
