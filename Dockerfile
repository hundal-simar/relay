# syntax=docker/dockerfile:1

# 1) Compile TypeScript (dev dependencies live only here)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 2) Production dependencies only
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 3) Shared runtime base, non-root
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node sql/migrations ./sql/migrations
USER node

FROM runtime AS api
EXPOSE 3000
CMD ["node", "dist/server.js"]

FROM runtime AS worker
CMD ["node", "dist/worker.js"]

FROM runtime AS default
EXPOSE 3000
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/server.js"]