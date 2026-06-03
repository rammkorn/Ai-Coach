# AI Coach Flessioni — Add-on Home Assistant

Coach AI auto-evolutivo per le flessioni, in esecuzione **sempre attiva** sul tuo
Home Assistant. Programma di progressione adattivo, ritmo guidato con barra e
audio, rilevamento del movimento (prossimità / telecamera / microfono / naso) e
**notifiche push** per riprendere l'allenamento. Tutto su un file SQLite
persistente in `/data` (sopravvive a riavvii e aggiornamenti).

## Installazione

1. **Impostazioni → Add-on → Store → ⋮ (in alto a destra) → Repository.**
2. Incolla: `https://github.com/rammkorn/ai-coach` e premi **Aggiungi**.
3. Trova **AI Coach Flessioni** nello store e premi **Installa** (la prima build
   richiede qualche minuto).
4. **Avvia** l'add-on. L'app ascolta sulla porta **8888**.

## Esporre con il tunnel Cloudflare (che hai già)

Nell'add-on **Cloudflared**, aggiungi alle opzioni un host che punta alla porta
8888 dell'host Home Assistant (usa l'IP locale del tuo HA):

```yaml
additional_hosts:
  - hostname: coach.iltuodominio.com
    service: http://192.168.1.X:8888   # IP locale del tuo Home Assistant
```

Poi crea in Cloudflare un record **CNAME** per `coach.iltuodominio.com` che punta
al tuo tunnel (come per gli altri servizi che già esponi). Riavvia l'add-on
Cloudflared.

Apri `https://coach.iltuodominio.com` dal telefono: HTTPS pubblico → telecamera,
microfono, prossimità e notifiche push funzionano tutti.

## Opzioni

| Opzione | Descrizione |
|---|---|
| `vapid_contact` | Email di contatto per le chiavi push VAPID (facoltativa). |
| `reset_profile` + `reset_password` | Reset password "amministrativo" per password dimenticate: scrivi il **nome** del profilo e la **nuova** password, **salva e riavvia** l'add-on. Poi **svuota di nuovo** i due campi. |

> Gli utenti possono anche **cambiare la propria password** e **cancellare lo
> storico delle sessioni** direttamente dall'app (sezione *Account* nella
> dashboard).

> Le chiavi VAPID vengono generate al primo avvio e salvate nel DB: restano
> stabili finché non cancelli `/data`.
