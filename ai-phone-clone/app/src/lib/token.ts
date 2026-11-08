import { randomBytes } from "node:crypto";

/** 18 random bytes -> exactly 24 base64url characters (144 bits). */
export const LINK_TOKEN_LENGTH = 24;
const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;

export function generateLinkToken(): string {
  return randomBytes(18).toString("base64url");
}

export function isValidLinkToken(value: unknown): value is string {
  return typeof value === "string" && LINK_TOKEN_RE.test(value);
}
