// Fonction serverless Vercel : POST /api/capturer-paiement
// Débite réellement la carte du locataire (capture de l'empreinte) quand le
// propriétaire accepte la réservation. Met à jour la réservation en base.
// Renvoie { statut: "paye" } en cas de succès, ou une erreur explicite si
// l'empreinte a expiré (> 7 jours) — l'app enverra alors un lien de paiement.

const SUPABASE_URL = "https://tfklwizeioivhpnmhryp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_X1QS7GKVf1TVcYd6xa9VaA__Et6kJ_1";

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

  const supaHeaders = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Lire la réservation
    const lire = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?ref=eq.${encodeURIComponent(ref)}&select=data`,
      { headers: supaHeaders }
    );
    const rows = await lire.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: 'Réservation introuvable' });
    }
    const data = rows[0].data;
    const pi = data.paiement?.paymentIntentId;
    if (!pi) return res.status(400).json({ error: 'Aucune empreinte bancaire sur cette réservation', code: 'pas_empreinte' });
    if (data.paiement?.statut === 'paye') return res.status(200).json({ statut: 'paye', deja: true });

    // 2. Capturer le paiement (débit effectif)
    const capRep = await fetch(`https://api.stripe.com/v1/payment_intents/${pi}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({}),
    });
    const cap = await capRep.json();
    if (!capRep.ok) {
      console.error('Échec capture:', cap);
      // Empreinte expirée ou annulée → l'app basculera sur un lien de paiement
      return res.status(409).json({
        error: cap.error?.message || 'Capture impossible',
        code: 'capture_impossible',
      });
    }

    // 3. Marquer payée en base
    data.paiement = {
      ...(data.paiement || {}),
      statut: 'paye',
      datePaiement: new Date().toISOString(),
      montantPaye: (cap.amount_received || cap.amount || 0) / 100,
    };
    const patch = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?ref=eq.${encodeURIComponent(ref)}`,
      {
        method: 'PATCH',
        headers: { ...supaHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
      }
    );
    if (!patch.ok) console.error('Échec PATCH Supabase:', await patch.text());

    return res.status(200).json({ statut: 'paye', montantPaye: data.paiement.montantPaye });
  } catch (e) {
    console.error('Erreur capturer-paiement:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
