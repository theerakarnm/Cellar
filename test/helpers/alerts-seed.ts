import { encrypt } from "../../src/worker/lib/crypto";
import type { Env } from "../../src/worker/env";

export const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL";
const NOW = "2026-10-24T00:00:00.000Z";

export async function seedTarget(env: Env, id: string, over: Record<string, unknown> = {}) {
  const row = { id, name: `target-${id}`, db_name: "shop", connection_url_enc: "enc", tunnel_hostname: "db.example.com", tunnel_token_id_enc: "enc", tunnel_token_secret_enc: "enc", created_at: NOW, updated_at: NOW, ...over };
  const cols = Object.keys(row);
  await env.DB.prepare(`INSERT INTO targets (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...Object.values(row)).run();
}

export async function seedChannel(
  env: Env,
  id: string,
  targetId: string | null,
  over: { type?: "line" | "discord"; events?: string[]; enabled?: boolean; credential?: unknown } = {},
) {
  const type = over.type ?? "discord";
  const credential = over.credential ?? (type === "discord" ? { webhookUrl: WEBHOOK } : { token: "line-token-xyz", to: "U1234567890" });
  const enc = await encrypt(JSON.stringify(credential), env.ENCRYPTION_KEY);
  await env.DB.prepare(
    "INSERT INTO alert_channels (id,type,name,credential_enc,events,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).bind(id, type, `chan-${id}`, enc, JSON.stringify(over.events ?? ["backup_failed", "backup_stale", "backup_consecutive_failures"]), (over.enabled ?? true) ? 1 : 0, NOW, NOW).run();
  if (targetId) await env.DB.prepare("INSERT INTO target_alert_channels (target_id, channel_id) VALUES (?,?)").bind(targetId, id).run();
}

export async function seedBackup(env: Env, id: string, targetId: string, status: string, over: Record<string, unknown> = {}) {
  const row = { id, target_id: targetId, status, trigger: "schedule", queued_at: NOW, finished_at: "2026-10-24T07:05:00.000Z", ...over };
  const cols = Object.keys(row);
  await env.DB.prepare(`INSERT INTO backups (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...Object.values(row)).run();
}

export async function targetRow(env: Env, id: string) {
  return env.DB.prepare("SELECT consecutive_failures, failure_alerted_at, stale_alerted_at FROM targets WHERE id = ?").bind(id).first<{
    consecutive_failures: number;
    failure_alerted_at: string | null;
    stale_alerted_at: string | null;
  }>();
}
