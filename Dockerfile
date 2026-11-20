# syntax=docker/dockerfile:1
# InfraPilot production image: builds the Next.js app and runs it as a non-root user.
# The same image runs the monitoring worker (see docker-compose.yml, service "worker").

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S infrapilot && adduser -S infrapilot -G infrapilot
COPY --from=build --chown=infrapilot:infrapilot /app ./
USER infrapilot
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# Apply pending migrations, then start the web server.
CMD ["sh", "-c", "npx drizzle-kit migrate && npm run start"]
