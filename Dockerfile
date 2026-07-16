# --- Étape 1 : Builder ---
FROM node:20-alpine AS builder
WORKDIR /app

# On copie d'abord le package.json pour mettre en cache les dépendances
COPY package*.json ./

# Installation de TOUTES les dépendances (nécessaire pour le build TypeScript)
RUN --mount=type=secret,id=npmrc,target=/app/.npmrc \
    npm ci

COPY . .
# Build TypeScript
RUN npm run build

# Installation uniquement des dépendances de prod, SANS --ignore-scripts
# On écrase le node_modules précédent pour qu'il soit propre
RUN --mount=type=secret,id=npmrc,target=/app/.npmrc \
    npm ci --omit=dev

# --- Étape 2 : Runtime ---
FROM node:20-alpine
ENV NODE_ENV=production
RUN apk add --no-cache curl

WORKDIR /app

# Création de l'utilisateur node et attribution des droits sur le dossier
RUN chown -R node:node /app

# On copie les fichiers de l'étape précédente en changeant le propriétaire pour "node"
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./

# On bascule sur l'utilisateur non-root
USER node

# OPTIMISATION : On bride la heap à 180Mo pour tenir dans un limit K8s de 256Mo
ENV NODE_OPTIONS="--max-old-space-size=180"

EXPOSE 4001
CMD ["node", "dist/index.js"]
