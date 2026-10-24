import type { LineCredential } from "../../shared/alerts";
import { truncate } from "./message";
import { type DeliveryResult, REQUEST_TIMEOUT_MS } from "./types";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_TEXT_MAX = 5000;

export async function sendLine(credential: LineCredential, text: string): Promise<DeliveryResult> {
  try {
    const response = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${credential.token}`, "content-type": "application/json" },
      body: JSON.stringify({ to: credential.to, messages: [{ type: "text", text: truncate(text, LINE_TEXT_MAX) }] }),
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok ? { ok: true } : { ok: false, error: `LINE API returned HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "LINE request failed (network error)" };
  }
}
