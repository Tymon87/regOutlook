#!/bin/bash

echo "--- Rozpoczynam Deploy: regOutlook ---"

# 1. Pobranie najnowszych zmian z repozytorium
git fetch origin main [cite: 2]
git reset --hard origin/main [cite: 2]

# 2. Instalacja/Aktualizacja zależności npm
if [ -f "package.json" ]; then
    echo "Instaluję zależności..."
    npm install
fi

# 3. Informacja o statusie
echo "--- Deploy zakończony sukcesem! ---"
echo "Aktualny Hash: $(git rev-parse HEAD)"
