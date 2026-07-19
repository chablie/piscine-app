// Fonction serverless Vercel : POST /api/paiement
// Deux points d'entrée :
//   - creer-lien-paiement : lien de paiement Stripe envoyé après acceptation.
//   - rembourser : remboursement (total ou partiel) d'une réservation déjà
//     payée, déclenché automatiquement lors d'une annulation. Protégé par
//     session (propriétaire/admin uniquement) car c'est un mouvement d'argent réel.

import { selectUn, upsert } from '../lib/supabaseAdmin.js';
import { sessionDepuisRequete } from '../lib/session.js';

const SITE_URL = "https://mypiscineprivee.com";

async function lireReservation(ref) {
  const row = await selectUn('reservations', 'ref', ref, 'data');
  return row ? row.data : null;
}

async function ecrireReservation(ref, data) {
  await upsert('reservations', {
    ref, data,
    date: data.date, email: data.email, statut: data.statut || 'en_attente',
    updated_at: new Date().toISOString(),
  });
}

function montantAregler(r) {
  const total = Number(r.totalGeneral ?? r.prix ?? 0);
  return r.modePaiement === 'especes' ? Number(r.acompte ?? +(total * 0.20).toFixed(2)) : total;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Configuration serveur manquante (clé Stripe)' });

  const stripeHeaders = { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  const { action, ref } = req.body || {};
  if (!ref) return res.status(400).json({ error: 'Paramètre manquant (ref requis)' });

  try {
    const r = await lireReservation(ref);
    if (!r) return res.status(404).json({ error: 'Réservation introuvable' });

    // ── creer-lien-paiement : lien de paiement envoyé après acceptation ──
    if (action === 'creer-lien-paiement') {
      const montant = montantAregler(r);
      if (!montant || montant <= 0) return res.status(400).json({ error: 'Montant invalide' });
      const centimes = Math.round(montant * 100);
      const libelle = r.modePaiement === 'especes' ? `Acompte réservation piscine ${ref} (solde sur place)` : `Réservation piscine ${ref}`;
      const prixBody = new URLSearchParams({ currency: 'eur', unit_amount: String(centimes), 'product_data[name]': libelle });
      const prixRep = await fetch('https://api.stripe.com/v1/prices', { method: 'POST', headers: stripeHeaders, body: prixBody });
      const prix = await prixRep.json();
      if (!prixRep.ok) { console.error('Erreur Stripe (price):', prix); return res.status(502).json({ error: prix.error?.message || 'Erreur Stripe (prix)' }); }
      const lienBody = new URLSearchParams({
        'line_items[0][price]': prix.id, 'line_items[0][quantity]': '1', 'metadata[ref]': ref,
        'after_completion[type]': 'redirect', 'after_completion[redirect][url]': `${SITE_URL}/?paiement=succes&ref=${encodeURIComponent(ref)}`,
      });
      const lienRep = await fetch('https://api.stripe.com/v1/payment_links', { method: 'POST', headers: stripeHeaders, body: lienBody });
      const lien = await lienRep.json();
      if (!lienRep.ok) { console.error('Erreur Stripe (payment_link):', lien); return res.status(502).json({ error: lien.error?.message || 'Erreur Stripe (lien)' }); }
      return res.status(200).json({ url: lien.url, montant, lienId: lien.id });
    }

    // ── rembourser : remboursement total ou partiel d'une réservation payée ──
    if (action === 'rembourser') {
      const SESSION_SECRET = process.env.SESSION_SECRET;
      if (!SESSION_SECRET) return res.status(500).json({ error: 'Configuration serveur manquante' });
      const session = sessionDepuisRequete(req, ['proprio', 'admin'], SESSION_SECRET);
      if (!session) return res.status(401).json({ error: 'Non authentifié' });

      if (r.paiement?.statut !== 'paye') return res.status(400).json({ error: "Cette réservation n'a pas été payée, rien à rembourser." });
      const paymentIntentId = r.paiement?.paymentIntentId;
      if (!paymentIntentId) return res.status(400).json({ error: "Identifiant de paiement introuvable — remboursement à faire manuellement depuis Stripe." });
      if (r.paiement?.rembourse) return res.status(409).json({ error: 'Cette réservation a déjà été remboursée.' });

      const montantPaye = Number(r.paiement.montantPaye ?? r.paiement.montant ?? 0);
      const montantDemande = req.body.montant != null ? Number(req.body.montant) : montantPaye;
      if (!montantDemande || montantDemande <= 0 || montantDemande > montantPaye + 0.01) {
        return res.status(400).json({ error: `Montant de remboursement invalide (entre 0,01 € et ${montantPaye} €).` });
      }
      const centimes = Math.round(montantDemande * 100);

      const remboursBody = new URLSearchParams({ payment_intent: paymentIntentId, amount: String(centimes) });
      const remboursRep = await fetch('https://api.stripe.com/v1/refunds', { method: 'POST', headers: stripeHeaders, body: remboursBody });
      const rembours = await remboursRep.json();
      if (!remboursRep.ok) { console.error('Erreur Stripe (refund):', rembours); return res.status(502).json({ error: rembours.error?.message || 'Erreur Stripe (remboursement)' }); }

      const data = {
        ...r,
        paiement: {
          ...r.paiement,
          rembourse: true,
          montantRembourseStripe: montantDemande,
          dateRemboursement: new Date().toISOString(),
          refundId: rembours.id,
        },
      };
      await ecrireReservation(ref, data);
      return res.status(200).json({ ok: true, montantRembourse: montantDemande, refundId: rembours.id });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (e) {
    console.error(`Erreur paiement/${action}:`, e);
    return res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
}
