# --- Étape 1 : Build ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# On ne garde que les dépendances de prod pour le runtime
RUN npm ci --omit=dev --ignore-scripts

# --- Étape 2 : Runtime ---
FROM node:20-alpine
ENV NODE_ENV=production
RUN apk add --no-cache curl

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

USER node

# OPTIMISATION : On bride la heap à 180Mo pour tenir dans un limit K8s de 256Mo
ENV NODE_OPTIONS="--max-old-space-size=180"

EXPOSE 4001
CMD ["node", "dist/index.js"]