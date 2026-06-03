#!/usr/bin/env sh
# Legge le opzioni dell'add-on (/data/options.json, fornito dal Supervisor) e le
# passa al server come variabili d'ambiente, poi avvia l'app.
opt() {
  node -e "try{process.stdout.write(String((require('/data/options.json')['$1'])||''))}catch(e){}" 2>/dev/null
}
if [ -f /data/options.json ]; then
  export VAPID_CONTACT="$(opt vapid_contact)"
  export ADMIN_RESET_PROFILE="$(opt reset_profile)"
  export ADMIN_RESET_PASSWORD="$(opt reset_password)"
fi
echo "[AI Coach] Avvio sul porto ${PORT} — DB: ${COACH_DB}"
exec node server.js
