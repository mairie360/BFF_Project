FROM node:20-alpine

# Define the build argument
ARG NODE_AUTH_TOKEN

RUN apk add --no-cache curl

WORKDIR /app

# Copy files first
COPY package*.json tsconfig.json .npmrc ./

# Replace the placeholder in .npmrc with the actual token, then install
RUN sed -i "s|\${NODE_AUTH_TOKEN}|${NODE_AUTH_TOKEN}|g" .npmrc && \
    npm install

COPY . .

CMD ["npm", "run", "start"]
