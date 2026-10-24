import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { CONTRACT_ENTRYPOINT } from "../../../container/contract";
import { app } from "../app";
import type { Env } from "../env";
import { CALLBACK_HOST } from "../jobs/types";

const RUNNER_COMMAND = [...CONTRACT_ENTRYPOINT];
const GRACE_MS = 10 * 60 * 1000;

/** Outbound handler: forwards requests the container sends to CALLBACK_HOST into the Hono app. */
export class CallbackEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return Promise.resolve(app.fetch(request, this.env, this.ctx));
  }
}

export interface RunRequest {
  /** Job payload JSON, written to the runner's stdin. Contains secrets: never log it. */
  payloadJson: string;
  /** Epoch ms after which the container must be gone. */
  deadlineMs: number;
}

/** One Durable Object per job id; each owns one container that runs one job. */
export class JobRunner extends DurableObject<Env> {
  async run(request: RunRequest): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("No container is configured for JobRunner");
    if (container.running) throw new Error("Job already started");

    container.start({ enableInternet: true, entrypoint: ["sleep", "infinity"] });
    await container.setInactivityTimeout(Math.max(request.deadlineMs - Date.now(), 0) + GRACE_MS);
    await this.ctx.storage.setAlarm(request.deadlineMs + GRACE_MS);
    await container.interceptOutboundHttp(CALLBACK_HOST, this.ctx.exports.CallbackEntrypoint({}));

    const proc = await container.exec(RUNNER_COMMAND, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    const writer = proc.stdin?.getWriter();
    if (!writer) throw new Error("Runner stdin is not available");
    await writer.write(new TextEncoder().encode(request.payloadJson));
    await writer.close();
    this.ctx.waitUntil(proc.exitCode.then(() => this.stop()));
  }

  async stop(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.container?.destroy("job finished");
  }

  override async alarm(): Promise<void> {
    await this.ctx.container?.destroy("deadline passed");
  }
}
