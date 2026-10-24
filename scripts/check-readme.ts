// Docs cross-check, run in CI. Run from the repo root: bun scripts/check-readme.ts [--list] [--wrangler] [files...]
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const argFiles = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DOCS = (argFiles.length ? argFiles : ["README.md", "CONTRIBUTING.md", "SECURITY.md", "docs/vm-onboarding.md", "docs/restore-runbook.md", "docs/alerts.md", ".github/workflows/ci.yml"]).filter(existsSync);
const read = (p: string) => readFileSync(p, "utf8");
const docs = Object.fromEntries(DOCS.map((p) => [p, read(p)]));
const all = Object.values(docs).join("\n");
const failures: string[] = [];
const fail = (m: string) => failures.push(m);
const uniq = (xs: string[]) => [...new Set(xs)];

const walk = (dir: string): string[] =>
  !existsSync(dir) ? [] : readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
const sources = ["src", "container"].flatMap(walk).map(read).join("\n");

// 1. bun run <script> must exist in package.json
const scripts = Object.keys(JSON.parse(read("package.json")).scripts ?? {});
for (const s of uniq([...all.matchAll(/\bbun run ([\w:-]+)/g)].map((m) => m[1]!))) {
  if (!scripts.includes(s)) fail(`bun run ${s}: not in package.json scripts`);
}

// 2. wrangler subcommands (collected here, validated with --help by the caller)
const wranglerCmds = uniq([...all.matchAll(/\bwrangler (r2 bucket [a-z]+|[a-z0-9]+(?: [a-z]+)?)/g)].map((m) => m[1]!))
  .filter((c) => !/^(config|and|is|to)\b/.test(c));
if (process.argv.includes("--list")) console.log("wrangler commands:", wranglerCmds);
if (process.argv.includes("--wrangler")) {
  for (const cmd of wranglerCmds) {
    const run = Bun.spawnSync(["bunx", "wrangler", ...cmd.split(" "), "--help"], { stdout: "ignore", stderr: "ignore" });
    if (run.exitCode !== 0) fail(`wrangler ${cmd}: "--help" exited ${run.exitCode}`);
  }
}

// 3. env vars: documented names must exist in the code or example, and the reverse
const example = existsSync(".dev.vars.example") ? read(".dev.vars.example") : "";
const exampleVars = [...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!);
const envTs = existsSync("src/worker/env.ts") ? read("src/worker/env.ts") : "";
const known = new Set([...exampleVars, ...[...envTs.matchAll(/^\s+([A-Z][A-Z0-9_]+)\??:/gm)].map((m) => m[1]!)]);
const DOCS_ONLY = new Set(["CLOUDFLARE_TUNNEL_TOKEN", "TUNNEL_TOKEN", "PGPASSWORD", "POSTGRES_PASSWORD", "AUD", "UTC", "ISO", "MIT", "R2", "D1", "SQL", "TCP", "LINE", "JWT", "URL", "UI", "API", "HMAC", "PITR", "WAL", "AES", "GFS", "CRON"]);
const secretPut = [...all.matchAll(/wrangler secret put ([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]!);
const ticked = [...all.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+)`/g)].map((m) => m[1]!);
for (const v of uniq([...secretPut, ...ticked])) {
  if (!known.has(v) && !DOCS_ONLY.has(v)) fail(`env var ${v}: not in .dev.vars.example or src/worker/env.ts`);
}
if (DOCS.includes("README.md")) for (const v of exampleVars) if (!all.includes(v)) fail(`env var ${v}: in .dev.vars.example but not documented`);

// 4. routes: every /api or /internal route in the docs is registered in code (sub-router prefix + suffix allowed)
const norm = (s: string) => s.replace(/:[A-Za-z]+/g, ":p");
const src = norm(sources);
const routes = uniq([...all.matchAll(/(?<![\w./-])\/(?:api|internal)\/[A-Za-z0-9_:/-]+/g)].map((m) => norm(m[0]!.replace(/[/.]+$/, ""))));
for (const r of routes) {
  const segs = r.split("/").slice(1);
  let ok = src.includes(`"${r}"`);
  for (let i = 1; i < segs.length && !ok; i++) {
    const prefix = "/" + segs.slice(0, i).join("/");
    const suffix = "/" + segs.slice(i).join("/");
    ok = src.includes(`"${prefix}"`) && src.includes(`"${suffix}"`);
  }
  if (!ok) fail(`route ${r}: no registration found in src/ or container/`);
}

// 5. resource names must match wrangler.jsonc
const wr = existsSync("wrangler.jsonc") ? read("wrangler.jsonc") : "";
const expectName = (cmd: RegExp, key: string, label: string) => {
  const want = wr.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`))?.[1];
  for (const m of all.matchAll(cmd)) if (m[1] !== want) fail(`${label} ${m[1]}: wrangler.jsonc has ${want}`);
};
expectName(/wrangler d1 create (\S+)/g, "database_name", "d1");
expectName(/wrangler r2 bucket create (\S+)/g, "bucket_name", "r2 bucket");
expectName(/wrangler queues create (\S+)/g, "queue", "queue");

// 6. banned content
const BANNED: [RegExp, string][] = [
  [/\u2014/, "em dash"], [/cellart/i, "typo cellart"], [/connection_mode|direct (?:connection )?mode|`direct`/i, "direct connection mode (removed)"], [/\b[0-9a-f]{32}\b/, "32-hex id (account id?)"],
  [/eyJ[A-Za-z0-9_-]{10,}/, "JWT-like token"], [new RegExp(`\\b(?:${["TO", "DO"].join("")}|${["TB", "D"].join("")})\\b`), "placeholder"],
];
for (const [file, text] of Object.entries(docs)) {
  for (const [re, label] of BANNED) if (re.test(text)) fail(`${file}: contains ${label}`);
  for (const m of text.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\.(?:com|io|dev|net|org|app|me|co|th|ai|cloud)\b/g)) {
    const host = m[0];
    if (!/(^|\.)(example\.com|github\.com|cloudflare\.com|cloudflarestorage\.com|bun\.sh|postgresql\.org|discord\.com|discordapp\.com)$/.test(host) && !/^(yourteam|myteam)\.cloudflareaccess\.com$/.test(host)) {
      fail(`${file}: hostname ${host} is not an allowed placeholder`);
    }
  }
  for (const m of text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
    if (!/@(?:[a-z0-9-]+\.)*example\.com$/i.test(m[0])) fail(`${file}: email ${m[0]} is not an example.com placeholder`);
  }
}

// 7. relative markdown links resolve; 8. one sentence per line in prose
for (const [file, text] of Object.entries(docs)) {
  if (!file.endsWith(".md")) continue;
  for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
    const target = join(file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".", m[1]!);
    if (!existsSync(target)) fail(`${file}: broken link ${m[1]}`);
  }
  let fence = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence || /^\s*\||^#|^\s*<!--/.test(line)) return;
    const prose = line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").replace(/`[^`]*`/g, "``").replace(/\]\([^)]*\)/g, "]");
    for (const m of prose.matchAll(/[.!?] (?=[A-Z])/g)) {
      if (!/(?:e\.g|i\.e|vs|etc)\.$/.test(prose.slice(0, m.index! + 1))) { fail(`${file}:${i + 1}: more than one sentence on a line`); break; }
    }
  });
}

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`docs cross-check OK: ${DOCS.length} files, ${scripts.length} scripts, ${routes.length} routes, ${known.size} env vars`);
