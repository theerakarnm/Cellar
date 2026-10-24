import { Hono } from "hono";
import pkg from "../../package.json";
import { access, type AppEnv } from "./middleware/access";

export const app = new Hono<AppEnv>();

// Registration order matters: /api/health must be registered before the Access middleware.
app.get("/api/health", (c) => c.json({ ok: true, version: pkg.version }));
app.use("/api/*", access());
