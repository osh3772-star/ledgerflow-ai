FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY . .
RUN pnpm install --frozen-lockfile && pnpm web:build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.ledgerflow/mcp-audit && chown -R node:node /app/.ledgerflow
USER node
ENV LEDGERFLOW_MCP_MODE=postgres
ENV LEDGERFLOW_MCP_PORT=8787
ENV ADAPTER_MODE=mock
# Liveness only, no agent execution or accounting mutations.
HEALTHCHECK --interval=30s --timeout=8s --start-period=60s --retries=3 CMD ["node","--import","tsx","scripts/container-health.ts"]
# Keep the Node listener on loopback. See compose.yaml and docs/DEPLOYMENT.md.
# Direct Node owns signals; no package-manager wrapper sits between it and PID 1.
CMD ["node","--import","tsx","apps/mcp-server/src/main.ts"]
