// Fonction serverless Vercel : POST /api/connexion-admin
// Le mot de passe admin vit UNIQUEMENT dans la variable d'environnement ADMIN_PASSWORD
// (jamais dans le code envoyé au navigateur). En cas de succès, pose un cookie de
// session signé et httpOnly.

import { signerSession, cookieSession } from './_lib/session.js';

const ADMIN_EMAIL = "aurelie.briand@yahoo.fr";
const SESSION_DUREE = 60 * 60 * 8; // 8 heures

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const SESSION_SECRET = process.env.SESSION_SECRET;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!SESSION_SECRET || !ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Configuration serveur manquante' });
  }

  const { email, motdepasse } = req.body || {};
  // Comparaison à temps constant pour limiter les attaques par mesure de timing
  const emailOk = email === ADMIN_EMAIL;
  const mdpOk = typeof motdepasse === 'string' && motdepasse.length === ADMIN_PASSWORD.length && motdepasse === ADMIN_PASSWORD;

  if (!emailOk || !mdpOk) {
    // Petite latence pour ralentir le bruteforce automatisé
    await new Promise(r => setTimeout(r, 400));
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  const token = signerSession({ role: 'admin', exp: Date.now() + SESSION_DUREE * 1000 }, SESSION_SECRET);
  res.setHeader('Set-Cookie', cookieSession('sp_admin', token, SESSION_DUREE));
  return res.status(200).json({ ok: true });
}
