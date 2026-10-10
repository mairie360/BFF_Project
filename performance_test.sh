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

# Random JWT_SECRET for this run and the JWTs signed with it (MAIR-474): nothing is signed with
# a committed secret.
# shellcheck source=stack_secrets.sh
source ./stack_secrets.sh || exit 1

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

# Same CPUs as the CI runner (MAIR-474): ubuntu-latest gives 4 vCPU to the API, Postgres, Redis
# and k6 together. Every service of the stack is pinned to the first min(PERF_CPUS, nproc) CPUs
# (PERF_CPUS defaults to 4), so a local run measures what CI will; on the runner it changes nothing.
PERF_CPUS="${PERF_CPUS:-4}"
CPUS=$(nproc)
[ "$CPUS" -gt "$PERF_CPUS" ] && CPUS="$PERF_CPUS"
CPUSET_FILE="$(mktemp --suffix=.yml)"
trap 'rm -f "$CPUSET_FILE"' EXIT
{
    echo "services:"
    for service in $(docker compose -f "$COMPOSE_FILE" config --services); do
        printf '  %s:\n    cpuset: "0-%d"\n' "$service" "$((CPUS - 1))"
    done
} > "$CPUSET_FILE"
echo "==> Stack pinned to $CPUS CPUs (PERF_CPUS=$PERF_CPUS)"

echo "==> [1/4] Starting the stack and the k6 test..."
# Fresh volumes on every run (MAIR-474): a volume left by a previous run would hand the stack its
# rows (rows the scan deleted, a previous seed) instead of the seed under test.
docker compose -f "$COMPOSE_FILE" -f "$CPUSET_FILE" down -v --remove-orphans > /dev/null 2>&1
# A failed dependency (seeder, migration, upstream readiness) leaves the test container created but
# never started, and `docker compose wait` then reports its exit code as 0: fail here instead (MAIR-474).
if ! docker compose -f "$COMPOSE_FILE" -f "$CPUSET_FILE" up -d; then
    echo "==> The stack did not start: a dependency failed. Logs:"
    docker compose -f "$COMPOSE_FILE" -f "$CPUSET_FILE" logs --tail 80
    docker compose -f "$COMPOSE_FILE" -f "$CPUSET_FILE" down -v
    exit 1
fi

echo "==> [2/4] Waiting for the end of the k6 test..."
docker compose -f "$COMPOSE_FILE" -f "$CPUSET_FILE" wait "$SERVICE_NAME"
EXIT_CODE=$?

echo "==> [3/4] Printing the results (logs)..."
docker compose -f "$COMPOSE_FILE" -f "$CPUSET_FILE" logs "$SERVICE_NAME"

echo "==> [4/4] Removing the containers..."
docker compose -f "$COMPOSE_FILE" -f "$CPUSET_FILE" down -v

echo "----------------------------------------"
echo "Final exit code: $EXIT_CODE"
echo "----------------------------------------"

exit $EXIT_CODE
