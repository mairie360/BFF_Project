FROM node:24-alpine

# Installation de curl pour le healthcheck Docker
RUN apk add --no-cache curl

WORKDIR /app

# On copie les fichiers de définition en premier pour le cache Docker
COPY package*.json tsconfig.json ./

# Installation complète (avec devDependencies).
# Les identifiants GitHub Packages ne sont disponibles que pendant cette étape.
RUN --mount=type=secret,id=npmrc,target=/app/.npmrc,required=true \
    --mount=type=secret,id=npm_token,env=NODE_AUTH_TOKEN,required=true \
    npm ci

# On copie le reste du code source
COPY . .

CMD ["npm", "run", "start"]
