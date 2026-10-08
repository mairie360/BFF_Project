#!/usr/bin/env bash

# GDPR log marker test (MAIR-290, mairie360/CICD tests/gdpr/marker). Starts
# docker-compose-gdpr-marker.yml, whose `gdpr-marker` runner plays gdpr-marker.yaml with a marker
# user through the BFF, saves the logs of every container before `down`, then searches them for
# the marker's values. Exit 0: no value found. Exit 1: a value was found, or the journey failed.
# The report (values masked) is written to gdpr-report/summary.md.

COMPOSE_FILE="docker-compose-gdpr-marker.yml"
REPORT_DIR="gdpr-report"

# The CI exports IMAGE_REF (the image promoted to staging). Locally, build the BFF under test from
# development.Dockerfile (NODE_AUTH_TOKEN and ./.npmrc are needed to read the @mairie360/* packages).
if [ -z "${IMAGE_REF:-}" ]; then
  echo "==> [0/4] Building bff-project:local from development.Dockerfile..."
  docker build -f development.Dockerfile -t bff-project:local \
    --secret id=npmrc,src=.npmrc \
    --secret id=node_auth_token,env=NODE_AUTH_TOKEN \
    . || exit 1
  export IMAGE_REF="bff-project:local"
fi
export IMAGE_REF
echo "==> BFF under test: $IMAGE_REF"

# Marker engine. CI checks mairie360/CICD out as cicd-repo/; locally it is cloned once at the
# cicd_version pinned in .github/workflows/cicd.yml (override with CICD_VERSION, e.g. a branch).
CICD_DIR="cicd-repo"
if [ ! -f "$CICD_DIR/tests/gdpr/marker/scan.mjs" ]; then
  CICD_VERSION="${CICD_VERSION:-$(sed -n 's/^[[:space:]]*cicd_version:[[:space:]]*\([^[:space:]#]*\).*/\1/p' .github/workflows/cicd.yml | head -n 1)}"
  echo "==> Fetching mairie360/CICD $CICD_VERSION into $CICD_DIR/..."
  rm -rf "$CICD_DIR"
  git clone --quiet --depth 1 --branch "$CICD_VERSION" https://github.com/mairie360/CICD "$CICD_DIR" || exit 1
fi

rm -rf "$REPORT_DIR" && mkdir -p "$REPORT_DIR"
# The stack is always removed, even when the script is interrupted (CI bounds it with `timeout`).
trap 'docker compose -f "$COMPOSE_FILE" down -v >/dev/null 2>&1' EXIT

echo "==> [1/4] Starting the stack and the marker journey..."
docker compose -f "$COMPOSE_FILE" up -d

echo "==> [2/4] Waiting for the journey to finish..."
docker compose -f "$COMPOSE_FILE" wait gdpr-marker

echo "==> [3/4] Saving the logs of every container..."
docker compose -f "$COMPOSE_FILE" logs --no-color > "$REPORT_DIR/containers.log"
docker compose -f "$COMPOSE_FILE" logs --no-color --tail 40 gdpr-marker
docker compose -f "$COMPOSE_FILE" down -v

echo "==> [4/4] Searching the logs for the marker..."
docker run --rm -v "$PWD/$REPORT_DIR:/report" -v "$PWD/$CICD_DIR/tests/gdpr:/engine:ro" \
  node:24-bookworm-slim node /engine/marker/scan.mjs /report
EXIT_CODE=$?

echo "----------------------------------------"
echo "Final exit code: $EXIT_CODE"
echo "----------------------------------------"

exit $EXIT_CODE
