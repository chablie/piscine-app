// Fonction serverless Vercel : POST /api/connexion-proprio
// Même principe que /api/connexion-admin : le mot de passe vit uniquement dans
// la variable d'environnement PROPRIO_PASSWORD.

import { signerSession, cookieSession } from './_lib/session.js';

const PROPRIO_EMAIL = "aurelie.briand@yahoo.fr";
const SESSION_DUREE = 60 * 60 * 8; // 8 heures

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const SESSION_SECRET = process.env.SESSION_SECRET;
  const PROPRIO_PASSWORD = process.env.PROPRIO_PASSWORD;
  if (!SESSION_SECRET || !PROPRIO_PASSWORD) {
    return res.status(500).json({ error: 'Configuration serveur manquante' });
  }

  const { email, motdepasse } = req.body || {};
  const emailOk = email === PROPRIO_EMAIL;
  const mdpOk = typeof motdepasse === 'string' && motdepasse.length === PROPRIO_PASSWORD.length && motdepasse === PROPRIO_PASSWORD;

  if (!emailOk || !mdpOk) {
    await new Promise(r => setTimeout(r, 400));
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  const token = signerSession({ role: 'proprio', exp: Date.now() + SESSION_DUREE * 1000 }, SESSION_SECRET);
  res.setHeader('Set-Cookie', cookieSession('sp_proprio', token, SESSION_DUREE));
  return res.status(200).json({ ok: true });
}
