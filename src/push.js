// Web Push (VAPID): invio di notifiche reali e scheduler dei promemoria.
// Le chiavi VAPID vengono generate una volta e salvate nel DB così da restare
// stabili tra i riavvii. Se il server è spento i promemoria non partono (è il
// limite del push lato server): il client mantiene comunque un fallback locale.
import webpush from 'web-push';
import { getMeta, setMeta, subsForProfile, deleteSub, dueReminders, rescheduleReminder } from './db.js';

let publicKey = null;

export function initPush() {
  let pub = getMeta('vapid_public');
  let priv = getMeta('vapid_private');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey; priv = keys.privateKey;
    setMeta('vapid_public', pub);
    setMeta('vapid_private', priv);
  }
  const contact = process.env.VAPID_CONTACT || 'mailto:coach@example.com';
  webpush.setVapidDetails(contact, pub, priv);
  publicKey = pub;
  return pub;
}

export function getPublicKey() { return publicKey; }

const MESSAGES = [
  'È ora di allenarsi! Le tue flessioni ti aspettano. 💪',
  'Pausa finita: due serie veloci e torni più forte. 🔥',
  'Il tuo coach ti chiama: bastano pochi minuti. Andiamo!',
  'Non perdere la striscia! Una sessione e sei a posto. ⚡',
];

export async function sendToProfile(profileId, payload) {
  const subs = subsForProfile(profileId);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify(payload));
    } catch (err) {
      // 404/410 = iscrizione non più valida: la rimuoviamo.
      if (err.statusCode === 404 || err.statusCode === 410) deleteSub(s.endpoint);
    }
  }));
}

// Controlla periodicamente i promemoria scaduti e invia le notifiche.
export function startScheduler() {
  const tick = async () => {
    const now = new Date().toISOString();
    let due;
    try { due = dueReminders(now); } catch { return; }
    for (const p of due) {
      const body = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
      await sendToProfile(p.id, { title: 'AI Coach Flessioni', body, url: '/' });
      // Riprogramma il prossimo nudge in base all'intervallo scelto.
      rescheduleReminder(p.id, p.reminder_interval_h || 8);
    }
  };
  setInterval(tick, 60 * 1000); // ogni minuto
  tick();
}
