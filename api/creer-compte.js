// Fonction serverless Vercel : POST /api/creer-compte
// Crée un compte locataire. Le mot de passe est haché (bcrypt) et stocké dans une
// table séparée "comptes_auth", totalement fermée en accès direct (RLS sans aucune
// policy publique) — seule cette fonction, via la clé service_role, peut y écrire.
// La table "comptes" (profil : prénom, adresse...) reste lisible publiquement
// comme avant, mais ne contient plus jamais de mot de passe.

import bcrypt from 'bcryptjs';
import { signerSession, cookieSession } from './_lib/session.js';
import { selectUn, upsert } from './_lib/supabaseAdmin.js';

const SESSION_DUREE = 60 * 60 * 24 * 30; // 30 jours

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) return res.status(500).json({ error: 'Configuration serveur manquante' });

  const { prenom, nom, email, telephone, adresse, codePostal, ville, motdepasse } = req.body || {};
  const emailNorm = (email || '').trim().toLowerCase();

  if (!prenom || !nom || !emailNorm.includes('@') || !telephone || !motdepasse) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  if (motdepasse.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
  }

  try {
    const existant = await selectUn('comptes', 'email', emailNorm, 'email');
    if (existant) return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });

    const motdepasseHache = bcrypt.hashSync(motdepasse, 10);
    const compteData = {
      prenom, nom, telephone,
      adresse: adresse || '', codePostal: codePostal || '', ville: ville || '',
      reservations: [],
    };
    await upsert('comptes', { email: emailNorm, data: compteData });
    await upsert('comptes_auth', { email: emailNorm, motdepasse_hache: motdepasseHache, updated_at: new Date().toISOString() });

    const token = signerSession({ role: 'locataire', email: emailNorm, exp: Date.now() + SESSION_DUREE * 1000 }, SESSION_SECRET);
    res.setHeader('Set-Cookie', cookieSession('sp_locataire', token, SESSION_DUREE));

    return res.status(200).json({ ok: true, email: emailNorm, compte: compteData });
  } catch (e) {
    console.error('Erreur creer-compte:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
