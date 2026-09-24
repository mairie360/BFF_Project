#!/usr/bin/env bash

COMPOSE_FILE="docker-compose-security.yml"
SERVICE_NAME="security-scan"

# The CI exports IMAGE_REF (the image published by release-dev). Locally, build
# the BFF under test from development.Dockerfile and point the stack at it.
if [ -z "${IMAGE_REF:-}" ]; then
  echo "==> [0/4] Building bff-project:local from development.Dockerfile..."
  docker build -f development.Dockerfile -t bff-project:local \
    --secret id=npmrc,src=.npmrc \
    --secret id=npm_token,env=NODE_AUTH_TOKEN \
    . || exit 1
  export IMAGE_REF="bff-project:local"
fi
echo "==> BFF under test: $IMAGE_REF"

echo "==> [1/4] Starting the stack and the ZAP scan..."
docker compose -f "$COMPOSE_FILE" up -d

echo "==> [2/4] Waiting for the end of the security scan..."
docker compose -f "$COMPOSE_FILE" wait "$SERVICE_NAME"
EXIT_CODE=$?

echo "==> [3/4] Printing the report (logs)..."
docker compose -f "$COMPOSE_FILE" logs "$SERVICE_NAME"

echo "==> [4/4] Removing the containers..."
docker compose -f "$COMPOSE_FILE" down -v

echo "----------------------------------------"
echo "Final exit code: $EXIT_CODE"
echo "----------------------------------------"

exit $EXIT_CODE
