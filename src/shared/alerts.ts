import { z } from "zod";

export const ALERT_EVENTS = [
  "backup_failed",
  "backup_stale",
  "backup_consecutive_failures",
  "retention_failed",
  "restore_finished",
] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

/** Events that Phase 8 emits. A new channel subscribes to these unless the request says otherwise. */
export const DEFAULT_CHANNEL_EVENTS: AlertEvent[] = ["backup_failed", "backup_stale", "backup_consecutive_failures"];

const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com"]);
const DISCORD_PATH = /^\/api(\/v\d+)?\/webhooks\//;

export function isDiscordWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && DISCORD_HOSTS.has(url.hostname) && DISCORD_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

export const lineCredentialSchema = z.strictObject({
  token: z.string().trim().min(1).max(512),
  to: z.string().trim().min(1).max(64),
});
export const discordCredentialSchema = z.strictObject({
  webhookUrl: z.string().trim().max(512).refine(isDiscordWebhookUrl, "must start with https://discord.com/api/webhooks/ or https://discordapp.com/api/webhooks/"),
});
export type LineCredential = z.infer<typeof lineCredentialSchema>;
export type DiscordCredential = z.infer<typeof discordCredentialSchema>;

const nameSchema = z.string().trim().min(1).max(100);
const eventsSchema = z
  .array(z.enum(ALERT_EVENTS))
  .min(1)
  .refine((events) => new Set(events).size === events.length, "events must be unique");

export const createChannelSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("line"),
    name: nameSchema,
    events: eventsSchema.default(DEFAULT_CHANNEL_EVENTS),
    enabled: z.boolean().default(true),
    credential: lineCredentialSchema,
  }),
  z.strictObject({
    type: z.literal("discord"),
    name: nameSchema,
    events: eventsSchema.default(DEFAULT_CHANNEL_EVENTS),
    enabled: z.boolean().default(true),
    credential: discordCredentialSchema,
  }),
]);

/** `credential` is checked against the stored channel type inside the route. */
export const updateChannelSchema = z.strictObject({
  name: nameSchema.optional(),
  events: eventsSchema.optional(),
  enabled: z.boolean().optional(),
  credential: z.unknown().optional(),
});
