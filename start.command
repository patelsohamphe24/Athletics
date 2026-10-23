#!/usr/bin/env bash
# One-click launcher for macOS / Linux:  ./start.sh   (or double-click start.command on macOS)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Node.js is not installed. Get the LTS version from https://nodejs.org then run this again."; exit 1; fi
[ -d node_modules ] || { echo "Installing dependencies (first run only)..."; npm install --omit=dev || exit 1; }
export PORT=${PORT:-3000} ADMIN_PASSWORD=${ADMIN_PASSWORD:-iitbhu11}
export SESSION_SECRET=${SESSION_SECRET:-iitbhu-athletics-local-secret-change-me-0123456789}
export DATA_DIR=${DATA_DIR:-$PWD/data}
echo; echo " Website: http://localhost:$PORT   (keep this window open)"; echo
(sleep 2; (command -v open >/dev/null && open "http://localhost:$PORT") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT") || true) &
exec node server.js
