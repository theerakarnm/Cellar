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

const DISCORD_WEBHOOK_PREFIXES = ["https://discord.com/api/webhooks/", "https://discordapp.com/api/webhooks/"];

export function isDiscordWebhookUrl(value: string): boolean {
  let href: string;
  try {
    href = new URL(value).href;
  } catch {
    return false;
  }
  return DISCORD_WEBHOOK_PREFIXES.some((prefix) => {
    if (!href.startsWith(prefix)) return false;
    const remainder = href.slice(prefix.length);
    return remainder.length > 0 && !remainder.startsWith("#") && !remainder.startsWith("?");
  });
}

export const lineCredentialSchema = z.strictObject({
  token: z.string().trim().min(1).max(512),
  to: z.string().trim().min(1).max(64),
});
export const discordCredentialSchema = z.strictObject({
  webhookUrl: z
    .string()
    .trim()
    .max(512)
    .refine(isDiscordWebhookUrl, "must start with https://discord.com/api/webhooks/ or https://discordapp.com/api/webhooks/")
    .transform((v) => new URL(v).href),
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
