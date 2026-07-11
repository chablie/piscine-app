// Fonction serverless Vercel : POST /api/connexion-locataire
// Vérifie le mot de passe (bcrypt) depuis la table verrouillée "comptes_auth",
// jamais depuis "comptes" (qui ne contient plus de mot de passe).

import bcrypt from 'bcryptjs';
import { signerSession, cookieSession } from './_lib/session.js';
import { selectUn } from './_lib/supabaseAdmin.js';

const SESSION_DUREE = 60 * 60 * 24 * 30; // 30 jours

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) return res.status(500).json({ error: 'Configuration serveur manquante' });

  const { email, motdepasse } = req.body || {};
  const emailNorm = (email || '').trim().toLowerCase();
  if (!emailNorm || !motdepasse) return res.status(400).json({ error: 'Email et mot de passe requis' });

  try {
    const auth = await selectUn('comptes_auth', 'email', emailNorm, 'motdepasse_hache');
    if (!auth || !bcrypt.compareSync(motdepasse, auth.motdepasse_hache)) {
      await new Promise(r => setTimeout(r, 300));
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }
    const profil = await selectUn('comptes', 'email', emailNorm, 'data');

    const token = signerSession({ role: 'locataire', email: emailNorm, exp: Date.now() + SESSION_DUREE * 1000 }, SESSION_SECRET);
    res.setHeader('Set-Cookie', cookieSession('sp_locataire', token, SESSION_DUREE));

    return res.status(200).json({ ok: true, email: emailNorm, compte: profil?.data || {} });
  } catch (e) {
    console.error('Erreur connexion-locataire:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
