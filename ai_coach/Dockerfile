# Add-on di Home Assistant per AI Coach Flessioni.
# Scarica l'app da GitHub e la compila (better-sqlite3 ha un binario nativo).
ARG BUILD_FROM
FROM node:22-bookworm-slim

# Da quale repo/branch prendere l'app. Aggiorna REF se sposti il codice su main.
ARG REPO=https://github.com/rammkorn/ai-coach
ARG REF=main

RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 build-essential ca-certificates \
 && git clone --depth 1 --branch "${REF}" "${REPO}" /app \
 && cd /app && npm ci --omit=dev \
 && apt-get purge -y --auto-remove git build-essential python3 \
 && rm -rf /var/lib/apt/lists/* /root/.npm

WORKDIR /app

# Porta e database persistente: /data sopravvive a riavvii e aggiornamenti.
ENV PORT=3000 COACH_DB=/data/coach.db
RUN mkdir -p /data

# Legge le opzioni dell'add-on (es. vapid_contact) e avvia il server.
COPY run.sh /run.sh
RUN chmod +x /run.sh
CMD ["/run.sh"]
