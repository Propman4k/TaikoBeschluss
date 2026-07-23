# TaikoBeschluss Production Image
# Muster: TaikoEat/TaikoTasks (Vite-SPA + Express + better-sqlite3). Gebaut von
# GitHub Actions (linux/amd64) und nach GHCR gepusht; die NAS zieht nur
# das fertige Image (kein Build auf dem Synology).

# -- Stage 1: Frontend bauen --
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# -- Stage 2: Production-Server --
FROM node:22-slim
WORKDIR /app

# Build-Tools nur als Fallback fuer native Module (better-sqlite3 liefert
# i.d.R. Prebuilds fuer node22/linux-x64; falls nicht, wird hier kompiliert).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

RUN apt-get purge -y python3 make g++ && apt-get autoremove -y

COPY server/ ./server/
COPY --from=builder /app/dist ./dist

# data/ wird zur Laufzeit vom Volume ueberlagert; on-demand-Anlage in db.js
RUN mkdir -p /app/data && chmod 777 /app/data

ENV NODE_ENV=production
ENV SERVER_PORT=3010
ENV BIND_ADDR=0.0.0.0
ENV DATA_DIR=/app/data
ENV TZ=Europe/Berlin
EXPOSE 3010

CMD ["node", "server/index.js"]
