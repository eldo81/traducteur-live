import "server-only";
import { NextResponse } from "next/server";
import { ConfigError } from "@/lib/env";

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "bad_request"
  | "payment_required"
  | "gone"
  | "conflict"
  | "rate_limited"
  | "not_configured"
  | "server_error";

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  bad_request: 400,
  payment_required: 402,
  gone: 410,
  conflict: 409,
  rate_limited: 429,
  not_configured: 503,
  server_error: 500,
};

export function apiError(code: ApiErrorCode, message?: string, init?: { headers?: Record<string, string>; extra?: object }) {
  return NextResponse.json(
    { error: code, message: message ?? code, ...(init?.extra ?? {}) },
    { status: STATUS[code], headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } },
  );
}

export function apiOk<T extends object>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Maps unknown errors to a JSON response without leaking internals. */
export function handleApiError(err: unknown) {
  if (err instanceof ConfigError) return apiError("not_configured", err.message);
  console.error("[api]", err instanceof Error ? err.message : err);
  return apiError("server_error", "Erreur serveur");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
