// Fonction serverless Vercel : POST /api/sauvegarder-compte
// Met à jour les données de PROFIL d'un compte locataire (prénom, adresse,
// liste des réservations liées...). Ne touche JAMAIS au mot de passe — cela
// passe uniquement par /api/creer-compte ou /api/reinitialiser-mdp-locataire.
// Exige une session locataire correspondant à l'email concerné (on ne peut
// modifier que son propre profil).

import { sessionDepuisRequete } from './_lib/session.js';
import { upsert } from './_lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) return res.status(500).json({ error: 'Configuration serveur manquante' });

  const { email, data } = req.body || {};
  const emailNorm = (email || '').trim().toLowerCase();
  if (!emailNorm || !data) return res.status(400).json({ error: 'Champs requis manquants' });

  const session = sessionDepuisRequete(req, ['locataire', 'proprio', 'admin'], SESSION_SECRET);
  if (!session) return res.status(401).json({ error: 'Non authentifié' });
  if (session.role === 'locataire' && session.email !== emailNorm) {
    return res.status(403).json({ error: 'Vous ne pouvez modifier que votre propre profil' });
  }

  // Filtre strict des champs modifiables — le mot de passe ne peut jamais transiter ici
  const { prenom, nom, telephone, adresse, codePostal, ville, reservations } = data;
  const donneesSures = { prenom, nom, telephone, adresse, codePostal, ville, reservations };

  try {
    await upsert('comptes', { email: emailNorm, data: donneesSures });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Erreur sauvegarder-compte:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
