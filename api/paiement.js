// Fonction serverless Vercel : POST /api/paiement
// Regroupe toutes les actions de paiement (hors webhook, qui reste séparé)
// en UN SEUL point d'entrée, pour rester sous la limite de 12 fonctions
// serverless du forfait Vercel Hobby.
// Le champ "action" du corps de la requête détermine l'opération :
//   - creer-session-empreinte : dépôt d'empreinte bancaire (capture différée)
//   - capturer-paiement       : débit effectif de l'empreinte (à l'acceptation)
//   - annuler-empreinte       : libération de l'empreinte (refus/annulation)
//   - creer-lien-paiement     : lien de paiement classique (plan B de secours)

const SUPABASE_URL = "https://tfklwizeioivhpnmhryp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_X1QS7GKVf1TVcYd6xa9VaA__Et6kJ_1";
const SITE_URL = "https://mypiscineprivee.com";

async function lireReservation(ref) {
  const rep = await fetch(
    `${SUPABASE_URL}/rest/v1/reservations?ref=eq.${encodeURIComponent(ref)}&select=data`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  const rows = await rep.json();
  return Array.isArray(rows) && rows[0] ? rows[0].data : null;
}

async function patchReservation(ref, data) {
  const rep = await fetch(`${SUPABASE_URL}/rest/v1/reservations?ref=eq.${encodeURIComponent(ref)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
  if (!rep.ok) console.error('Échec PATCH Supabase:', await rep.text());
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

    // ── creer-session-empreinte : capture différée (hold bancaire) ──
    if (action === 'creer-session-empreinte') {
      const montant = montantAregler(r);
      if (!montant || montant <= 0) return res.status(400).json({ error: 'Montant invalide' });
      const centimes = Math.round(montant * 100);
      const libelle = r.modePaiement === 'especes' ? `Acompte réservation piscine ${ref} (solde sur place)` : `Réservation piscine ${ref}`;
      const body = new URLSearchParams({
        mode: 'payment',
        'payment_intent_data[capture_method]': 'manual',
        'payment_intent_data[metadata][ref]': ref,
        'line_items[0][price_data][currency]': 'eur',
        'line_items[0][price_data][unit_amount]': String(centimes),
        'line_items[0][price_data][product_data][name]': libelle,
        'line_items[0][quantity]': '1',
        'metadata[ref]': ref,
        success_url: `${SITE_URL}/?empreinte=succes&ref=${encodeURIComponent(ref)}`,
        cancel_url: `${SITE_URL}/?empreinte=annulee&ref=${encodeURIComponent(ref)}`,
      });
      if (r.email) body.set('customer_email', r.email);
      const sessRep = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: stripeHeaders, body });
      const sess = await sessRep.json();
      if (!sessRep.ok) { console.error('Erreur Stripe (session):', sess); return res.status(502).json({ error: sess.error?.message || 'Erreur Stripe (session)' }); }
      return res.status(200).json({ url: sess.url, montant, sessionId: sess.id });
    }

    // ── capturer-paiement : débit effectif de l'empreinte ──
    if (action === 'capturer-paiement') {
      const pi = r.paiement?.paymentIntentId;
      if (!pi) return res.status(400).json({ error: 'Aucune empreinte bancaire sur cette réservation', code: 'pas_empreinte' });
      if (r.paiement?.statut === 'paye') return res.status(200).json({ statut: 'paye', deja: true });
      const capRep = await fetch(`https://api.stripe.com/v1/payment_intents/${pi}/capture`, { method: 'POST', headers: stripeHeaders, body: new URLSearchParams({}) });
      const cap = await capRep.json();
      if (!capRep.ok) { console.error('Échec capture:', cap); return res.status(409).json({ error: cap.error?.message || 'Capture impossible', code: 'capture_impossible' }); }
      const data = { ...r, paiement: { ...(r.paiement || {}), statut: 'paye', datePaiement: new Date().toISOString(), montantPaye: (cap.amount_received || cap.amount || 0) / 100 } };
      await patchReservation(ref, data);
      return res.status(200).json({ statut: 'paye', montantPaye: data.paiement.montantPaye });
    }

    // ── annuler-empreinte : libère l'autorisation, aucun débit ──
    if (action === 'annuler-empreinte') {
      const pi = r.paiement?.paymentIntentId;
      if (!pi) return res.status(200).json({ statut: 'rien_a_faire' });
      if (r.paiement?.statut === 'paye') return res.status(409).json({ error: 'Paiement déjà capturé — remboursement requis', code: 'deja_paye' });
      const canRep = await fetch(`https://api.stripe.com/v1/payment_intents/${pi}/cancel`, { method: 'POST', headers: stripeHeaders, body: new URLSearchParams({ cancellation_reason: 'requested_by_customer' }) });
      const can = await canRep.json();
      if (!canRep.ok && can.error?.code !== 'payment_intent_unexpected_state') console.error('Échec annulation empreinte:', can);
      const data = { ...r, paiement: { ...(r.paiement || {}), statut: 'empreinte_annulee', dateAnnulation: new Date().toISOString() } };
      await patchReservation(ref, data);
      return res.status(200).json({ statut: 'empreinte_annulee' });
    }

    // ── creer-lien-paiement : plan B (lien classique par email) ──
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
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
