# Étape 1 : build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Étape 2 : run
FROM node:20-alpine
# AJOUT DE CURL ICI (Alpine utilise apk)
RUN apk add --no-cache curl

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]