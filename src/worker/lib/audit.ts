import { auditLogs } from "../db/schema";
import type { Db } from "../db/client";
import { redactSecrets } from "./redact";
import { uuidv7 } from "./uuidv7";

export type AuditEntry = {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: unknown;
  ip?: string | null;
};

/** The insert statement, for callers that commit it in the same `db.batch` as the change it records. */
export function auditInsert(db: Db, entry: AuditEntry) {
  return db.insert(auditLogs).values({
    id: uuidv7(),
    at: new Date().toISOString(),
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    details: entry.details === undefined ? null : redactSecrets(JSON.stringify(entry.details)),
    ip: entry.ip ?? null,
  });
}

export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await auditInsert(db, entry);
}
