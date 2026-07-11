// Fonction serverless Vercel : POST /api/annuler-empreinte
// Libère l'empreinte bancaire (annule l'autorisation, aucun débit) quand le
// propriétaire refuse la demande ou qu'elle est annulée avant acceptation.

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
    if (!pi) return res.status(200).json({ statut: 'rien_a_faire' });
    if (data.paiement?.statut === 'paye') {
      // Déjà débité : ce n'est plus une empreinte, un remboursement serait nécessaire
      return res.status(409).json({ error: 'Paiement déjà capturé — remboursement requis', code: 'deja_paye' });
    }

    // 2. Annuler l'autorisation (libère les fonds bloqués, aucun débit)
    const canRep = await fetch(`https://api.stripe.com/v1/payment_intents/${pi}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ cancellation_reason: 'requested_by_customer' }),
    });
    const can = await canRep.json();
    // Si l'empreinte a déjà expiré côté Stripe, c'est un succès fonctionnel
    if (!canRep.ok && can.error?.code !== 'payment_intent_unexpected_state') {
      console.error('Échec annulation empreinte:', can);
    }

    // 3. Marquer l'empreinte libérée en base
    data.paiement = {
      ...(data.paiement || {}),
      statut: 'empreinte_annulee',
      dateAnnulation: new Date().toISOString(),
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

    return res.status(200).json({ statut: 'empreinte_annulee' });
  } catch (e) {
    console.error('Erreur annuler-empreinte:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
