import { createHash, randomUUID } from "node:crypto";

export function createMessageId() {
  return randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function summarizeConversation(lines: string[]) {
  const joined = compactWhitespace(lines.join(" "));
  return joined.slice(0, 500);
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
