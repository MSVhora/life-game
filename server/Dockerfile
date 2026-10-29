# Build from the repository root:  docker build -f server/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server/migrations ./migrations
COPY server/public ./public
# Built-in example settings: used for anything the mounted /app/config folder does not provide.
COPY config/*.example.* ./config-defaults/
ENV CONFIG_DEFAULTS_DIR=/app/config-defaults

LABEL org.opencontainers.image.source="https://github.com/MSVhora/life-game" \
      org.opencontainers.image.description="Life Game: daily deadline-driven productivity tracker (server and web app)" \
      org.opencontainers.image.licenses="MIT"

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/index.js"]
