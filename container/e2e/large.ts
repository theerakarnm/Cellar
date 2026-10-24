// Memory proof: back up a ~2 GB database with the runner limited to RUNNER_MEM_LIMIT (default 256m). Needs Docker and ~10 GB free disk.
//   bun container/e2e/large.ts
// Overrides (diagnosis only, not the proof): RUNNER_MEM_LIMIT=512m, PART_MIB=16
import { baseJob, check, compose, objectDigest, psql, r2Block, runRunner, sh, startCallbackListener, startStack } from "./support";

const memLimit = process.env.RUNNER_MEM_LIMIT ?? "256m";
const partMiB = Number(process.env.PART_MIB ?? 32);
const limitMiB = Number.parseInt(memLimit, 10);
const container = "cellar-test-large-runner";
// docker stats prints decimal units (MB, GB) for some sizes and binary ones (MiB, GiB) for others.
const UNIT_BYTES: Record<string, number> = { B: 1, kB: 1e3, KiB: 1024, MB: 1e6, MiB: 1024 ** 2, GB: 1e9, GiB: 1024 ** 3 };

const listener = startCallbackListener();
try {
  await compose(["--profile", "runner", "build", "runner"]);
  await startStack(["pg17", "s3"]);

  console.log("generating about 2 GB of data (this takes a few minutes)...");
  await psql("pg17", "shop", "drop table if exists big");
  await psql("pg17", "shop", "create table big as select g as id, md5(random()::text) || md5(random()::text) || md5(random()::text) || md5(random()::text) as filler from generate_series(1, 14000000) g");
  const size = Number(await psql("pg17", "shop", "select pg_database_size('shop')"));
  check(size > 1.9 * 1024 ** 3, `database is ${(size / 1024 ** 3).toFixed(2)} GiB (needs more than 1.9 GiB)`);

  let peakMiB = 0;
  let peakAnonMiB = 0;
  const sampler = setInterval(async () => {
    const stats = await sh(["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", container]);
    const used = /([\d.]+)([KMG]i?B)/.exec(stats.stdout);
    if (used) peakMiB = Math.max(peakMiB, (Number(used[1]) * UNIT_BYTES[used[2] ?? "B"]!) / 1024 ** 2);
    const cgroup = await sh(["docker", "exec", container, "cat", "/sys/fs/cgroup/memory.stat"]);
    const counters = Object.fromEntries(cgroup.stdout.split("\n").map((line) => line.split(" ")).filter((pair) => pair.length === 2).map(([k, v]) => [k, Number(v)]));
    const unreclaimable = ((counters.anon ?? 0) + (counters.sock ?? 0) + (counters.kernel ?? 0)) / 1024 ** 2;
    if (cgroup.code === 0) peakAnonMiB = Math.max(peakAnonMiB, unreclaimable);
  }, 1000);

  const key = "backups/e2e/large/dump.dump";
  const run = await runRunner(
    { jobId: "large", containerName: container, job: baseJob(listener, "large", "backup", "postgres://cellar:cellar-test-pw@pg17:5432/shop", { r2: r2Block({ key, partSizeBytes: partMiB * 1024 * 1024 }) }) },
    { RUNNER_MEM_LIMIT: memLimit },
  );
  clearInterval(sampler);
  const oom = (await sh(["docker", "inspect", "-f", "{{.State.OOMKilled}}", container])).stdout.trim();
  await sh(["docker", "rm", "-f", container]);

  const result = listener.eventsFor("large").find((event) => event.event === "succeeded");
  console.log(`peak container memory: ${peakMiB.toFixed(0)} MiB of ${limitMiB} MiB (part size ${partMiB} MiB), OOMKilled=${oom}`);
  console.log(`peak anon+sock+kernel memory: ${peakAnonMiB.toFixed(0)} MiB (non-reclaimable; memory.stat)`);
  check(oom === "false", "the runner was not killed for running out of memory");
  check(run.code === 0 && result !== undefined, "the large backup succeeds");
  check(Number(result?.result?.sizeBytes) > limitMiB * 1024 * 1024, "the dump is larger than the memory limit, so it cannot have been buffered");
  check(peakMiB > 0 && peakMiB < limitMiB, `peak memory ${peakMiB.toFixed(0)} MiB stays under the ${limitMiB} MiB limit`);
  const stored = await objectDigest(key);
  check(stored.sha256 === result?.result?.sha256 && stored.bytes === result?.result?.sizeBytes, "stored object sha256 and size match the callback");
} finally {
  listener.stop();
  await compose(["--profile", "runner", "down", "-v"]);
}
