#!/usr/bin/env bash
# Avvia l'app e la espone su un URL pubblico HTTPS (tramite Cloudflare Tunnel),
# così la puoi aprire SUBITO dal telefono con telecamera/microfono/notifiche
# pienamente funzionanti (richiedono HTTPS).
#
# Uso:  bash scripts/share.sh        (oppure:  npm run share)
set -e

PORT="${PORT:-3000}"
cd "$(dirname "$0")/.."

echo "▶︎  Avvio del server sulla porta $PORT…"
PORT="$PORT" node server.js &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
sleep 1

echo "🌐  Creo il tunnel HTTPS pubblico (Cloudflare)…"
echo "    Apri l'URL https://…trycloudflare.com che comparirà qui sotto sul telefono."
echo ""
npx --yes cloudflared tunnel --url "http://localhost:$PORT"
