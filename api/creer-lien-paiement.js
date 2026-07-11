// Fonction serverless Vercel : POST /api/creer-lien-paiement
// Crée un lien de paiement Stripe pour une réservation acceptée.
// Le montant est calculé côté serveur à partir de la réservation en base
// (jamais depuis le navigateur) : 100% en mode carte, acompte 20% en mode espèces.

const SUPABASE_URL = "https://tfklwizeioivhpnmhryp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_X1QS7GKVf1TVcYd6xa9VaA__Et6kJ_1";
const SITE_URL = "https://mypiscineprivee.com";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Configuration serveur manquante (clé Stripe)' });
  }

  const { ref } = req.body || {};
  if (!ref) return res.status(400).json({ error: 'Paramètre manquant (ref requis)' });

  try {
    // 1. Lire la réservation en base (source de vérité pour le montant)
    const supaRep = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?ref=eq.${encodeURIComponent(ref)}&select=data`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const rows = await supaRep.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: 'Réservation introuvable' });
    }
    const r = rows[0].data;

    // 2. Montant à régler : acompte 20% si espèces, sinon total général
    const total = Number(r.totalGeneral ?? r.prix ?? 0);
    const montant = r.modePaiement === 'especes'
      ? Number(r.acompte ?? +(total * 0.20).toFixed(2))
      : total;
    if (!montant || montant <= 0) {
      return res.status(400).json({ error: 'Montant invalide pour cette réservation' });
    }
    const centimes = Math.round(montant * 100);
    const libelle = r.modePaiement === 'especes'
      ? `Acompte réservation piscine ${ref} (solde sur place)`
      : `Réservation piscine ${ref}`;

    const stripeHeaders = {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    // 3. Créer un prix ponctuel (les liens de paiement exigent un objet Price)
    const prixBody = new URLSearchParams({
      currency: 'eur',
      unit_amount: String(centimes),
      'product_data[name]': libelle,
    });
    const prixRep = await fetch('https://api.stripe.com/v1/prices', {
      method: 'POST', headers: stripeHeaders, body: prixBody,
    });
    const prix = await prixRep.json();
    if (!prixRep.ok) {
      console.error('Erreur Stripe (price):', prix);
      return res.status(502).json({ error: prix.error?.message || 'Erreur Stripe (prix)' });
    }

    // 4. Créer le lien de paiement (URL stable, sans expiration, envoyable par email)
    const lienBody = new URLSearchParams({
      'line_items[0][price]': prix.id,
      'line_items[0][quantity]': '1',
      'metadata[ref]': ref,
      'after_completion[type]': 'redirect',
      'after_completion[redirect][url]': `${SITE_URL}/?paiement=succes&ref=${encodeURIComponent(ref)}`,
    });
    const lienRep = await fetch('https://api.stripe.com/v1/payment_links', {
      method: 'POST', headers: stripeHeaders, body: lienBody,
    });
    const lien = await lienRep.json();
    if (!lienRep.ok) {
      console.error('Erreur Stripe (payment_link):', lien);
      return res.status(502).json({ error: lien.error?.message || 'Erreur Stripe (lien)' });
    }

    return res.status(200).json({ url: lien.url, montant, lienId: lien.id });
  } catch (e) {
    console.error('Erreur creer-lien-paiement:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
