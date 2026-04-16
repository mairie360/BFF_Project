FROM node:24-alpine

# Installation de curl pour le healthcheck Docker
RUN apk add --no-cache curl

WORKDIR /app

# On copie les fichiers de définition en premier pour le cache Docker
COPY package*.json tsconfig.json ./

# Installation complète (avec devDependencies pour ts-node-dev)
RUN npm install

# On copie le reste du code source
COPY . .

# --respawn: redémarre même si le script plante
# --transpile-only: skip le check de types pour aller plus vite en dev
CMD ["npx", "ts-node-dev", "--respawn", "--transpile-only", "src/index.ts"]