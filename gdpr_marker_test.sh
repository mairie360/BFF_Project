#!/usr/bin/env bash

# GDPR log marker test (MAIR-290, mairie360/CICD tests/gdpr/marker). Starts
# docker-compose-gdpr-marker.yml, whose `gdpr-marker` runner plays gdpr-marker.yaml with a marker
# user through the BFF, saves the logs of every container before `down`, then searches them for
# the marker's values. Exit 0: no value found. Exit 1: a value was found, or the journey failed.
# The report (values masked) is written to gdpr-report/summary.md.

COMPOSE_FILE="docker-compose-gdpr-marker.yml"
SERVICE_NAME="gdpr-marker"
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

# Random JWT_SECRET for this run and the admin JWT signed with it (MAIR-428, MAIR-474): nothing is
# signed with a committed secret.
# shellcheck source=stack_secrets.sh
source ./stack_secrets.sh || exit 1

# Marker engine. CI checks mairie360/CICD out as cicd-repo/; locally it is cloned once at the
# cicd_version pinned in .github/workflows/cicd.yml, or at the first release that ships the engine
# (GDPR_ENGINE_MIN_CICD) while that pin is older (override with CICD_VERSION, e.g. a branch).
GDPR_ENGINE_MIN_CICD="v4.12.0"
CICD_DIR="cicd-repo"
if [ ! -f "$CICD_DIR/tests/gdpr/marker/scan.mjs" ]; then
  if [ -z "${CICD_VERSION:-}" ]; then
    CICD_VERSION="$(sed -n 's/^[[:space:]]*cicd_version:[[:space:]]*\([^[:space:]#]*\).*/\1/p' .github/workflows/cicd.yml | head -n 1)"
    case "$CICD_VERSION" in
      v[0-9]*) CICD_VERSION="$(printf '%s\n%s\n' "$CICD_VERSION" "$GDPR_ENGINE_MIN_CICD" | sort -V | tail -n 1)" ;;
      *) CICD_VERSION="$GDPR_ENGINE_MIN_CICD" ;;
    esac
  fi
  echo "==> Fetching mairie360/CICD $CICD_VERSION into $CICD_DIR/..."
  rm -rf "$CICD_DIR"
  git clone --quiet --depth 1 --branch "$CICD_VERSION" https://github.com/mairie360/CICD "$CICD_DIR" || exit 1
fi

rm -rf "$REPORT_DIR" && mkdir -p "$REPORT_DIR"
# The stack is always removed, even when the script is interrupted (CI bounds it with `timeout`).
trap 'docker compose -f "$COMPOSE_FILE" down -v >/dev/null 2>&1' EXIT

echo "==> [1/4] Starting the stack and the marker journey..."
# Fresh volumes on every run: a volume left by a previous run would hand the stack its rows.
docker compose -f "$COMPOSE_FILE" down -v --remove-orphans > /dev/null 2>&1
# A failed dependency (seeder, migration, upstream readiness) leaves the runner created but never
# started, and `docker compose wait` would then report 0: fail here instead.
if ! docker compose -f "$COMPOSE_FILE" up -d; then
  echo "==> The stack did not start: a dependency failed. Logs:"
  docker compose -f "$COMPOSE_FILE" logs --tail 80
  exit 1
fi

echo "==> [2/4] Waiting for the journey to finish..."
docker compose -f "$COMPOSE_FILE" wait "$SERVICE_NAME"

echo "==> [3/4] Saving the logs of every container..."
# Missing or truncated logs would let the scan below pass as clean: stop instead.
if ! docker compose -f "$COMPOSE_FILE" logs --no-color > "$REPORT_DIR/containers.log" \
  || [ ! -s "$REPORT_DIR/containers.log" ]; then
  echo "Could not save the container logs: the marker search would not be reliable."
  exit 1
fi
docker compose -f "$COMPOSE_FILE" logs --no-color --tail 40 "$SERVICE_NAME"
docker compose -f "$COMPOSE_FILE" down -v

echo "==> [4/4] Searching the logs for the marker..."
docker run --rm -v "$PWD/$REPORT_DIR:/report" -v "$PWD/$CICD_DIR/tests/gdpr:/engine:ro" \
  node:24-bookworm-slim node /engine/marker/scan.mjs /report
EXIT_CODE=$?

# The scanner searches the marker's values and the captures marked sensitive, not the env values the
# journey sends: the admin JWT of the run is searched here, whole and by its signature (what survives a
# truncated line), and never printed.
if grep -qF -e "$ADMIN_JWT" -e "${ADMIN_JWT##*.}" "$REPORT_DIR/containers.log"; then
  echo "The admin JWT of the run appears in the container logs."
  printf '\n**❌ The admin JWT of the run appears in the container logs.**\n' >> "$REPORT_DIR/summary.md"
  EXIT_CODE=1
fi

echo "----------------------------------------"
echo "Final exit code: $EXIT_CODE"
echo "----------------------------------------"

exit $EXIT_CODE
