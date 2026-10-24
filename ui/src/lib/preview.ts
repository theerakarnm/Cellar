import type { Backup, RetentionPreview } from "../api/types";

export interface PreviewRow {
  id: string;
  backup: Backup | undefined;
  reasons: string[];
}

/** Rows for the "would delete" list; `backup` is undefined when the row is not on a loaded page of history. */
export function deletionRows(preview: RetentionPreview, loaded: readonly Backup[]): PreviewRow[] {
  return preview.delete.map((entry) => ({
    id: entry.id,
    backup: loaded.find((b) => b.id === entry.id),
    reasons: preview.reasons[entry.id] ?? [],
  }));
}
