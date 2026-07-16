FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY package*.json tsconfig.json ./

RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=true \
    --mount=type=secret,id=npm_token,required=true \
    NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token)" npm install

COPY . .

CMD ["npm", "run", "start"]
