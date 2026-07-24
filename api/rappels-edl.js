// Fonction serverless Vercel : GET|POST /api/rappels-edl
//
// Envoie un SMS de rappel aux locataires qui n'ont pas encore rempli leur état
// des lieux de sortie alors que leur session se termine dans 15 minutes.
//
// Cette fonction ne se déclenche pas toute seule : elle doit être appelée
// régulièrement (toutes les 5 à 10 minutes) par un planificateur externe, par
// exemple cron-job.org. Le plan gratuit de Vercel limite en effet ses propres
// tâches programmées à une exécution par jour, avec une imprécision d'une heure,
// ce qui est incompatible avec un rappel à la minute près.
//
// Protection : l'appel doit porter le secret RAPPELS_SECRET, sinon n'importe qui
// pourrait déclencher des envois de SMS à répétition (et vider le crédit Twilio).

import { selectPlusieurs, upsert } from '../lib/supabaseAdmin.js';

const SITE_URL = 'https://mypiscineprivee.com';
const MINUTES_AVANT_FIN = 15;   // on rappelle 15 min avant la fin de session
const MINUTES_DE_GRACE = 45;    // au-delà, il est trop tard : on n'envoie plus rien

// Heure courante en France, quel que soit le fuseau du serveur (Vercel tourne en UTC)
function maintenantEnFrance() {
  const partes = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const v = type => partes.find(p => p.type === type).value;
  return {
    dateISO: `${v('year')}-${v('month')}-${v('day')}`,
    heureDecimale: parseInt(v('hour'), 10) + parseInt(v('minute'), 10) / 60,
  };
}

function normaliserTelephoneFR(tel) {
  const chiffres = (tel || '').replace(/\D/g, '');
  if (chiffres.startsWith('33') && chiffres.length === 11) return '+' + chiffres;
  if (chiffres.startsWith('0') && chiffres.length === 10) return '+33' + chiffres.slice(1);
  return chiffres ? '+' + chiffres : null;
}

function formatHeure(h) {
  const n = parseFloat(h);
  return `${Math.floor(n) % 24}h${String(Math.round((n - Math.floor(n)) * 60)).padStart(2, '0')}`;
}

async function envoyerSms(destinataire, message) {
  const SID = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const NUMERO = process.env.TWILIO_PHONE_NUMBER;
  const SENDER_ID = process.env.TWILIO_SENDER_ID;
  if (!SID || !TOKEN || !NUMERO) {
    console.error('Rappel EDL : variables Twilio absentes dans Vercel.');
    return false;
  }
  try {
    const rep = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: destinataire,
        From: (SENDER_ID && SENDER_ID.trim()) || NUMERO,
        Body: message,
      }),
    });
    if (!rep.ok) {
      const err = await rep.json().catch(() => ({}));
      console.error(`Rappel EDL non envoyé vers ${destinataire} — Twilio ${err.code || '?'} : ${err.message || 'erreur inconnue'}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Rappel EDL : erreur réseau Twilio', e);
    return false;
  }
}

export default async function handler(req, res) {
  // Vérification du secret, accepté en en-tête Authorization ou en paramètre
  const secretAttendu = process.env.RAPPELS_SECRET;
  if (!secretAttendu) {
    return res.status(500).json({ error: 'RAPPELS_SECRET non configuré côté serveur' });
  }
  const fourni = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query?.secret;
  if (fourni !== secretAttendu) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  try {
    const { dateISO, heureDecimale } = maintenantEnFrance();
    const dujour = await selectPlusieurs('reservations', 'date', dateISO, 'ref,data');

    let envoyes = 0;
    const ignorees = [];

    for (const ligne of dujour) {
      const r = ligne.data;
      if (!r) continue;

      const statut = r.statut || 'acceptee';
      const fin = parseFloat(r.heureFin);
      // Conditions cumulatives : session réellement en cours de se terminer,
      // état des lieux d'entrée fait, sortie pas encore remplie, et pas déjà rappelé.
      if (statut !== 'acceptee') { ignorees.push(`${ligne.ref}: statut ${statut}`); continue; }
      if (r.edlSortieFait) { ignorees.push(`${ligne.ref}: sortie déjà faite`); continue; }
      if (r.rappelSortieEnvoye) { ignorees.push(`${ligne.ref}: rappel déjà envoyé`); continue; }
      if (Number.isNaN(fin)) { ignorees.push(`${ligne.ref}: heure de fin illisible`); continue; }

      const minutesRestantes = (fin - heureDecimale) * 60;
      if (minutesRestantes > MINUTES_AVANT_FIN) { ignorees.push(`${ligne.ref}: trop tôt`); continue; }
      if (minutesRestantes < -MINUTES_DE_GRACE) { ignorees.push(`${ligne.ref}: trop tard`); continue; }

      const destinataire = normaliserTelephoneFR(r.telephone);
      if (!destinataire) { ignorees.push(`${ligne.ref}: pas de téléphone`); continue; }

      const message = `🏊 My Piscine Privée : votre session se termine à ${formatHeure(fin)}. Merci de réaliser l'état des lieux de sortie avant de partir : ${SITE_URL} (rubrique Mes réservations). Réf ${r.ref}`;
      const ok = await envoyerSms(destinataire, message);

      if (ok) {
        // Marquage immédiat : garantit qu'un seul rappel part, même si le
        // planificateur rappelle cette fonction quelques minutes plus tard.
        await upsert('reservations', {
          ref: ligne.ref,
          data: { ...r, rappelSortieEnvoye: true, rappelSortieDate: new Date().toISOString() },
          date: r.date,
          email: r.email,
          statut: r.statut || 'acceptee',
          updated_at: new Date().toISOString(),
        });
        envoyes++;
      }
    }

    console.log(`Rappels EDL — ${dateISO} ${heureDecimale.toFixed(2)}h : ${envoyes} envoyé(s), ${ignorees.length} ignorée(s).`);
    return res.status(200).json({ ok: true, envoyes, examinees: dujour.length });
  } catch (e) {
    console.error('Erreur rappels EDL :', e);
    return res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
}
