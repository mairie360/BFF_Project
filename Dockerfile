# --- Étape 1 : Build ---
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./

# Les identifiants GitHub Packages ne sont disponibles que pendant le npm ci.
RUN --mount=type=secret,id=npmrc,target=/app/.npmrc \
    --mount=type=secret,id=node_auth_token,env=NODE_AUTH_TOKEN \
    npm ci

COPY . .
RUN npm run build

RUN --mount=type=secret,id=npmrc,target=/app/.npmrc \
    --mount=type=secret,id=node_auth_token,env=NODE_AUTH_TOKEN \
    npm ci --omit=dev --ignore-scripts

# --- Étape 2 : Runtime ---
FROM node:24-alpine
ENV NODE_ENV=production
RUN apk add --no-cache curl

WORKDIR /app
# Fichiers laissés à root : l'utilisateur node ne peut pas modifier le code exécuté.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

USER node

# OPTIMISATION : On bride la heap à 180Mo pour tenir dans un limit K8s de 256Mo
ENV NODE_OPTIONS="--max-old-space-size=180"

EXPOSE 4001
# dist/index.js est un bundle esbuild autonome (les clients @mairie360/*-openapi sont inlinés).
CMD ["node", "dist/index.js"]
