"""Agent « interprete » : traduction simultanée d'un appel LiveKit (hôte <-> invité, ou face-à-face).

Lancement :
    python agent.py dev     # développement (rechargement, logs verbeux)
    python agent.py start   # production (Fly.io)
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from dotenv import load_dotenv
from livekit.agents import AgentServer, AutoSubscribe, JobContext, JobRequest, cli

from interprete.call import CallController
from interprete.config import AGENT_NAME, load_settings
from interprete.metadata import MetadataError, parse_room_config
from interprete.store import SupabaseStore

load_dotenv()
log = logging.getLogger("interprete")

server = AgentServer()


async def on_request(req: JobRequest) -> None:
    # identité par défaut "agent-<job id>" : jamais "host"/"guest", donc jamais écoutée
    await req.accept(name="Interprète")


@server.rtc_session(agent_name=AGENT_NAME, on_request=on_request)
async def entrypoint(ctx: JobContext) -> None:
    settings = load_settings()
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    try:
        cfg = parse_room_config(ctx.room.metadata, ctx.job.metadata, room_name=ctx.room.name)
    except MetadataError as e:
        log.error("bad room metadata for %s: %s", ctx.room.name, e)
        ctx.shutdown("bad metadata")
        return

    store = SupabaseStore(settings.supabase_url, settings.supabase_service_role_key) if settings.supabase_enabled else None
    call = CallController(room=ctx.room, cfg=cfg, settings=settings, store=store)

    async def _cleanup(reason: str) -> None:
        # salle fermée de l'extérieur (raccroché côté web, emptyTimeout...) : on clôt quand même
        try:
            await call.finalize()
        finally:
            await call.aclose()
            if store:
                await store.aclose()

    ctx.add_shutdown_callback(_cleanup)

    try:
        await call.setup()
        await call.ended.wait()
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("call crashed")
        await call.end("error")

    await call.finalize()
    with contextlib.suppress(Exception):
        await ctx.delete_room()   # déconnecte proprement host et guest
    ctx.shutdown(call.default_end_reason())


if __name__ == "__main__":
    cli.run_app(server)
