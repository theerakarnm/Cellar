import { mkdirSync } from "node:fs";

// wrangler refuses to start when assets.directory is missing. In dev the UI comes from Vite, so an empty folder is enough.
mkdirSync("dist/ui", { recursive: true });

const children = [
  Bun.spawn(["bun", "run", "dev:api"], { stdio: ["inherit", "inherit", "inherit"] }),
  Bun.spawn(["bun", "run", "dev:ui"], { stdio: ["inherit", "inherit", "inherit"] }),
];

function stop() {
  for (const child of children) child.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race(children.map((child) => child.exited));
stop();
process.exit(1);
