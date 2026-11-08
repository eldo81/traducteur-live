"""Facturation par tranche de 15 s, pause en silence, alertes de solde, remboursement."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

from .config import TICK_SECONDS

log = logging.getLogger("interprete.billing")

WARN_THRESHOLDS = (120, 30)      # secondes restantes : alerte (événement + annonce vocale)
SILENCE_PAUSE_S = 30.0           # plus de parole depuis 30 s des deux côtés : facturation en pause
REFUND_WINDOW_S = 60.0           # appel terminé sur erreur dans sa 1re minute : remboursé
REFUND_TICK = -1                 # n° de tranche réservé à la ligne de remboursement (unique(room_id, tick))
MAX_DEBIT_FAILURES = 5


class ActivityTracker:
    """Sait si quelqu'un a parlé dans les 30 dernières secondes (VAD serveur des sessions)."""

    def __init__(self, window_s: float = SILENCE_PAUSE_S, clock: Callable[[], float] = time.monotonic):
        self._window = window_s
        self._clock = clock
        self._speaking: set[str] = set()
        self._last_speech: float | None = None
        self.changed = asyncio.Event()

    def speech_started(self, who: str) -> None:
        self._speaking.add(who)
        self._last_speech = self._clock()
        self.changed.set()

    def speech_stopped(self, who: str) -> None:
        self._speaking.discard(who)
        self._last_speech = self._clock()
        self.changed.set()

    def recently_active(self) -> bool:
        if self._speaking:
            return True
        if self._last_speech is None:
            return False
        return self._clock() - self._last_speech <= self._window


def thresholds_crossed(remaining: int, already: set[int], thresholds=WARN_THRESHOLDS) -> int | None:
    """Renvoie le seuil à annoncer maintenant (le plus bas franchi, une seule fois), sinon None."""
    crossed = [t for t in thresholds if remaining < t and t not in already]
    if not crossed:
        return None
    lowest = min(crossed)
    # les seuils plus hauts franchis en même temps sont considérés comme annoncés
    already.update(t for t in thresholds if remaining < t)
    return lowest


class BillingTicker:
    """Débite une tranche, attend 15 s, recommence, tant que l'appel est facturable.

    `is_billable()` = les deux participants sont là ET quelqu'un a parlé dans les 30 s.
    Le débit est payé d'avance : la tranche n est débitée au début de ses 15 s. Si le
    RPC renvoie -1 (solde insuffisant), `on_exhausted()` est appelé et la boucle s'arrête.
    """

    def __init__(
        self,
        *,
        debit: Callable[[int, int], Awaitable[int]],
        is_billable: Callable[[], bool],
        on_remaining: Callable[[int], Awaitable[None]],
        on_warning: Callable[[int, int], Awaitable[None]],
        on_exhausted: Callable[[], Awaitable[None]],
        on_failure: Callable[[], Awaitable[None]] | None = None,
        wake: asyncio.Event | None = None,
        tick_seconds: int = TICK_SECONDS,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        retry_delay: float = 3.0,
        poll_interval: float = 1.0,
    ):
        self._debit = debit
        self._is_billable = is_billable
        self._on_remaining = on_remaining
        self._on_warning = on_warning
        self._on_exhausted = on_exhausted
        self._on_failure = on_failure
        self._wake = wake or asyncio.Event()
        self._tick_seconds = tick_seconds
        self._sleep = sleep
        self._retry_delay = retry_delay
        self._poll = poll_interval
        self.next_tick = 0
        self.debited_ticks = 0
        self.remaining: int | None = None
        self.exhausted = False
        self.failures = 0
        self._warned: set[int] = set()
        self._stopped = False

    @property
    def billed_seconds(self) -> int:
        return self.debited_ticks * self._tick_seconds

    def stop(self) -> None:
        self._stopped = True
        self._wake.set()

    async def step(self) -> bool:
        """Une tranche. Renvoie False quand la facturation doit s'arrêter."""
        try:
            remaining = await self._debit(self.next_tick, self._tick_seconds)
        except Exception:
            self.failures += 1
            log.exception("debit_call_tick failed (attempt %d)", self.failures)
            if self.failures >= MAX_DEBIT_FAILURES:
                if self._on_failure:
                    await self._on_failure()
                return False
            return True  # même tranche réessayée (le RPC est idempotent par (room, tick))
        self.failures = 0
        if remaining < 0:
            self.exhausted = True
            self.remaining = 0
            await self._on_remaining(0)
            await self._on_exhausted()
            return False
        self.next_tick += 1
        self.debited_ticks += 1
        self.remaining = remaining
        await self._on_remaining(remaining)
        t = thresholds_crossed(remaining, self._warned)
        if t is not None:
            await self._on_warning(t, remaining)
        return True

    async def _wait_billable(self) -> None:
        while not self._stopped and not self._is_billable():
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=self._poll)
            except asyncio.TimeoutError:
                pass

    async def run(self) -> None:
        while not self._stopped:
            await self._wait_billable()
            if self._stopped:
                return
            before = self.failures
            if not await self.step():
                return
            await self._sleep(self._retry_delay if self.failures > before else self._tick_seconds)


def refund_due(*, end_reason: str, live_seconds: float | None, debited_seconds: int) -> int:
    """Secondes à rembourser : appel fini sur erreur pendant sa première minute."""
    if end_reason != "error" or debited_seconds <= 0:
        return 0
    if live_seconds is not None and live_seconds >= REFUND_WINDOW_S:
        return 0
    return debited_seconds
