# ikid — local-first personal finance, self-hosted.
# Build:  docker build -t ikid .
# Run:    docker run -p 3001:3001 -v ikid-data:/app/database ikid

# ---------- build stage ----------
FROM node:22-slim AS build
# openssl is required by Prisma's query engine on Debian slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install dependencies first for better layer caching (npm workspaces)
COPY package.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm install

COPY . .
RUN npx prisma generate --schema server/prisma/schema.prisma \
  && npm run build --workspace client

# ---------- runtime ----------
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3001 \
    # A networked instance must never run in open (no-login) mode:
    IKID_REQUIRE_AUTH=1

WORKDIR /app
COPY --from=build /app /app

# All user data lives in one directory — mount it to persist
VOLUME /app/database
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# npm start = db:setup (migrations, backup, schema push, seed) + serve
CMD ["npm", "start"]
