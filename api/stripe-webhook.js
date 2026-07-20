// Fonction serverless Vercel : POST /api/stripe-webhook
// Reçoit les événements Stripe. Sur "checkout.session.completed" :
//   1. vérifie la signature (STRIPE_WEBHOOK_SECRET)
//   2. marque la réservation comme payée dans Supabase — premier arrivé,
//      premier payé, gagne le créneau (voir statutHeures côté client, qui ne
//      bloque un créneau que pour les réservations effectivement payées)
//   3. annule automatiquement les autres demandes ACCEPTÉES mais non payées
//      qui chevauchent ce même créneau, et prévient leurs auteurs par email
//   4. désactive le lien de paiement pour éviter un double règlement
// L'app se met à jour toute seule grâce à l'abonnement temps réel Supabase.
//
// Utilise la clé service_role (via lib/supabaseAdmin) : depuis la sécurisation
// RLS, la clé publique ne peut plus modifier reservations. Ce webhook, appelé
// uniquement par Stripe après vérification de signature, doit contourner le RLS.

import crypto from 'crypto';
import { selectUn, selectPlusieurs, upsert } from '../lib/supabaseAdmin.js';

const TAMPON = 0.5; // 30 minutes, doit rester cohérent avec le calcul côté client (src/App.jsx)

// Deux réservations sont en conflit si elles ne respectent pas entre elles le
// tampon de 30 min (même règle que côté client pour une nouvelle réservation :
// src/App.jsx, tamponsOk). Deux réservations exactement séparées par le tampon
// (ex. 14h-16h puis 16h30-18h) NE sont PAS en conflit — le tampon est partagé.
function seChevauchent(a, b) {
  const aDebut = parseFloat(a.heureDebut), aFin = parseFloat(a.heureFin);
  const bDebut = parseFloat(b.heureDebut), bFin = parseFloat(b.heureFin);
  const separees = (aFin + TAMPON <= bDebut) || (bFin + TAMPON <= aDebut);
  return !separees;
}

// Envoi d'email direct via Resend (le webhook est server-side, il ne peut pas
// réutiliser src/emails.js qui est écrit pour le navigateur)
async function envoyerEmailDirect(destinataire, sujet, html) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY || !destinataire) return false;
  try {
    const rep = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'My Piscine Privée <contact@mypiscineprivee.com>', to: [destinataire], subject: sujet, html }),
    });
    if (!rep.ok) console.error('Erreur Resend (webhook):', await rep.text());
    return rep.ok;
  } catch (e) {
    console.error('Erreur réseau Resend (webhook):', e);
    return false;
  }
}

function formatHeure(h) {
  const n = parseFloat(h);
  const heure = Math.floor(n) % 24;
  const minutes = Math.round((n - Math.floor(n)) * 60);
  return `${heure}h${String(minutes).padStart(2, '0')}`;
}

