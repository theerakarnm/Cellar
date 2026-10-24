import { describe, expect, it } from "vitest";
import {
  createChannelSchema,
  DEFAULT_CHANNEL_EVENTS,
  isDiscordWebhookUrl,
  updateChannelSchema,
} from "../../src/shared/alerts";

const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL";

describe("isDiscordWebhookUrl", () => {
  it("accepts discord webhook URLs on both hosts", () => {
    expect(isDiscordWebhookUrl(WEBHOOK)).toBe(true);
    expect(isDiscordWebhookUrl("https://discordapp.com/api/webhooks/1/tok")).toBe(true);
  });

  it("accepts benign normalizations that produce a conforming href", () => {
    expect(isDiscordWebhookUrl("HTTPS://DISCORD.COM/api/webhooks/1/tok")).toBe(true);
    expect(isDiscordWebhookUrl("https://DISCORDAPP.com/api/webhooks/1/tok")).toBe(true);
    expect(isDiscordWebhookUrl("https:\\\\discord.com\\api\\webhooks\\1\\tok")).toBe(true);
  });

  it("rejects userinfo, explicit ports, and non-listed paths such as /api/v10/", () => {
    for (const url of [
      "https://user:pw@discord.com/api/webhooks/1/tok",
      "https://user@discord.com/api/webhooks/1/tok",
      "https://discord.com:8443/api/webhooks/1/tok",
      "https://discord.com:0/api/webhooks/1/tok",
      "https://discord.com/api/v10/webhooks/1/tok",
      "https://discordapp.com/api/v9/webhooks/1/tok",
    ]) {
      expect(isDiscordWebhookUrl(url)).toBe(false);
    }
  });

  it("rejects a non-empty remainder that is only a fragment or a query", () => {
    expect(isDiscordWebhookUrl("https://discord.com/api/webhooks/#frag")).toBe(false);
    expect(isDiscordWebhookUrl("https://discord.com/api/webhooks/?x=1")).toBe(false);
    expect(isDiscordWebhookUrl("https://discord.com/#/api/webhooks/1/tok")).toBe(false);
  });

  it("rejects an empty id/token after the prefix", () => {
    expect(isDiscordWebhookUrl("https://discord.com/api/webhooks/")).toBe(false);
    expect(isDiscordWebhookUrl("https://discordapp.com/api/webhooks/")).toBe(false);
  });

  it("rejects http, double slash in the host, and a trailing dot host", () => {
    expect(isDiscordWebhookUrl("http://discord.com/api/webhooks/1/tok")).toBe(false);
    expect(isDiscordWebhookUrl("https://discord.com//api/webhooks/1/tok")).toBe(false);
    expect(isDiscordWebhookUrl("https://discord.com./api/webhooks/1/tok")).toBe(false);
  });

  it("rejects other hosts, schemes, and paths", () => {
    for (const url of [
      "http://discord.com/api/webhooks/1/tok",
      "https://evil.example.com/api/webhooks/1/tok",
      "https://discord.com.evil.example.com/api/webhooks/1/tok",
      "https://canary.discord.com/api/webhooks/1/tok",
      "https://discord.com/channels/1/2",
      "not a url",
    ]) {
      expect(isDiscordWebhookUrl(url)).toBe(false);
    }
  });
});

describe("createChannelSchema", () => {
  it("parses a LINE channel and fills defaults", () => {
    const parsed = createChannelSchema.parse({ type: "line", name: "Ops", credential: { token: "tok", to: "U123" } });
    expect(parsed.events).toEqual(DEFAULT_CHANNEL_EVENTS);
    expect(parsed.enabled).toBe(true);
  });

  it("parses a Discord channel", () => {
    const parsed = createChannelSchema.parse({ type: "discord", name: "Ops", credential: { webhookUrl: WEBHOOK } });
    expect(parsed.type).toBe("discord");
  });

  it("stores a Discord webhook URL as the normalized href", () => {
    const parsed = createChannelSchema.parse({ type: "discord", name: "Ops", credential: { webhookUrl: "HTTPS://DISCORD.COM\\api\\webhooks\\1\\tok" } });
    if (parsed.type !== "discord") throw new Error("parsed as the wrong channel type");
    expect(parsed.credential.webhookUrl).toBe("https://discord.com/api/webhooks/1/tok");
  });

  it("rejects a credential shaped for the other type", () => {
    expect(createChannelSchema.safeParse({ type: "line", name: "Ops", credential: { webhookUrl: WEBHOOK } }).success).toBe(false);
    expect(createChannelSchema.safeParse({ type: "discord", name: "Ops", credential: { token: "t", to: "U" } }).success).toBe(false);
  });

  it("rejects unknown events, empty events, and duplicate events", () => {
    const base = { type: "line", name: "Ops", credential: { token: "t", to: "U" } };
    expect(createChannelSchema.safeParse({ ...base, events: ["nope"] }).success).toBe(false);
    expect(createChannelSchema.safeParse({ ...base, events: [] }).success).toBe(false);
    expect(createChannelSchema.safeParse({ ...base, events: ["backup_failed", "backup_failed"] }).success).toBe(false);
  });
});

describe("updateChannelSchema", () => {
  it("accepts a partial update and rejects unknown keys", () => {
    expect(updateChannelSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(updateChannelSchema.safeParse({ type: "discord" }).success).toBe(false);
  });
});
