import { isDiscordWebhookUrl } from "../../../src/shared/alerts";
import type { AlertChannel, ChannelEvent, ChannelType } from "../api/types";

export const CHANNEL_EVENTS: { value: ChannelEvent; label: string }[] = [
  { value: "backup_failed", label: "Backup failed" },
  { value: "backup_consecutive_failures", label: "Consecutive failures" },
  { value: "backup_stale", label: "No recent successful backup" },
];

export interface ChannelForm {
  type: ChannelType;
  name: string;
  enabled: boolean;
  events: ChannelEvent[];
  replaceCredential: boolean;
  token: string;
  to: string;
  webhookUrl: string;
}

export function emptyChannelForm(): ChannelForm {
  return {
    type: "discord",
    name: "",
    enabled: true,
    events: ["backup_failed", "backup_consecutive_failures", "backup_stale"],
    replaceCredential: true,
    token: "",
    to: "",
    webhookUrl: "",
  };
}

export function channelToForm(channel: AlertChannel): ChannelForm {
  return { ...emptyChannelForm(), type: channel.type, name: channel.name, enabled: channel.enabled, events: channel.events, replaceCredential: false };
}

/** Credentials are only sent on create or when the user replaces the stored one. Returns an error message or the request body. */
export function channelPayload(form: ChannelForm, mode: "create" | "edit"): { error: string } | { body: Record<string, unknown> } {
  if (form.name.trim() === "") return { error: "Name is required" };
  if (form.events.length === 0) return { error: "Pick at least one event" };
  const body: Record<string, unknown> = { name: form.name.trim(), enabled: form.enabled, events: form.events };
  if (mode === "create") body.type = form.type;
  if (mode === "create" || form.replaceCredential) {
    if (form.type === "line") {
      if (form.token.trim() === "" || form.to.trim() === "") return { error: "LINE needs a channel access token and a recipient id" };
      body.credential = { token: form.token.trim(), to: form.to.trim() };
    } else if (!isDiscordWebhookUrl(form.webhookUrl.trim())) {
      return { error: "Discord webhook URL must start with https://discord.com/api/webhooks/ or https://discordapp.com/api/webhooks/" };
    } else {
      body.credential = { webhookUrl: form.webhookUrl.trim() };
    }
  }
  return { body };
}
