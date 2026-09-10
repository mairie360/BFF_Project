#!/usr/bin/env bash

COMPOSE_FILE="docker-compose-security.yml"
SERVICE_NAME="security-scan"

echo "==> [1/4] Démarrage de la stack et lancement du scan ZAP..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> [2/4] Attente de la fin du scan de sécurité..."
docker compose -f "$COMPOSE_FILE" wait "$SERVICE_NAME"
EXIT_CODE=$?

echo "==> [3/4] Affichage du rapport (logs)..."
docker compose -f "$COMPOSE_FILE" logs "$SERVICE_NAME"

echo "==> [4/4] Nettoyage des conteneurs..."
docker compose -f "$COMPOSE_FILE" down -v

echo "----------------------------------------"
echo "Code de sortie final : $EXIT_CODE"
echo "----------------------------------------"

exit $EXIT_CODE
