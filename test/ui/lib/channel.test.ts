import { describe, expect, it } from "vitest";
import { channelPayload, channelToForm, emptyChannelForm } from "../../../ui/src/lib/channel";
import type { AlertChannel } from "../../../ui/src/api/types";

describe("channelPayload", () => {
  it("builds a discord create body", () => {
    const form = { ...emptyChannelForm(), name: "ops", webhookUrl: "https://discord.com/api/webhooks/1/x" };
    expect(channelPayload(form, "create")).toEqual({
      body: { name: "ops", enabled: true, events: ["backup_failed", "backup_consecutive_failures", "backup_stale"], type: "discord", credential: { webhookUrl: "https://discord.com/api/webhooks/1/x" } },
    });
  });

  it("builds a line create body", () => {
    const form = { ...emptyChannelForm(), type: "line" as const, name: "line", token: "tok", to: "U123" };
    const built = channelPayload(form, "create");
    expect("body" in built && built.body.credential).toEqual({ token: "tok", to: "U123" });
  });

  it("rejects missing or malformed input", () => {
    expect(channelPayload({ ...emptyChannelForm(), name: " " }, "create")).toEqual({ error: "Name is required" });
    expect(channelPayload({ ...emptyChannelForm(), name: "a", events: [] }, "create")).toEqual({ error: "Pick at least one event" });
    expect(channelPayload({ ...emptyChannelForm(), type: "line", name: "a", token: "t" }, "create")).toEqual({ error: "LINE needs a channel access token and a recipient id" });
  });

  it("accepts only the two Discord webhook hosts", () => {
    const error = "Discord webhook URL must start with https://discord.com/api/webhooks/ or https://discordapp.com/api/webhooks/";
    const build = (webhookUrl: string) => channelPayload({ ...emptyChannelForm(), name: "a", webhookUrl }, "create");
    expect(build("https://discordapp.com/api/webhooks/1/x")).toHaveProperty("body");
    for (const bad of ["http://discord.com/api/webhooks/1/x", "https://discord.example.com/api/webhooks/1/x", "https://discord.com.evil.test/api/webhooks/1/x", "https://discord.com/api/other", "https://discord.com/api/webhooks/"]) {
      expect(build(bad)).toEqual({ error });
    }
  });

  it("omits the credential on edit unless it is replaced", () => {
    const channel: AlertChannel = { id: "c1", type: "discord", name: "ops", events: ["backup_failed"], enabled: false, hasCredential: true, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
    const form = channelToForm(channel);
    const built = channelPayload(form, "edit");
    expect(built).toEqual({ body: { name: "ops", enabled: false, events: ["backup_failed"] } });
  });
});
