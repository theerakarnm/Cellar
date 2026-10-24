# Cloudflare platform research notes

Researched 2026-10-24 from developers.cloudflare.com (current docs, fetched as markdown).
Each fact links its source page. Limits are never guessed: only values stated in the docs are listed.
Entries marked [uncertain] are places where the docs are unclear or silent.

## 1. Containers

Docs tree: https://developers.cloudflare.com/containers/llms.txt

### Wrangler configuration

- Containers are declared in the Worker's Wrangler config via a `containers` array; each entry is linked to a Durable Object class by `class_name`, plus a `durable_objects.bindings` entry and a class `exports` entry (https://developers.cloudflare.com/containers/configuration/wrangler/).
- `containers` fields (default scheduling policy) (https://developers.cloudflare.com/workers/wrangler/configuration/#containers):
  - `image` (required): local `Dockerfile` path (built and pushed by `wrangler deploy`) or an image reference. Supported registries: Cloudflare Registry, Docker Hub, Amazon ECR, Google Artifact Registry.
  - `class_name`: the container-enabled Durable Object class. Alternatively set `name` and link from `exports.<Class>.container`.
  - `instance_type` (optional): `"lite"` (default), `"basic"`, `"standard-1"`, `"standard-2"`, `"standard-3"`, `"standard-4"`, or a custom object `{ vcpu, memory_mib, disk_mb }`.
  - `max_instances` (optional): max concurrently running instances; stopped instances do not count; requests that would exceed it error. Default 20. Not enforced in local dev.
  - `image_build_context`, `image_vars` (build args), `rollout_active_grace_period` (default 0), `rollout_step_percentage` (default 100, or [10, 100] when max_instances >= 2), `observability`, `ssh` / `authorized_keys`, `constraints.regions` (ENAM, WNAM, EEUR, WEUR, APAC, SAM, ME, OC, AFR), `constraints.jurisdiction` (`eu`, `fedramp`).
  - `scheduling_policy`: `"default"` (image/instance config stored on the application, rollouts) or `"durable_object"` (beta: image + instance size chosen per-start in `ctx.container.start()`; with this policy Wrangler rejects `image`, `instance_type`, `max_instances`, rollout settings, and constraints; the DO must use SQLite storage). Policy is immutable after creation.
- Two APIs: the new Durable Object Container API (`this.ctx.container`, recommended for new apps) and the legacy `Container` class from `@cloudflare/containers` (https://developers.cloudflare.com/containers/api/).

### Instance types, memory/vCPU/disk (https://developers.cloudflare.com/containers/platform/limits/)

| Instance type | vCPU | Memory | Disk |
| --- | --- | --- | --- |
| lite | 1/16 | 256 MiB | 2 GB |
| basic | 1/4 | 1 GiB | 4 GB |
| standard-1 | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |

- `dev` and `standard` are backward-compat aliases for `lite` and `standard-1`.
- Custom instance types: min vCPU 1, max vCPU 4, max memory 12 GiB, max disk 20 GB, minimum 3 GiB memory per vCPU. Below 1 vCPU must use predefined types. In Wrangler config: `vcpu`, `memory_mib`, `disk_mb`; in `ctx.container.start()`: `vcpu`, `memoryMib`, `diskMb`.
- Account limits (defaults, can be raised): 6 TiB concurrent memory, 1,500 concurrent vCPU, 30 TB concurrent disk, 50 GB total image storage per account.
- Image size limit = the instance's disk space (so a `lite` instance can only run images up to 2 GB).

### Image and runtime facts

- Images must be built for `linux/amd64`; each instance runs in a Firecracker microVM with its own kernel (https://developers.cloudflare.com/containers/concepts/architecture/).
- Cold starts are "often in the 1-3 second range", depending on image size and entrypoint work (https://developers.cloudflare.com/containers/concepts/architecture/).

### Max runtime / sleeping

- With the `Container` class, `sleepAfter` (default `"10m"`) keeps the container alive without incoming activity; `onActivityExpired()` defaults to calling `stop()`; `renewActivityTimeout()` resets the timer (https://developers.cloudflare.com/containers/api/container-class/).
- With the Durable Object Container API, `setInactivityTimeout(ms)` stops the container after the Durable Object goes inactive; without a timeout Cloudflare stops the container "shortly after" the DO becomes inactive; set it after `start()` and again in the constructor if already running (https://developers.cloudflare.com/containers/api/durable-object-container/).
- There is no documented hard max runtime for a container that stays in use; stopping is driven by inactivity timeouts, `signal()`/`destroy()`, rollouts, or process exit (https://developers.cloudflare.com/containers/concepts/architecture/).
- Platform shutdown sequence: `SIGTERM` to the main process, wait up to 15 minutes, then `SIGKILL`. Handle `SIGTERM` for cleanup. Same sequence during rollouts (https://developers.cloudflare.com/containers/concepts/architecture/).
- Disk is ephemeral per start; `durable_object` policy can snapshot (max 20 GB, 30-day retention) and restore (https://developers.cloudflare.com/containers/platform/limits/, https://developers.cloudflare.com/containers/concepts/architecture/).

### How a Worker starts a container job

- A Worker reaches a container only through its Durable Object: `env.MY_CONTAINER.getByName(id)` (or `getContainer(env.MY_CONTAINER, id)` from `@cloudflare/containers`), then `stub.fetch(request)` is forwarded to the container's `defaultPort` (https://developers.cloudflare.com/containers/concepts/architecture/, https://developers.cloudflare.com/containers/api/container-class/).
- The DO starts the container with `ctx.container.start(options)` (options: `env`, `entrypoint`, `enableInternet`, `image`, `instance`, `containerSnapshot`, `labels`). `start()` returns before the container is ready (https://developers.cloudflare.com/containers/api/durable-object-container/).
- Readiness: check the port, e.g. poll `container.getTcpPort(port).fetch("http://container/health")` until OK; `ctx.container.running` becomes true before the process is ready (https://developers.cloudflare.com/containers/concepts/architecture/).
- The `Container` class wraps this in `startAndWaitForPorts()`, `waitForPort()`, `stop()`, `destroy()`, `getState()`, `schedule()` (https://developers.cloudflare.com/containers/api/container-class/).
- Completion / callbacks from the container:
  - `monitor()` promise resolves when the container exits, rejects on error; `Container` class hooks: `onStart()`, `onStop()` (exit code + reason), `onActivityExpired()`, `onError()` (https://developers.cloudflare.com/containers/concepts/architecture/).
  - `exec(cmd, opts)` runs a process inside the container and returns output / exit code (https://developers.cloudflare.com/containers/api/durable-object-container/).
  - The container can call back into Worker code via outbound handlers: it makes a plain HTTP request to a virtual hostname (e.g. `http://my.worker` or `http://my.kv/key`), and `outboundByHost` / `outbound` handlers run in the Workers runtime with access to all bindings (KV, R2, DO, secrets). `ctx.containerId` scopes callbacks per instance (https://developers.cloudflare.com/containers/configuration/outbound-traffic/, https://developers.cloudflare.com/containers/configuration/workers-connections/).
- Durable Objects and their containers are not guaranteed to run in the same location; placement optimizes routing and startup speed (https://developers.cloudflare.com/containers/concepts/architecture/).

### Outbound networking

- `enableInternet` (class field, default `true`) blocks public internet egress when `false`. It takes effect at container start; outbound policy changes apply to live containers (https://developers.cloudflare.com/containers/configuration/outbound-traffic/).
- With `enableInternet = false` only ports 80 and 443 are available; non-HTTP traffic on other ports is denied, and DNS resolves only for hostnames covered by the outbound config (https://developers.cloudflare.com/containers/configuration/outbound-traffic/).
- `allowedHosts` (deny-by-default allowlist, supports `*` globs) and `deniedHosts` filter egress; `deniedHosts` applies to port 80 HTTP always, and to 443 HTTPS only with `interceptHttps = true`; other ports bypass it unless `enableInternet = false` (https://developers.cloudflare.com/containers/configuration/outbound-traffic/).
- Outbound handlers (`outbound`, `outboundByHost`) intercept HTTP on port 80 and HTTPS on 443 (HTTPS only with `interceptHttps = true` + trusting the ephemeral CA at `/etc/cloudflare/certs/cloudflare-containers-ca.crt`). Export `ContainerProxy` from the Worker entrypoint for interception to work (https://developers.cloudflare.com/containers/configuration/outbound-traffic/).
- Direct API: `interceptOutboundHttp(target, worker)` / `interceptOutboundHttps` / `interceptAllOutboundHttp` accept hostname globs, IPs, or CIDRs; 128 shared intercept entries per container; intercepts cannot be removed while running (https://developers.cloudflare.com/containers/api/durable-object-container/, https://developers.cloudflare.com/containers/configuration/outbound-traffic/).
- Precedence: deniedHosts -> allowedHosts -> instance-level per-host -> class-level per-host -> instance-level catch-all -> class catch-all -> public egress only if allowed (https://developers.cloudflare.com/containers/configuration/outbound-traffic/).

## 2. Can a Container reach a Tunnel-private TCP service?

- Workers VPC (beta) is a Worker feature: `vpc_services` and `vpc_networks` bindings let a Worker `fetch()` to HTTP services or `connect()` raw TCP through a Cloudflare Tunnel; TCP VPC Services target databases (application protocol `postgresql`/`mysql`) (https://developers.cloudflare.com/workers-vpc/, https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/, https://developers.cloudflare.com/workers-vpc/api/).
- No Container page mentions Workers VPC, `vpc_services`, or `vpc_networks`; the Containers docs list no way to attach these bindings to a container's network namespace (checked all pages in https://developers.cloudflare.com/containers/llms.txt on 2026-10-24). [uncertain] Container support for Workers VPC is not documented anywhere; treat it as unsupported until announced.
- Workaround that IS documented for Workers: the container makes HTTP calls to a virtual hostname and an outbound handler (running in the Workers runtime) uses the VPC Service / VPC Network binding, e.g. proxy `http://private-db.proxy` to `env.PRIVATE_DB.fetch(...)` or Hyperdrive (https://developers.cloudflare.com/containers/configuration/workers-connections/, https://developers.cloudflare.com/workers-vpc/api/). This covers HTTP-to-TCP via Hyperdrive-style patterns but not arbitrary raw TCP from inside the container.
- `cloudflared access tcp` inside the container (Access for Infrastructure / self-hosted TCP app):
  - Access for Infrastructure currently supports SSH only; for other protocols, Cloudflare says to use a self-hosted (private) application instead (https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/infrastructure-apps/).
  - Documented client flow (browser SSO): server runs `cloudflared tunnel --hostname tcp.site.com --url tcp://localhost:7870`; client runs `cloudflared access tcp --hostname tcp.site.com --url localhost:9210` and a browser window opens for SSO (https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/cloudflared-authentication/arbitrary-tcp/).
  - Service-token (headless) flow: the current docs describe service-token auth as HTTP headers (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) on HTTP requests, with an Access policy of action "Service Auth" using the "Service Token" selector, identity providers off, session duration "expires immediately" (https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/, https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/).
  - The `cloudflared access tcp` CLI itself accepts `--service-token-id <CLIENT_ID> --service-token-secret <CLIENT_SECRET>` (and `--hostname`, `--url`), which authenticates without a browser. [uncertain] These flags are not documented on developers.cloudflare.com pages fetched 2026-10-24 (Arbitrary TCP, SMB, kubectl tutorials show only SSO auth); they are documented in cloudflared's own CLI help and GitHub issues (https://github.com/cloudflare/cloudflared/issues/1104, https://github.com/cloudflare/cloudflared/issues/602). Verify against `cloudflared access tcp --help` in your image before relying on it.
  - Example (headless, inside the container): `cloudflared access tcp --hostname tcp.example.com --url 127.0.0.1:9210 --service-token-id "$CF_ACCESS_CLIENT_ID" --service-token-secret "$CF_ACCESS_CLIENT_SECRET"`, then point the app at `127.0.0.1:9210`.
  - Caveats:
    - The Access application securing the hostname must allow Service Auth (Service Token include rule) or the token is rejected; an SSO-only policy requires interactive login, which a container cannot do (https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/, https://developers.cloudflare.com/cloudflare-one/access-controls/policies/).
    - `cloudflared` needs outbound TCP 443 to Cloudflare; the docs require firewall egress on 80/443 for `cloudflared access` (https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/cloudflared-authentication/arbitrary-tcp/). Inside a container this means `enableInternet = true`, or `enableInternet = false` with the app hostname in `allowedHosts` (only 80/443 pass then). [uncertain] whether any additional Cloudflare edge hostnames must be allowlisted.
    - If `interceptHttps = true` with an outbound handler, cloudflared's TLS to Cloudflare would be intercepted by the ephemeral CA; cloudflared will fail certificate verification unless that CA is trusted. Do not intercept the `cloudflared` egress host, or trust `/etc/cloudflare/certs/cloudflare-containers-ca.crt` (https://developers.cloudflare.com/containers/configuration/outbound-traffic/).
    - `cloudflared` must be present in the image (linux/amd64 build) and kept running (e.g. as the container entrypoint or a supervised sidecar process).
    - `cloudflared access` local listeners are plain TCP on localhost; any process in the container can use them.

## 3. Queues

Docs tree: https://developers.cloudflare.com/queues/llms.txt

### Consumer configuration (https://developers.cloudflare.com/workers/wrangler/configuration/#queues, https://developers.cloudflare.com/queues/configuration/configure-queues/)

- Producer: `[[queues.producers]]` with `queue`, `binding`, optional `delivery_delay` (seconds).
- Consumer: `[[queues.consumers]]` with:
  - `queue` (required), `max_batch_size`, `max_batch_timeout`, `max_retries`, `dead_letter_queue`, `max_concurrency`, `retry_delay`.
  - Defaults and ranges (https://developers.cloudflare.com/queues/configuration/batching-retries/): `max_batch_size` default 10 (min 1, max 100); `max_batch_timeout` default 5 s (min 0, max 60 s). Whichever of size/timeout is hit first triggers delivery.
  - `dead_letter_queue` default retry count is 3 when unspecified (https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).
  - `max_concurrency` unset means consumers scale automatically to the supported maximum (250) (https://developers.cloudflare.com/workers/wrangler/configuration/#queues, https://developers.cloudflare.com/queues/platform/limits/).
  - Per-message `ack()` / `retry()` and `batch.ackAll()` / `retryAll()` give explicit acknowledgement; `retry({ delaySeconds })` overrides `retry_delay` (https://developers.cloudflare.com/queues/configuration/batching-retries/).

### Limits (https://developers.cloudflare.com/queues/platform/limits/)

| Feature | Limit |
| --- | --- |
| Queues per account | 10,000 |
| Message size | 128 KB (1 KB = 1000 bytes; ~100 bytes internal metadata counts) |
| Message retries | 100 |
| Max consumer batch size | 100 messages |
| Max messages per `sendBatch` | 100 (or 256 KB total) |
| Max batch wait time | 60 s |
| Per-queue throughput | 5,000 msg/s (exceeding throws `Too Many Requests`) |
| Message retention | Configurable up to 14 days; 24 h fixed on Free |
| Per-queue backlog | 25 GB (`Storage Limit Exceeded` beyond) |
| Concurrent consumer invocations | 250 (push-based only) |
| Consumer wall time | 15 min per invocation |
| Consumer CPU time | Default 30 s, configurable to 5 min via `limits.cpu_ms = 300000` |
| `visibilityTimeout` (pull consumers) | 12 h |
| `delaySeconds` (send/retry) | max 24 h |

### DLQ (https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)

- Configured per consumer via `dead_letter_queue: <queue-name>`; messages arrive after `max_retries` is exhausted; without a DLQ they are deleted.
- DLQ must share the source queue's jurisdiction; a missing DLQ name is auto-created.
- Messages in a DLQ with no consumer persist 4 days, then are deleted.
- Delivery is at-least-once (https://developers.cloudflare.com/queues/reference/delivery-guarantees/).

## 4. Cron Triggers

- Configured in Wrangler config as `triggers.crons = ["*/3 * * * *", ...]`, handled by `scheduled(controller, env, ctx)` (https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- Cron Triggers execute on UTC time only (https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- Five-field expressions plus Quartz-like extensions `L`, `W`, `#`; weekday numbering is 1 = Sunday .. 7 = Saturday (differs from standard cron); three-letter names (`MON`) recommended (https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- Config changes can take up to 15 minutes to propagate (https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- Limits (https://developers.cloudflare.com/workers/platform/limits/):
  - Cron Triggers per account: 5 (Free), 250 (Paid).
  - Wall time per scheduled invocation: 15 minutes.
  - CPU per Cron Trigger invocation: 10 ms (Free); 30 s for intervals < 1 h, 15 min for intervals >= 1 h (Paid).

## 5. D1 limits (https://developers.cloudflare.com/d1/platform/limits/)

| Feature | Limit |
| --- | --- |
| Databases per account | 50,000 (Paid) / 10 (Free) |
| Max database size | 10 GB (Paid) / 500 MB (Free); 10 GB cannot be increased |
| Max storage per account | 1 TB (Paid) / 5 GB (Free) |
| Queries per Worker invocation | 1000 (Paid) / 50 (Free) (subrequest limits) |
| Columns per table | 100 |
| Rows per table | Unlimited (bounded by db size) |
| Max string/BLOB/row size | 2,000,000 bytes (2 MB) |
| Max SQL statement length | 100 KB |
| Max bound parameters per query | 100 |
| Max arguments per SQL function | 32 |
| Max `LIKE`/`GLOB` pattern length | 50 bytes |
| Max SQL query duration | 30 s, applies to the entire `batch()` call |
| Max `d1 execute` import size | 5 GB |
| Simultaneous D1 connections per invocation | 6 |

- Batch limits: per-statement limits apply to each statement inside `db.batch()` (e.g. 100 KB per statement, 100 bound params per statement) (https://developers.cloudflare.com/d1/platform/limits/).
- Each database is backed by a single Durable Object and is single-threaded; throughput ~= 1 / avg query duration; overloaded errors when the queue fills (https://developers.cloudflare.com/d1/platform/limits/).
- Time Travel point-in-time recovery: 30 days (Paid) / 7 days (Free) (https://developers.cloudflare.com/d1/platform/limits/).

## 6. R2 multipart upload via S3 API

### Endpoint and credentials

- S3 endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`; bucket region is `auto` (empty and `us-east-1` alias to `auto`) (https://developers.cloudflare.com/r2/api/s3/api/).
- Credentials: R2 API tokens act as the Access Key ID + Secret Access Key; create in dashboard under R2 > Manage API Tokens (Account or User tokens, optional bucket scoping for Object Read/Write); the secret is shown only once (https://developers.cloudflare.com/r2/api/tokens/).
- Supported multipart S3 operations: `CreateMultipartUpload`, `UploadPart`, `UploadPartCopy`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `ListParts`, `ListMultipartUploads` (https://developers.cloudflare.com/r2/api/s3/api/).

### Size limits (https://developers.cloudflare.com/r2/platform/limits/, https://developers.cloudflare.com/r2/objects/upload-objects/)

| Feature | Limit |
| --- | --- |
| Part size (multipart) | 5 MiB - 5 GiB per part |
| Max upload parts | 10,000 |
| Max object size | 5 TiB (practical multipart max 4.995 TiB; docs footnote says 5 GiB less than 5 TiB) |
| Max single-part `PUT` | 5 GiB (4.995 GiB per footnote) |
| Object key length | 1,024 bytes |
| Max concurrent writes to same key | 1/s (429 beyond) |
| Max buckets per account | 1,000,000 |

- SDKs like rclone / AWS SDK pick multipart automatically above a threshold; part uploads can be parallel and retried independently (https://developers.cloudflare.com/r2/objects/upload-objects/).

### Incomplete upload cleanup

- Buckets have a default lifecycle rule that expires (aborts) multipart uploads 7 days after initiation (https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
- Custom lifecycle rules can also target incomplete multipart uploads; max 1,000 lifecycle rules per bucket; `AbortMultipartUpload` is also callable directly via the S3 API (https://developers.cloudflare.com/r2/buckets/object-lifecycles/, https://developers.cloudflare.com/r2/api/s3/api/).

## 7. Access JWT validation

Sources: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/ and https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/

- Header: the application token arrives as the `Cf-Access-Jwt-Assertion` request header; browsers also carry a `CF_Authorization` cookie. Validate the header, not the cookie (the cookie is not guaranteed to be passed).
- Algorithm and keys: RS256. Public keys (JWKS) live at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`; the response contains `keys` (JWK), `public_cert` (current key PEM), and `public_certs` (all PEMs).
- Key rotation: Access rotates signing keys every 6 weeks; the previous key stays valid 7 days after rotation; fetch keys from the endpoint instead of hard-coding, and match the JWT `kid` against `public_certs`/`keys` (do not blindly use `public_cert`).
- Claims to check:
  - `iss`: must equal `https://<team>.cloudflareaccess.com`.
  - `aud`: must equal the application's Application Audience (AUD) tag (from Zero Trust > Access controls > Applications > the app > Additional settings). AUD changes only if the app is deleted and recreated.
  - `exp` (and `iat`/`nbf`): Unix timestamps; standard exp/leeway checks apply.
  - Optional claims: `email`, `sub` (stable per user per account), `type` (`app` or `org`), `identity_nonce`, `country`, custom `custom` claims (best-effort, trimmed near 1 KB; do not authorize on them when they may be large).
- Reference validation: `jose`'s `createRemoteJWKSet(`${TEAM_DOMAIN}/cdn-cgi/access/certs`)` + `jwtVerify(token, JWKS, { issuer: TEAM_DOMAIN, audience: AUD })`; library examples for Workers, Node, Python are on the docs page.
- Full user identity (all groups) is not in the JWT; fetch `/cdn-cgi/access/get-identity` with the `CF_Authorization` cookie if needed (https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).
