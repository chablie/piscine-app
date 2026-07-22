// Fonction serverless Vercel : POST /api/envoyer-sms
// Envoie un SMS via Twilio de façon sécurisée (les identifiants Twilio ne
// quittent jamais le navigateur). Utilisé pour prévenir instantanément la
// propriétaire d'une nouvelle demande de réservation, en complément de l'email.
//
// L'expéditeur affiché est soit un nom de marque (TWILIO_SENDER_ID, ex:
// "MyPiscine") si cette variable est renseignée, soit le numéro de téléphone
// Twilio par défaut. Le nom de marque ("Alphanumeric Sender ID") nécessite un
// compte Twilio payant — inutile de le renseigner tant que le compte est en
// mode essai, le numéro sera utilisé automatiquement à la place.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
  const TWILIO_SENDER_ID = process.env.TWILIO_SENDER_ID; // optionnel, ex: "MyPiscine"
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return res.status(500).json({ error: 'Configuration serveur manquante (Twilio)' });
  }

  const { destinataire, message } = req.body || {};
  if (!destinataire || !message) {
    return res.status(400).json({ error: 'Paramètres manquants (destinataire, message requis)' });
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const expediteur = (TWILIO_SENDER_ID && TWILIO_SENDER_ID.trim()) || TWILIO_PHONE_NUMBER;
    const body = new URLSearchParams({ To: destinataire, From: expediteur, Body: message });
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

    const rep = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await rep.json();

    if (!rep.ok) {
      console.error('Erreur Twilio:', data);
      return res.status(rep.status).json({ error: data.message || "Erreur lors de l'envoi du SMS" });
    }

    return res.status(200).json({ success: true, sid: data.sid });
  } catch (e) {
    console.error('Erreur envoi SMS:', e);
    return res.status(500).json({ error: "Erreur serveur lors de l'envoi du SMS" });
  }
}
