#!/bin/bash

COMMIT_HASH=$1

# Jeśli hash nie został podany jako argument, zapytaj o niego interaktywnie
if [ -z "$COMMIT_HASH" ]; then
    echo "--- Nie podano hashu commita. ---"
    echo "Ostatnie 5 commitów:"
    # Wyświetla krótką listę: hash | autor | data | temat
    git log -n 5 --pretty=format:"%h - %an, %ar : %s"
    echo -e "\n"

    read -p "Wpisz hash commita, do którego chcesz wrócić: " COMMIT_HASH
fi

# Sprawdzenie czy użytkownik ostatecznie podał jakąkolwiek wartość
if [ -z "$COMMIT_HASH" ]; then
    echo "Błąd: Nie podano hashu. Operacja przerwana."
    exit 1
fi

echo "--- Rozpoczynam Rollback do wersji: $COMMIT_HASH ---"

# 1. Cofnięcie zmian do podanego hashu (usuwa zmiany w śledzonych plikach)
git reset --hard $COMMIT_HASH

# 2. Reinstalacja zależności (ważne, jeśli w tamtej wersji package.json był inny)
if [ -f "package.json" ]; then
    echo "Aktualizuję zależności npm dla wybranej wersji..."
    npm install
fi

echo "--- Rollback zakończony! ---"
echo "Obecna wersja (HEAD) to teraz: $COMMIT_HASH"
