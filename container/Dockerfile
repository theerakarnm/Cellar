# Build from the repo root: docker build -f container/Dockerfile -t cellar-runner:dev .
# The root is the build context so the runner can share src/worker/lib/redact.ts with the Worker.
FROM oven/bun:1.3.9-slim

ARG CLOUDFLARED_VERSION=2026.10.3
ARG CLOUDFLARED_SHA256_AMD64=053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0
ARG CLOUDFLARED_SHA256_ARM64=89297ebfb9e8c99c0dc013a1140601453cf3798d8306c5591651f4a3f5210be8

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && . /etc/os-release \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-client-13 postgresql-client-14 postgresql-client-15 \
      postgresql-client-16 postgresql-client-17 postgresql-client-18 \
 && rm -rf /var/lib/apt/lists/*

RUN arch="$(dpkg --print-architecture)" \
 && case "$arch" in amd64) sha="$CLOUDFLARED_SHA256_AMD64" ;; arm64) sha="$CLOUDFLARED_SHA256_ARM64" ;; *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac \
 && curl -fsSL -o /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${arch}" \
 && echo "${sha}  /usr/local/bin/cloudflared" | sha256sum -c - \
 && chmod +x /usr/local/bin/cloudflared

WORKDIR /app
COPY container/ /app/
COPY src/worker/lib/redact.ts /src/worker/lib/redact.ts

USER bun
ENTRYPOINT ["bun", "run", "/app/entrypoint.ts"]
