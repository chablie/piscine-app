// Fonction serverless Vercel : POST /api/reinitialiser-mdp-locataire
// Met à jour le mot de passe (haché) dans "comptes_auth" après que le locataire
// a validé le code OTP reçu par email (validation faite côté client, comme avant).

import bcrypt from 'bcryptjs';
import { upsert } from './_lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { email, nouveauMotdepasse } = req.body || {};
  const emailNorm = (email || '').trim().toLowerCase();
  if (!emailNorm || !nouveauMotdepasse) return res.status(400).json({ error: 'Champs requis manquants' });
  if (nouveauMotdepasse.length < 8) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });

  try {
    const motdepasseHache = bcrypt.hashSync(nouveauMotdepasse, 10);
    await upsert('comptes_auth', { email: emailNorm, motdepasse_hache: motdepasseHache, updated_at: new Date().toISOString() });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Erreur reinitialiser-mdp-locataire:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
