"""Écriture des phrases finalisées par lots (~2 s)."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from .captions import Utterance

log = logging.getLogger("interprete.persistence")

MAX_PENDING = 1000


class UtteranceBatcher:
    def __init__(
        self,
        *,
        room_id: str,
        host_id: str,
        insert: Callable[[list[dict]], Awaitable[None]],
        interval_s: float = 2.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self.room_id = room_id
        self.host_id = host_id
        self._insert = insert
        self._interval = interval_s
        self._sleep = sleep
        self._pending: list[dict] = []
        self._seen: set[int] = set()
        self._lock = asyncio.Lock()
        self._stopped = False
        self.written = 0
        self.transcript: list[dict] = []   # copie locale pour le résumé de fin d'appel

    def add(self, utt: Utterance) -> bool:
        if not utt.persistable() or utt.seq in self._seen:
            return False
        self._seen.add(utt.seq)
        row = utt.to_row(self.room_id, self.host_id)
        self._pending.append(row)
        self.transcript.append(row)
        if len(self._pending) > MAX_PENDING:
            dropped = len(self._pending) - MAX_PENDING
            log.error("utterance backlog too large, dropping %d oldest rows", dropped)
            self._pending = self._pending[dropped:]
        return True

    @property
    def pending(self) -> int:
        return len(self._pending)

    async def flush(self) -> int:
        async with self._lock:
            if not self._pending:
                return 0
            batch = sorted(self._pending, key=lambda r: r["seq"])
            try:
                await self._insert(batch)
            except Exception:
                log.exception("utterance insert failed, will retry (%d rows)", len(batch))
                return 0
            sent = {r["seq"] for r in batch}
            self._pending = [r for r in self._pending if r["seq"] not in sent]
            self.written += len(batch)
            return len(batch)

    async def run(self) -> None:
        while not self._stopped:
            await self._sleep(self._interval)
            await self.flush()

    async def close(self, attempts: int = 3) -> None:
        self._stopped = True
        for _ in range(attempts):
            await self.flush()
            if not self._pending:
                return
            await asyncio.sleep(0.5)
