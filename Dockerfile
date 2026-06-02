# Immagine pronta al deploy (Render, Fly.io, Railway, VPS…).
FROM node:22-slim
WORKDIR /app

# Dipendenze (better-sqlite3 ha un binario nativo: serve build-essential).
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential \
    && npm ci --omit=dev \
    && apt-get purge -y build-essential python3 && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY . .

ENV PORT=3000
# Persisti il database su un volume montato qui per non perdere i profili.
ENV COACH_DB=/data/coach.db
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
