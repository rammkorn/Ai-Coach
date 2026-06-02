# 💪 AI Coach Flessioni

Web app (PWA) che fa da **coach auto-evolutivo** per migliorare nelle flessioni.
Costruisce un programma di progressione il più efficiente possibile — anche più
volte al giorno — e **si adatta automaticamente** alla risposta fisica di chi si
allena, sessione dopo sessione, per non far desistere la persona.

## Cosa fa

- **Profili con password** — nella prima pagina scegli un profilo esistente
  (login con password) oppure ne crei uno nuovo. Tutto è salvato.
- **Un solo file di database** — profili, sessioni, ripetizioni e stato del
  coach vivono in un unico file SQLite (`coach.db`).
- **Coach AI adattivo** — dopo ogni sessione ricalcola ripetizioni, serie,
  ritmo, recupero e numero di sessioni al giorno in base a tre segnali reali:
  - **completamento** (quante ripetizioni hai chiuso sul previsto),
  - **precisione del ritmo** (quante ripetizioni sono nel tempo ideale),
  - **scarto di cadenza**: troppo **veloce** = poco sforzo reale → il ritmo
    rallenta per aumentare il tempo sotto tensione; troppo **lento** = troppa
    fatica → meno volume e più recupero.
  - Tiene conto anche delle **sessioni saltate**: se sparisci per giorni,
    rientri più morbido e con messaggi di incoraggiamento.
- **Barra del ritmo animata** — una barra colorata scorre in ciclo
  *giù → pausa → su* e ti detta il tempo ideale di ogni piegamento.
- **Rilevamento del movimento** in ordine di comodità, con scelta a inizio
  sessione:
  1. **Sensore di prossimità** (telefono a terra, avvicini il petto),
  2. **Telecamera frontale** (il volto che entra/esce dal quadro),
  3. **Microfono** (conti i piegamenti a voce — te lo ricorda quando lo scegli),
  4. **Touch col naso** — un grande pulsante centrale **sempre attivo** come
     riserva, anche quando un altro sensore è in uso.
- **Modalità MAX** — quando sei in forma e in striscia positiva, a fine
  sessione il coach ti propone di "dare il massimo" con un **cambio totale
  dell'interfaccia** (tema rosso pulsante) per motivarti.
- **Cue audio + voce** — beep e voce ("giù"/"su") sincronizzati con la barra,
  così segui il ritmo **senza guardare lo schermo** (durante una flessione
  guardi il pavimento). Interruttore 🔊 nella schermata di allenamento.
- **Grafico dei progressi** — ripetizioni per sessione nel tempo, con la
  precisione del ritmo in sovrapposizione e le sessioni MAX evidenziate.
- **Schermo sempre acceso** durante l'allenamento (Screen Wake Lock).
- **Promemoria push reali** — notifiche Web Push (VAPID) per riprendere
  l'allenamento, **anche ad app chiusa** se il server è attivo. La frequenza si
  adatta alle sessioni/giorno consigliate. Fallback locale dove il push non c'è.

## Avvio rapido

```bash
npm install
npm start
# apri http://localhost:3000
```

## 📱 Provarla dal telefono (con tutti i sensori)

I sensori (telecamera, microfono, prossimità) e le notifiche push richiedono un
**contesto sicuro**: `localhost` va bene sul computer, ma da telefono serve
**HTTPS**. Il modo più veloce è un tunnel pubblico:

```bash
npm run share
```

Questo avvia il server **e** crea un URL HTTPS pubblico tramite Cloudflare
Tunnel (es. `https://qualcosa.trycloudflare.com`): aprilo sul telefono e usa
telecamera/microfono/notifiche reali. Nessun account richiesto.

> Alternative: `npx ngrok http 3000`, oppure mettila online con il `Dockerfile`
> incluso (Render/Fly.io/Railway/VPS). Senza HTTPS, il **pulsante naso**
> funziona comunque sempre come riserva.

## Architettura

```
server.js              Server Express + API REST + autenticazione a token
src/db.js              Database SQLite (file unico) e helper, hashing password (scrypt)
src/coach.js           Motore adattivo: ritmo, progressione, modalità MAX
src/push.js            Web Push (VAPID): invio notifiche + scheduler promemoria
public/index.html      Shell della SPA (3 schermate + overlay)
public/css/styles.css  Tema mobile-first, barra del ritmo, tema MODALITÀ MAX
public/js/app.js       Routing schermate, dashboard, overlay risultati
public/js/api.js        Wrapper sull'API REST
public/js/detection.js Rilevamento: prossimità / telecamera (FaceDetector) / microfono / touch
public/js/workout.js   Barra del ritmo + cronometraggio, audio cue, wake lock
public/js/audio.js     Cue audio/voce sincronizzati col ritmo
public/js/chart.js     Grafico SVG dei progressi
public/sw.js           Service worker (offline + push)
scripts/share.sh       Avvio + tunnel HTTPS pubblico per il telefono
Dockerfile             Immagine pronta al deploy
```

## API principali

| Metodo | Endpoint | Descrizione |
|---|---|---|
| `GET`  | `/api/profiles` | Elenco profili (per la schermata iniziale) |
| `POST` | `/api/profiles` | Crea profilo (nome, password, livello) |
| `POST` | `/api/login` | Login con password → token |
| `GET`  | `/api/me` | Dashboard: statistiche, storico, piano consigliato |
| `POST` | `/api/sessions` | Avvia una sessione (opzione `max_mode`) |
| `POST` | `/api/sessions/:id/rep` | Registra una ripetizione (durata reale) |
| `POST` | `/api/sessions/:id/finish` | Chiude la sessione, fa evolvere il piano |
| `GET`  | `/api/push/key` | Chiave pubblica VAPID per il client |
| `POST` | `/api/push/subscribe` | Registra il dispositivo per i promemoria |
| `POST` | `/api/push/test` | Invia una notifica di prova |

Il file del database è impostabile con la variabile d'ambiente `COACH_DB`, la
porta con `PORT`.
