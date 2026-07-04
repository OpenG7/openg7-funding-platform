#!/bin/bash
set -e

cd ~/openg7-funding-platform

echo "=== Vérification Docker ==="
docker --version
docker compose version

echo "=== Démarrage de l'application ==="
docker compose up -d

echo
echo "✅ Application démarrée."
docker ps