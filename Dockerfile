# --- Étape 1 : Builder ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=npmrc,target=/app/.npmrc npm ci

COPY . .
RUN npm run build

# --- Étape 2 : Runtime ---
FROM node:20-alpine
ENV NODE_ENV=production
RUN apk add --no-cache curl

WORKDIR /app
RUN chown -R node:node /app

COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./

USER node
ENV NODE_OPTIONS="--max-old-space-size=180"

EXPOSE 4001

# [CORRECTION] On utilise tsx pour exécuter le point d'entrée
# Comme dist/index.js fait des imports vers des fichiers .ts dans node_modules,
# tsx saura les résoudre et les interpréter au vol.
CMD ["npx", "tsx", "dist/index.js"]
