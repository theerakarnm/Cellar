import { Hono } from "hono";
import pkg from "../../package.json";
import { access, type AppEnv } from "./middleware/access";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { internal } from "./routes/internal";
import { auditLogRoutes } from "./routes/audit-logs";
import { settingsRoutes } from "./routes/settings";
import { targetJobs } from "./routes/target-jobs";
import { targetRoutes } from "./routes/targets";

export const app = new Hono<AppEnv>();

app.onError(errorHandler);
app.notFound(notFoundHandler);

// Registration order matters: /api/health must be registered before the Access middleware.
app.get("/api/health", (c) => c.json({ ok: true, version: pkg.version }));
app.use("/api/*", access());
app.route("/api/targets", targetRoutes);
app.route("/api/targets", targetJobs);
app.route("/api/audit-logs", auditLogRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/internal", internal);
