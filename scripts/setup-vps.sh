#!/bin/bash
set -e

echo "=== Mise à jour du système ==="
sudo apt update
sudo apt upgrade -y

echo "=== Installation de Git ==="
sudo apt install -y git

echo "=== Clonage du dépôt ==="
git clone https://github.com/OpenG7/openg7-funding-platform.git

echo "=== Installation de Docker ==="
curl -fsSL https://get.docker.com | sudo sh

echo "=== Ajout de l'utilisateur au groupe docker ==="
sudo usermod -aG docker "$USER"

echo
echo "✅ Installation terminée."
echo "⚠️ Déconnecte-toi puis reconnecte-toi exen SSH avant de lancer le script 2."