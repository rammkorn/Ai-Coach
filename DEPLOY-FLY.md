# Deploy su Fly.io — provarla in ~5 minuti

Ottieni un **URL HTTPS pubblico e stabile** (es. `https://il-tuo-nome.fly.dev`)
con telecamera, microfono, prossimità e **notifiche push** funzionanti.

> Serve un account Fly.io. La registrazione richiede una **carta di credito**
> (anche per l'allowance di prova): non viene addebitato nulla se resti nei
> limiti di una piccola app, ma è bene saperlo.

## Passi

```bash
# 1) Installa la CLI di Fly (flyctl)
#    macOS/Linux:
curl -L https://fly.io/install.sh | sh
#    Windows (PowerShell):  iwr https://fly.io/install.ps1 -useb | iex

# 2) Accedi (si apre il browser)
fly auth login

# 3) Dalla cartella del progetto, crea l'app riusando la config inclusa.
#    Scegli un nome UNICO (sostituisci IL-TUO-NOME).
fly launch --copy-config --no-deploy --name IL-TUO-NOME --region fra

# 4) Deploy 🚀
fly deploy

# 5) Apri l'app
fly open
```

Apri quell'URL `https://…fly.dev` **sul telefono**: crea un profilo con password,
attiva i promemoria con il pulsante 🔔 e allenati. Tutti i sensori funzionano
perché Fly serve l'app in HTTPS.

## (Opzionale) Database persistente tra i redeploy

Senza volume, i profili restano tra i riavvii della macchina ma si perdono a
ogni `fly deploy`. Per renderli permanenti:

```bash
fly volumes create coach_data --size 1 --region fra
```

poi **scommenta** la sezione `[mounts]` in `fly.toml` e rilancia `fly deploy`.

## Note utili

```bash
fly logs        # log in tempo reale
fly status      # stato della macchina
fly secrets set VAPID_CONTACT="mailto:tua@email.it"   # opzionale, contatto VAPID
fly apps destroy IL-TUO-NOME   # rimuove tutto quando hai finito
```

- La memoria è impostata a 256 MB: se vedi riavvii per OOM, alza a 512 MB con
  `memory = "512mb"` in `fly.toml`.
- Le **chiavi VAPID** per le notifiche vengono generate e salvate nel database
  al primo avvio: restano stabili finché non cancelli il DB.
