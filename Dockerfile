# syntax=docker/dockerfile:1

# CalSync production image (see deploy/README.md).
#   build    all dependencies and the compiled app; deploy/compose.yaml also runs the database
#            migrations from this stage, because drizzle-kit is a dev dependency
#   runtime  production dependencies and the compiled app only

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build

FROM node:${NODE_VERSION}-slim AS runtime
# The server works in UTC; source data is converted from each source's own zone (rule 105).
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3100/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
