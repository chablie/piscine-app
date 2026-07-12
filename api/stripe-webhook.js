// Fonction serverless Vercel : POST /api/stripe-webhook
// Reçoit les événements Stripe. Sur "checkout.session.completed" :
//   1. vérifie la signature (STRIPE_WEBHOOK_SECRET)
//   2. marque la réservation comme payée dans Supabase
//   3. désactive le lien de paiement pour éviter un double règlement
// L'app se met à jour toute seule grâce à l'abonnement temps réel Supabase.
//
// Utilise la clé service_role (via lib/supabaseAdmin) : depuis la sécurisation
// RLS, la clé publique ne peut plus modifier reservations. Ce webhook, appelé
// uniquement par Stripe après vérification de signature, doit contourner le RLS.

import crypto from 'crypto';
import { selectUn, upsert } from '../lib/supabaseAdmin.js';

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
    // 1. Lire la réservation (service_role : bypass RLS)
    const row = await selectUn('reservations', 'ref', ref, 'data');
    if (!row) {
      console.error('Réservation introuvable pour le webhook:', ref);
      return res.status(200).json({ received: true });
    }
    const data = row.data;

    // 2. Deux cas selon le type de session :
    //    - payment_status "unpaid"  → empreinte déposée (capture manuelle), débit à l'acceptation
    //    - payment_status "paid"    → paiement effectif (lien de paiement de secours)
    if (session.payment_status === 'paid') {
      data.paiement = {
        ...(data.paiement || {}),
        statut: 'paye',
        datePaiement: new Date().toISOString(),
        montantPaye: (session.amount_total || 0) / 100,
        sessionId: session.id,
        ...(session.payment_intent ? { paymentIntentId: session.payment_intent } : {}),
      };
    } else {
      data.paiement = {
        ...(data.paiement || {}),
        statut: 'empreinte_ok',
        dateEmpreinte: new Date().toISOString(),
        montant: (session.amount_total || 0) / 100,
        sessionId: session.id,
        paymentIntentId: session.payment_intent || null,
      };
    }

    await upsert('reservations', { ref, data, updated_at: new Date().toISOString() });

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
    // 500 → Stripe réessaiera automatiquement
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
