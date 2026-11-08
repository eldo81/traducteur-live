import { apiError, handleApiError, isUuid } from "@/lib/api";
import { getServerSupabase, getUser } from "@/lib/supabase/server";
import { formatTranscriptTxt } from "@/lib/transcript";

/** GET /api/rooms/:id/transcript.txt : plain-text export, owner only (RLS). */
export async function GET(_req: Request, ctx: RouteContext<"/api/rooms/[id]/transcript.txt">) {
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return apiError("not_found");

    const supabase = await getServerSupabase();
    const user = await getUser(supabase);
    if (!user) return apiError("unauthorized");

    const { data: room, error } = await supabase
      .from("call_rooms")
      .select("id, host_id, host_lang, guest_lang, created_at, started_at, ended_at, billed_seconds")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!room || room.host_id !== user.id) return apiError("not_found");

    const [{ data: utterances, error: uErr }, { data: summary }] = await Promise.all([
      supabase
        .from("utterances")
        .select("speaker, lang_src, text_src, lang_dst, text_dst, started_at, seq")
        .eq("room_id", id)
        .order("seq", { ascending: true }),
      supabase.from("call_summaries").select("summary, key_points").eq("room_id", id).maybeSingle(),
    ]);
    if (uErr) throw uErr;

    const text = formatTranscriptTxt(room, utterances ?? [], summary);
    const date = (room.started_at ?? room.created_at).slice(0, 10);
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="transcription-${date}-${id.slice(0, 8)}.txt"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
