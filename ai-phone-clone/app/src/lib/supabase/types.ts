/**
 * Hand-written types for supabase/migrations/0001_init.sql.
 * TODO: replace with `supabase gen types typescript` once the project exists.
 */
type Ts = string;

type Table<Row, Insert> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: [];
}

export type RoomStatus = "waiting" | "live" | "ended" | "expired";
export type EndReason = "host_hangup" | "guest_hangup" | "no_credit" | "timeout" | "error";

export type ProfileRow = {
  user_id: string;
  display_name: string | null;
  app_language: "fr" | "en";
  default_my_lang: string;
  default_other_lang: string;
  default_voice: string;
  low_balance_alert_seconds: number;
  created_at: Ts;
  updated_at: Ts;
}

export type CallRoomRow = {
  id: string;
  host_id: string;
  link_token: string;
  mode: "voice" | "video";
  host_lang: string;
  guest_lang: string;
  host_voice: string;
  guest_voice: string;
  mute_original_host: boolean;
  mute_original_guest: boolean;
  status: RoomStatus;
  end_reason: EndReason | null;
  expires_at: Ts;
  started_at: Ts | null;
  ended_at: Ts | null;
  billed_seconds: number;
  created_at: Ts;
  updated_at: Ts;
}

export type ParticipantRow = {
  id: string;
  room_id: string;
  role: "host" | "guest";
  user_id: string | null;
  display_name: string | null;
  user_agent: string | null;
  in_app_browser: boolean;
  joined_at: Ts;
  left_at: Ts | null;
  created_at: Ts;
  updated_at: Ts;
}

export type UtteranceRow = {
  id: string;
  room_id: string;
  host_id: string;
  speaker: "host" | "guest";
  lang_src: string;
  text_src: string;
  lang_dst: string;
  text_dst: string;
  started_at: Ts;
  ended_at: Ts | null;
  seq: number;
  created_at: Ts;
  updated_at: Ts;
}

export type CallSummaryRow = {
  id: string;
  room_id: string;
  host_id: string;
  summary: string;
  key_points: unknown;
  lang: string;
  created_at: Ts;
  updated_at: Ts;
}

export type PurchaseRowDb = {
  id: string;
  user_id: string;
  provider: "stripe" | "paydunya" | "cinetpay" | "apple" | "google" | "manual";
  provider_ref: string;
  pack_code: string;
  seconds: number;
  amount_cents: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "refunded";
  created_at: Ts;
  updated_at: Ts;
}

export type CreditLedgerRow = {
  id: string;
  user_id: string;
  delta_seconds: number;
  reason: "signup_gift" | "purchase" | "call" | "face_to_face" | "refund" | "adjustment";
  purchase_id: string | null;
  room_id: string | null;
  tick: number | null;
  created_at: Ts;
  updated_at: Ts;
}

type Opt<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, Opt<ProfileRow, "display_name" | "app_language" | "default_my_lang" | "default_other_lang" | "default_voice" | "low_balance_alert_seconds" | "created_at" | "updated_at">>;
      call_rooms: Table<
        CallRoomRow,
        Opt<
          CallRoomRow,
          | "id"
          | "mode"
          | "host_voice"
          | "guest_voice"
          | "mute_original_host"
          | "mute_original_guest"
          | "status"
          | "end_reason"
          | "expires_at"
          | "started_at"
          | "ended_at"
          | "billed_seconds"
          | "created_at"
          | "updated_at"
        >
      >;
      participants: Table<
        ParticipantRow,
        Opt<ParticipantRow, "id" | "user_id" | "display_name" | "user_agent" | "in_app_browser" | "joined_at" | "left_at" | "created_at" | "updated_at">
      >;
      utterances: Table<UtteranceRow, Opt<UtteranceRow, "id" | "ended_at" | "created_at" | "updated_at">>;
      call_summaries: Table<CallSummaryRow, Opt<CallSummaryRow, "id" | "key_points" | "created_at" | "updated_at">>;
      purchases: Table<PurchaseRowDb, Opt<PurchaseRowDb, "id" | "status" | "created_at" | "updated_at">>;
      credit_ledger: Table<CreditLedgerRow, Opt<CreditLedgerRow, "id" | "purchase_id" | "room_id" | "tick" | "created_at" | "updated_at">>;
    };
    Views: {
      credit_balances: {
        Row: { user_id: string; balance_seconds: number };
        Relationships: [];
      };
    };
    Functions: {
      debit_call_tick: {
        Args: { p_room: string; p_tick: number; p_seconds: number };
        Returns: number;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
