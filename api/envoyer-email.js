// Fonction serverless Vercel : POST /api/envoyer-email
// Envoie un email via Resend de façon sécurisée (la clé API ne quitte jamais le serveur)

export default async function handler(req, res) {
  // CORS basique pour autoriser les appels depuis l'appli
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Configuration serveur manquante (clé API)' });
  }

  const { destinataire, sujet, html } = req.body || {};

  if (!destinataire || !sujet || !html) {
    return res.status(400).json({ error: 'Paramètres manquants (destinataire, sujet, html requis)' });
  }

  try {
    const reponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Ma Piscine Privée <contact@mypiscineprivee.com>',
        to: [destinataire],
        subject: sujet,
        html: html,
      }),
    });

    const data = await reponse.json();

    if (!reponse.ok) {
      console.error('Erreur Resend:', data);
      return res.status(reponse.status).json({ error: data.message || 'Erreur lors de l\'envoi' });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (e) {
    console.error('Erreur envoi email:', e);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'envoi' });
  }
}
