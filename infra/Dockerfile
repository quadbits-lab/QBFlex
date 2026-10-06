# Bun release and image index pinned after pulling and verifying locally.
FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS source
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

FROM source AS verify
RUN bun run sdk:build && bun run docs:generate && bun run check && bun run spike && bun run build

FROM source AS api
ENV QB_HOST=0.0.0.0 QB_DATA_DIR=/var/lib/qb-flex PORT=7612
RUN mkdir -p /var/lib/qb-flex && chown bun:bun /var/lib/qb-flex
USER bun
EXPOSE 7612
CMD ["bun", "apps/api/src/index.ts"]

FROM api AS worker
CMD ["bun", "apps/worker/src/index.ts"]

FROM source AS web-build
ARG VITE_API_URL=http://localhost:7612
ARG VITE_DOCS_URL=http://localhost:7611
ARG VITE_STUDIO_URL=http://localhost:7610
ARG QB_DOCS_URL=http://localhost:7611
ENV VITE_API_URL=$VITE_API_URL VITE_DOCS_URL=$VITE_DOCS_URL VITE_STUDIO_URL=$VITE_STUDIO_URL QB_DOCS_URL=$QB_DOCS_URL
RUN bun run sdk:build && bun run docs:generate && bun run --cwd apps/studio build && bun run --cwd apps/docs build

FROM web-build AS studio
USER bun
EXPOSE 7610
ENV PORT=7610
CMD ["bun", "apps/studio/server.ts"]

FROM web-build AS docs
USER bun
EXPOSE 7611
ENV PORT=7611
CMD ["bun", "apps/docs/server.ts"]

FROM api AS storage-init
CMD ["bun", "scripts/storage-init.ts"]
