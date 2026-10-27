# Bun release and image index pinned after pulling and verifying locally.
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS source
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

FROM source AS verify
RUN bun run sdk:build && bun run docs:generate && bun run check && bun run spike && bun run build

FROM source AS web-build
ARG VITE_API_URL=http://localhost:7612
ARG VITE_DOCS_URL=http://localhost:7611
ARG VITE_STUDIO_URL=http://localhost:7610
ARG QB_DOCS_URL=http://localhost:7611
ENV VITE_API_URL=$VITE_API_URL VITE_DOCS_URL=$VITE_DOCS_URL VITE_STUDIO_URL=$VITE_STUDIO_URL QB_DOCS_URL=$QB_DOCS_URL
RUN bun run sdk:build && bun run docs:generate && bun run --cwd apps/studio build && bun run --cwd apps/docs build

# Shared production runtime base: non-root user, production dependencies only,
# and only the files needed to run services (no dev tooling or app build sources).
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS runtime-base
WORKDIR /app

RUN groupadd --system --gid 10001 qb \
  && useradd --system --uid 10001 --gid 10001 --home-dir /var/lib/qb-flex --shell /sbin/nologin qb \
  && mkdir -p /var/lib/qb-flex \
  && chown qb:qb /var/lib/qb-flex /app

COPY --chown=qb:qb bun.lock package.json ./
COPY --chown=qb:qb packages ./packages
COPY --chown=qb:qb apps/api/package.json apps/api/package.json
COPY --chown=qb:qb apps/worker/package.json apps/worker/package.json
COPY --chown=qb:qb apps/studio/package.json apps/studio/package.json
COPY --chown=qb:qb apps/docs/package.json apps/docs/package.json
COPY --chown=qb:qb apps/cli/package.json apps/cli/package.json
COPY --chown=qb:qb examples/react/package.json examples/react/package.json
COPY --chown=qb:qb examples/vanilla/package.json examples/vanilla/package.json
COPY --chown=qb:qb scripts ./scripts
COPY --chown=qb:qb migrations ./migrations

RUN bun install --production --frozen-lockfile \
  && rm -rf /root/.cache /tmp/bun-*

USER qb

FROM runtime-base AS api
ENV NODE_ENV=production QB_HOST=0.0.0.0 QB_DATA_DIR=/var/lib/qb-flex PORT=7612
COPY --chown=qb:qb apps/api/src ./apps/api/src
# Shared webhook-delivery helpers live in the worker workspace and are imported by the API.
COPY --chown=qb:qb apps/worker/src ./apps/worker/src
EXPOSE 7612
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://localhost:7612/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "apps/api/src/index.ts"]

FROM runtime-base AS worker
ENV NODE_ENV=production
COPY --chown=qb:qb apps/worker/src ./apps/worker/src
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "const u=(process.env.QB_INTERNAL_API_URL||'http://api:7612')+'/ready';fetch(u).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "apps/worker/src/index.ts"]

FROM runtime-base AS storage-init
ENV NODE_ENV=production
HEALTHCHECK NONE
CMD ["bun", "scripts/storage-init.ts"]

FROM runtime-base AS studio
ENV NODE_ENV=production PORT=7610
COPY --chown=qb:qb apps/studio/package.json apps/studio/server.ts ./apps/studio/
COPY --from=web-build --chown=qb:qb /app/apps/studio/dist ./apps/studio/dist
EXPOSE 7610
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://localhost:7610/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "apps/studio/server.ts"]

FROM runtime-base AS docs
ENV NODE_ENV=production PORT=7611
COPY --chown=qb:qb apps/docs/package.json apps/docs/server.ts ./apps/docs/
COPY --from=web-build --chown=qb:qb /app/apps/docs/dist ./apps/docs/dist
EXPOSE 7611
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://localhost:7611/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["bun", "apps/docs/server.ts"]
