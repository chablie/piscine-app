// Fonction serverless Vercel : POST /api/paiement
// Un seul point d'entrée pour la création du lien de paiement Stripe, envoyé
// au locataire après validation de sa demande par le propriétaire. Le
// créneau n'est garanti qu'une fois ce paiement confirmé (voir statutHeures
// côté client et la résolution de conflit dans api/stripe-webhook.js).

import { selectUn } from '../lib/supabaseAdmin.js';

const SITE_URL = "https://mypiscineprivee.com";

async function lireReservation(ref) {
  const row = await selectUn('reservations', 'ref', ref, 'data');
  return row ? row.data : null;
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

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (e) {
    console.error(`Erreur paiement/${action}:`, e);
    return res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
}
