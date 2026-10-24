import { and, eq } from "drizzle-orm";
import {
  type AlertEvent,
  ALERT_EVENTS,
  discordCredentialSchema,
  lineCredentialSchema,
} from "../../shared/alerts";
import { getDb } from "../db/client";
import { alertChannels, targetAlertChannels } from "../db/schema";
import type { Env } from "../env";
import { decrypt } from "../lib/crypto";
import { sendDiscord } from "./discord";
import { sendLine } from "./line";
import type { DeliveryResult } from "./types";

interface StoredChannel {
  id: string;
  type: "line" | "discord";
  credentialEnc: string;
}

export async function sendToChannel(env: Env, channel: Pick<StoredChannel, "type" | "credentialEnc">, text: string): Promise<DeliveryResult> {
  let credential: unknown;
  try {
    credential = JSON.parse(await decrypt(channel.credentialEnc, env.ENCRYPTION_KEY));
  } catch {
    return { ok: false, error: "stored credential could not be decrypted" };
  }
  if (channel.type === "line") {
    const parsed = lineCredentialSchema.safeParse(credential);
    return parsed.success ? sendLine(parsed.data, text) : { ok: false, error: "stored credential is invalid" };
  }
  const parsed = discordCredentialSchema.safeParse(credential);
  return parsed.success ? sendDiscord(parsed.data, text) : { ok: false, error: "stored credential is invalid" };
}

function subscribes(eventsJson: string, event: AlertEvent): boolean {
  try {
    const events: unknown = JSON.parse(eventsJson);
    return Array.isArray(events) && events.some((e) => e === event && ALERT_EVENTS.includes(e));
  } catch {
    return false;
  }
}

async function channelsFor(env: Env, targetId: string, event: AlertEvent): Promise<StoredChannel[]> {
  const rows = await getDb(env)
    .select({
      id: alertChannels.id,
      type: alertChannels.type,
      credentialEnc: alertChannels.credentialEnc,
      events: alertChannels.events,
    })
    .from(targetAlertChannels)
    .innerJoin(alertChannels, eq(targetAlertChannels.channelId, alertChannels.id))
    .where(and(eq(targetAlertChannels.targetId, targetId), eq(alertChannels.enabled, true)));
  return rows.filter((row) => subscribes(row.events, event));
}

/** Sends `text` to every enabled channel linked to the target that subscribes to `event`. Never throws. */
export async function deliverAlert(env: Env, targetId: string, event: AlertEvent, text: string): Promise<void> {
  try {
    const channels = await channelsFor(env, targetId, event);
    await Promise.all(
      channels.map(async (channel) => {
        const result = await sendToChannel(env, channel, text);
        if (!result.ok) {
          console.warn(JSON.stringify({ msg: "alert delivery failed", channelId: channel.id, type: channel.type, event, error: result.error }));
        }
      }),
    );
  } catch {
    console.warn(JSON.stringify({ msg: "alert delivery crashed", targetId, event }));
  }
}
