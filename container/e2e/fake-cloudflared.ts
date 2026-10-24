#!/usr/bin/env bun
// Test-only stand-in for `cloudflared access tcp`. Mounted only into the `runner-local` compose service,
// never copied into the image (container/e2e/ is in Dockerfile.dockerignore).
// Forwards 127.0.0.1:<port of --url> to <--hostname>:5432 on the compose network.
import { connect, createServer } from "node:net";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const hostname = flag("--hostname");
const port = Number(flag("--url")?.split(":").pop());
if (args[0] !== "access" || args[1] !== "tcp" || !hostname || !Number.isInteger(port)) {
  console.error("fake cloudflared: expected access tcp --hostname H --url 127.0.0.1:PORT");
  process.exit(2);
}
if (!process.env.TUNNEL_SERVICE_TOKEN_ID || !process.env.TUNNEL_SERVICE_TOKEN_SECRET) {
  console.error("fake cloudflared: the service token env vars are missing");
  process.exit(2);
}

createServer((client) => {
  const upstream = connect(5432, hostname);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close).on("close", close);
  upstream.on("error", close).on("close", close);
  client.pipe(upstream).pipe(client);
}).listen(port, "127.0.0.1", () => console.error(`fake cloudflared: 127.0.0.1:${port} -> ${hostname}:5432`));
