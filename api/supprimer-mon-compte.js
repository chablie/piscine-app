// Fonction serverless Vercel : POST /api/supprimer-mon-compte
// Droit à l'effacement RGPD : supprime le profil ET les identifiants du compte
// locataire connecté. Exige une session locataire valide (on ne peut supprimer
// que son propre compte).

import { sessionDepuisRequete, cookieEffacer } from './_lib/session.js';
import { supprimerUn } from './_lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) return res.status(500).json({ error: 'Configuration serveur manquante' });

  const session = sessionDepuisRequete(req, ['locataire'], SESSION_SECRET);
  if (!session) return res.status(401).json({ error: 'Non authentifié' });

  try {
    await supprimerUn('comptes', 'email', session.email);
    await supprimerUn('comptes_auth', 'email', session.email);
    res.setHeader('Set-Cookie', cookieEffacer('sp_locataire'));
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Erreur supprimer-mon-compte:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
