// Fonction serverless Vercel : POST /api/creer-session-empreinte
// Crée une session Stripe Checkout en CAPTURE DIFFÉRÉE (empreinte bancaire) :
// la carte du locataire est autorisée au moment de la réservation, mais le débit
// n'a lieu que lorsque le propriétaire accepte (via /api/capturer-paiement).
// Si la demande est refusée, l'empreinte est libérée sans aucun débit.
// ⚠️ Une autorisation bancaire est valable ~7 jours : accepter/refuser dans ce délai.

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

    // 2. Montant : acompte 20% si espèces, sinon total général
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

    // 3. Créer la session Checkout en capture manuelle (= empreinte, pas de débit immédiat)
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

    const sessRep = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const sess = await sessRep.json();
    if (!sessRep.ok) {
      console.error('Erreur Stripe (checkout session):', sess);
      return res.status(502).json({ error: sess.error?.message || 'Erreur Stripe (session)' });
    }

    return res.status(200).json({ url: sess.url, montant, sessionId: sess.id });
  } catch (e) {
    console.error('Erreur creer-session-empreinte:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
