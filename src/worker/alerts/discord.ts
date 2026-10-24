import { isDiscordWebhookUrl, type DiscordCredential } from "../../shared/alerts";
import { truncate } from "./message";
import { type DeliveryResult, REQUEST_TIMEOUT_MS } from "./types";

const DISCORD_CONTENT_MAX = 2000;

export async function sendDiscord(credential: DiscordCredential, text: string): Promise<DeliveryResult> {
  if (!isDiscordWebhookUrl(credential.webhookUrl)) return { ok: false, error: "Discord webhook URL is not allowed" };
  try {
    const response = await fetch(credential.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: truncate(text, DISCORD_CONTENT_MAX),
        allowed_mentions: { parse: [] },
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok ? { ok: true } : { ok: false, error: `Discord webhook returned HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "Discord request failed (network error)" };
  }
}
