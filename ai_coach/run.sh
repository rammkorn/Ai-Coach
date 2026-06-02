#!/usr/bin/env sh
# Estrae l'opzione vapid_contact (se presente) dalle opzioni dell'add-on e avvia
# il server. /data/options.json è fornito dal Supervisor di Home Assistant.
if [ -f /data/options.json ]; then
  VAPID_CONTACT="$(node -e "try{process.stdout.write((require('/data/options.json').vapid_contact)||'')}catch(e){}" 2>/dev/null)"
  export VAPID_CONTACT
fi
echo "[AI Coach] Avvio sul porto ${PORT} — DB: ${COACH_DB}"
exec node server.js
