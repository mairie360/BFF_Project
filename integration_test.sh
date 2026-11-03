#!/usr/bin/env bash

# Runs the Postman collection committed under tests/postman/ with newman against the BFF on its
# isolated stack (docker-compose-integration.yml, MAIR-262): published upstream API images, seeded
# database. The exit code of the `newman` service is the exit code of this script, so
# the promote-staging job fails on the first failing request (`--bail`). No Postman account is needed.
#
# The BFF under test is the image named by IMAGE_REF. CI sets it to the published
# ghcr.io/mairie360/bff-project:dev-<sha> image (the one promoted to staging and prod); when it is empty
# (local usage) the image is built from development.Dockerfile as bff-project:local.

COMPOSE_FILE="docker-compose-integration.yml"
SERVICE_NAME="newman"
REPORT_DIR="newman-reports"

if [ -z "${IMAGE_REF:-}" ]; then
  echo "==> [0/4] Building bff-project:local from development.Dockerfile..."
  docker build -f development.Dockerfile -t bff-project:local \
    --secret id=npmrc,src=.npmrc \
    --secret id=npm_token,env=NODE_AUTH_TOKEN \
    . || exit 1
  export IMAGE_REF="bff-project:local"
fi
echo "==> BFF under test: $IMAGE_REF"

# Fresh Ed25519 session key pair for this run (MAIR-428, MAIR-680): Core API holds it, the BFF and
# Project API only its public key. The seeded accounts have no known password and the Postman sandbox
# cannot sign EdDSA, so their JWTs are signed here like Core signs them and injected into newman, with
# a forgery (Core's kid, another key) the BFF must refuse. Nothing is signed with a committed key.
# shellcheck source=stack_secrets.sh
source ./stack_secrets.sh || exit 1
JWT_ADMIN="$ADMIN_JWT"
JWT_AGENT="$(sign_jwt 2 user 3600)" || exit 1
JWT_FORGED="$(sign_jwt 1 admin 3600 "$(openssl genpkey -algorithm ed25519 2>/dev/null)")" || exit 1
export JWT_ADMIN JWT_AGENT JWT_FORGED

# The newman container (non-root) writes its junit report here; the CI job publishes it.
rm -rf "$REPORT_DIR" && mkdir -p "$REPORT_DIR" && chmod a+rwx "$REPORT_DIR"

echo "==> [1/4] Starting the stack and the newman collection..."
# Fresh volumes on every run: a volume left by a previous run would hand the stack its rows instead
# of the seed under test.
docker compose -f "$COMPOSE_FILE" down -v --remove-orphans > /dev/null 2>&1
# A failed dependency (seeder, migration, upstream readiness) leaves the test container created but
# never started, and `docker compose wait` then reports its exit code as 0: fail here instead.
if ! docker compose -f "$COMPOSE_FILE" up -d; then
  echo "==> The stack did not start: a dependency failed. Logs:"
  docker compose -f "$COMPOSE_FILE" logs --tail 80
  docker compose -f "$COMPOSE_FILE" down -v
  exit 1
fi

echo "==> [2/4] Waiting for the newman collection to finish..."
docker compose -f "$COMPOSE_FILE" wait "$SERVICE_NAME"
EXIT_CODE=$?

echo "==> [3/4] Report (logs)..."
docker compose -f "$COMPOSE_FILE" logs "$SERVICE_NAME"

echo "==> [4/4] Removing the containers..."
docker compose -f "$COMPOSE_FILE" down -v

echo "----------------------------------------"
echo "Final exit code: $EXIT_CODE"
echo "----------------------------------------"

exit $EXIT_CODE
