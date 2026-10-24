import { app } from "./app";

export { CallbackEntrypoint, JobRunner } from "./container/job-runner";

export default { fetch: app.fetch };
