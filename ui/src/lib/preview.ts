import type { RetentionPreview } from "../api/types";

export interface PreviewRow {
  id: string;
  startedAt: string;
  sizeBytes: number | null;
  reasons: string[];
}

/** Rows for the "would delete" list. Each row has the entry's own reason, plus any extra reasons the API maps to that backup id. */
export function deletionRows(preview: RetentionPreview): PreviewRow[] {
  return preview.delete.map((entry) => ({
    id: entry.id,
    startedAt: entry.startedAt,
    sizeBytes: entry.sizeBytes,
    reasons: [...new Set([entry.reason, ...(preview.reasons[entry.id] ?? [])])].map((reason) => reason.replaceAll("_", " ")),
  }));
}