function emailCreneauPerdu(r) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #F7F0E6; padding: 24px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="font-size: 32px;">🏊</div>
        <div style="font-size: 20px; font-weight: 700; color: #0B6E8A; margin-top: 4px;">My Piscine Privée</div>
      </div>
      <div style="background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 4px 12px rgba(11,110,138,.08);">
        <h2 style="color: #FF6B6B; margin-top: 0;">⏱️ Créneau attribué à un autre client</h2>
        <p style="color: #2C3E50; font-size: 14px;">Bonjour ${r.prenom || ''}, votre demande avait bien été acceptée, mais un autre client a réglé ce créneau avant vous :</p>
        <table style="width: 100%; margin: 16px 0;">
          <tr><td style="padding:4px 0;color:#5a8a96;font-size:13px;">Référence</td><td style="padding:4px 0;color:#2C3E50;font-size:13px;font-weight:600;text-align:right;">${r.ref}</td></tr>
          <tr><td style="padding:4px 0;color:#5a8a96;font-size:13px;">Date</td><td style="padding:4px 0;color:#2C3E50;font-size:13px;font-weight:600;text-align:right;">${r.date}</td></tr>
          <tr><td style="padding:4px 0;color:#5a8a96;font-size:13px;">Créneau</td><td style="padding:4px 0;color:#2C3E50;font-size:13px;font-weight:600;text-align:right;">${formatHeure(r.heureDebut)} → ${formatHeure(r.heureFin)}</td></tr>
        </table>
        <p style="color: #2C3E50; font-size: 14px;">Aucune somme ne vous a été prélevée. N'hésitez pas à choisir un autre créneau — n'attendez pas trop longtemps pour régler la prochaine fois afin de garantir votre place !</p>
      </div>
    </div>`;
}

// Lecture du corps brut (indispensable pour vérifier la signature Stripe)
async function lireCorpsBrut(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

// Vérification de la signature Stripe (header "stripe-signature": t=...,v1=...)
function signatureValide(rawBody, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  // Tolérance de 5 minutes contre le rejeu
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const attendu = crypto.createHmac('sha256', secret)
    .update(`${t}.${rawBody.toString('utf8')}`)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(attendu, 'hex'), Buffer.from(v1, 'hex'));
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'Configuration serveur manquante (secret webhook)' });
  }

  let rawBody;
  try { rawBody = await lireCorpsBrut(req); }
  catch { return res.status(400).json({ error: 'Corps illisible' }); }

  if (!signatureValide(rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'Signature invalide' });
  }

  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.status(400).json({ error: 'JSON invalide' }); }

  // On ne traite que la finalisation d'un paiement
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data?.object || {};
  const ref = session.metadata?.ref;
  if (!ref) {
    console.error('Webhook sans ref dans metadata', session.id);
    return res.status(200).json({ received: true });
  }

  try {
    // 1. Lire la réservation payée (service_role : bypass RLS)
    const row = await selectUn('reservations', 'ref', ref, 'data');
    if (!row) {
      console.error('Réservation introuvable pour le webhook:', ref);
      return res.status(200).json({ received: true });
    }
    const data = row.data;

    // Déjà traité (webhook potentiellement reçu plusieurs fois) : rien à refaire
    if (data.paiement?.statut === 'paye') {
      return res.status(200).json({ received: true, deja: true });
    }

    data.paiement = {
      ...(data.paiement || {}),
      statut: 'paye',
      datePaiement: new Date().toISOString(),
      montantPaye: (session.amount_total || 0) / 100,
      sessionId: session.id,
      ...(session.payment_intent ? { paymentIntentId: session.payment_intent } : {}),
    };

    await upsert('reservations', {
      ref, data,
      date: data.date, email: data.email, statut: data.statut || 'en_attente',
      updated_at: new Date().toISOString(),
    });

    // 2. Premier arrivé, premier payé : annuler les autres demandes acceptées
    //    mais non payées qui chevauchent ce même créneau, et prévenir leurs auteurs
    try {
      const autresDuJour = await selectPlusieurs('reservations', 'date', data.date, 'ref,data');
      for (const autre of autresDuJour) {
        if (autre.ref === ref) continue;
        const ad = autre.data;
        if (ad.statut !== 'acceptee' || ad.paiement?.statut === 'paye') continue;
        if (!seChevauchent(data, ad)) continue;
        ad.statut = 'annulee';
        ad.motifAnnulation = 'Créneau réglé par un autre client avant vous';
        ad.annulationConflitPaiement = true;
        await upsert('reservations', {
          ref: autre.ref, data: ad,
          date: ad.date, email: ad.email, statut: 'annulee',
          updated_at: new Date().toISOString(),
        });
        await envoyerEmailDirect(ad.email, `Créneau attribué à un autre client — ${autre.ref}`, emailCreneauPerdu(ad));
      }
    } catch (e) {
      // Ne bloque pas la confirmation du paiement principal si cette étape échoue
      console.error('Erreur résolution de conflit de créneau:', e);
    }

    // 3. Désactiver le lien de paiement (évite un double paiement)
    if (session.payment_link && STRIPE_SECRET_KEY) {
      await fetch(`https://api.stripe.com/v1/payment_links/${session.payment_link}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ active: 'false' }),
      }).catch(e => console.error('Désactivation lien échouée:', e));
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('Erreur webhook:', e);
    // 500 → Stripe réessaiera automatiquement. On inclut le détail pour le
    // diagnostic (visible dans Stripe Dashboard → Webhooks → événement → réponse).
    return res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
}
