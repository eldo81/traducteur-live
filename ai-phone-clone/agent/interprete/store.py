"""Accès Supabase (PostgREST) avec la clé service_role, via httpx. Jamais exposée au client."""

from __future__ import annotations

import logging
from typing import Any

import httpx

log = logging.getLogger("interprete.store")


class StoreError(RuntimeError):
    pass


class SupabaseStore:
    def __init__(self, url: str, service_role_key: str, *, client: httpx.AsyncClient | None = None, timeout: float = 8.0):
        if not url or not service_role_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self._base = url.rstrip("/") + "/rest/v1"
        self._headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }
        self._client = client or httpx.AsyncClient(timeout=timeout)
        self._owns_client = client is None

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _req(self, method: str, path: str, *, params=None, json=None, prefer: str | None = None) -> Any:
        headers = dict(self._headers)
        if prefer:
            headers["Prefer"] = prefer
        r = await self._client.request(method, f"{self._base}/{path}", params=params, json=json, headers=headers)
        if r.status_code >= 400:
            raise StoreError(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
        if not r.content:
            return None
        try:
            return r.json()
        except ValueError:
            return r.text

    # --- facturation -------------------------------------------------------
    async def debit_call_tick(self, room_id: str, tick: int, seconds: int = 15) -> int:
        data = await self._req(
            "POST", "rpc/debit_call_tick", json={"p_room": room_id, "p_tick": tick, "p_seconds": seconds}
        )
        if isinstance(data, list):  # certains proxys enveloppent le scalaire
            data = data[0] if data else None
        if isinstance(data, dict):
            data = next(iter(data.values()), None)
        try:
            return int(data)
        except (TypeError, ValueError) as e:
            raise StoreError(f"unexpected debit_call_tick result: {data!r}") from e

    async def room_debited_seconds(self, room_id: str) -> int:
        rows = await self._req(
            "GET", "credit_ledger",
            params={"room_id": f"eq.{room_id}", "reason": "eq.call", "select": "delta_seconds"},
        )
        return -sum(int(r["delta_seconds"]) for r in rows or [] if int(r["delta_seconds"]) < 0)

    async def insert_refund(self, *, room_id: str, user_id: str, seconds: int, tick: int) -> None:
        """Une seule ligne par salle grâce à unique(room_id, tick) avec tick réservé."""
        await self._req(
            "POST", "credit_ledger",
            params={"on_conflict": "room_id,tick"},
            json={"user_id": user_id, "delta_seconds": seconds, "reason": "refund", "room_id": room_id, "tick": tick},
            prefer="resolution=ignore-duplicates,return=minimal",
        )

    # --- salle -------------------------------------------------------------
    async def get_room(self, room_id: str) -> dict | None:
        rows = await self._req(
            "GET", "call_rooms",
            params={"id": f"eq.{room_id}", "select": "id,host_id,status,started_at,ended_at,host_lang,guest_lang"},
        )
        return rows[0] if rows else None

    async def mark_live(self, room_id: str, started_at: str) -> None:
        try:
            await self._req(
                "PATCH", "call_rooms",
                params={"id": f"eq.{room_id}", "started_at": "is.null", "status": "in.(waiting,live)"},
                json={"status": "live", "started_at": started_at}, prefer="return=minimal",
            )
        except StoreError as e:
            # ex. index one_live_call_per_host : on garde au moins l'heure de début
            log.warning("mark_live failed (%s), setting started_at only", e)
            await self._req(
                "PATCH", "call_rooms",
                params={"id": f"eq.{room_id}", "started_at": "is.null"},
                json={"started_at": started_at}, prefer="return=minimal",
            )

    async def mark_ended(self, room_id: str, *, end_reason: str, ended_at: str) -> None:
        # ne réécrit pas une salle déjà close par l'app web (POST /api/rooms/:id/end)
        await self._req(
            "PATCH", "call_rooms",
            params={"id": f"eq.{room_id}", "status": "in.(waiting,live)"},
            json={"status": "ended", "end_reason": end_reason, "ended_at": ended_at}, prefer="return=minimal",
        )

    # --- transcription -----------------------------------------------------
    async def max_utterance_seq(self, room_id: str) -> int:
        rows = await self._req(
            "GET", "utterances",
            params={"room_id": f"eq.{room_id}", "select": "seq", "order": "seq.desc", "limit": "1"},
        )
        return int(rows[0]["seq"]) if rows else -1

    async def insert_utterances(self, rows: list[dict]) -> None:
        if not rows:
            return
        await self._req(
            "POST", "utterances", params={"on_conflict": "room_id,seq"}, json=rows,
            prefer="resolution=ignore-duplicates,return=minimal",
        )

    async def fetch_utterances(self, room_id: str) -> list[dict]:
        return await self._req(
            "GET", "utterances",
            params={"room_id": f"eq.{room_id}", "select": "speaker,lang_src,text_src,lang_dst,text_dst,seq", "order": "seq.asc"},
        ) or []

    async def insert_summary(self, row: dict) -> None:
        await self._req(
            "POST", "call_summaries", params={"on_conflict": "room_id"}, json=row,
            prefer="resolution=ignore-duplicates,return=minimal",
        )
