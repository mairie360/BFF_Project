#!/usr/bin/env bash

COMPOSE_FILE="docker-compose-performance.yml"
SERVICE_NAME="k6-perf-test"

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

# Shared CI test files (OpenAPI coverage gate: ZAP hook and k6 coverage module). CI checks
# mairie360/CICD out as cicd-repo/; locally it is cloned once at the cicd_version pinned in
# .github/workflows/cicd.yml (override with CICD_VERSION, e.g. a branch not released yet).
CICD_DIR="cicd-repo"
if [ ! -f "$CICD_DIR/tests/k6/coverage.js" ]; then
  CICD_VERSION="${CICD_VERSION:-$(sed -n 's/^[[:space:]]*cicd_version:[[:space:]]*\([^[:space:]#]*\).*/\1/p' .github/workflows/cicd.yml | head -n 1)}"
  echo "==> Fetching mairie360/CICD $CICD_VERSION into $CICD_DIR/..."
  rm -rf "$CICD_DIR"
  git clone --quiet --depth 1 --branch "$CICD_VERSION" https://github.com/mairie360/CICD "$CICD_DIR" || exit 1
fi

echo "==> [1/4] Starting the stack and the k6 test..."
docker compose -f "$COMPOSE_FILE" up -d

echo "==> [2/4] Waiting for the end of the k6 test..."
docker compose -f "$COMPOSE_FILE" wait "$SERVICE_NAME"
EXIT_CODE=$?

echo "==> [3/4] Printing the results (logs)..."
docker compose -f "$COMPOSE_FILE" logs "$SERVICE_NAME"

echo "==> [4/4] Removing the containers..."
docker compose -f "$COMPOSE_FILE" down -v

echo "----------------------------------------"
echo "Final exit code: $EXIT_CODE"
echo "----------------------------------------"

exit $EXIT_CODE
