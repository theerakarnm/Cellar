import { connectionFor, probeServer, type JobContext } from "./context";

export async function runTest(ctx: JobContext): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const probe = await probeServer(ctx, connectionFor(ctx.job));
  return {
    pgServerVersion: probe.pgServerVersion,
    dbSizeBytes: probe.dbSizeBytes,
    hasReadAllData: probe.hasReadAllData,
    durationMs: Date.now() - startedAt,
  };
}
