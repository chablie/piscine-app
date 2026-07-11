// Fonction serverless Vercel : POST /api/deconnexion
// Efface le(s) cookie(s) de session indiqué(s) dans { roles: ["admin","proprio","locataire"] }

import { cookieEffacer } from './_lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const { roles } = req.body || {};
  const liste = Array.isArray(roles) && roles.length ? roles : ['admin', 'proprio', 'locataire'];
  res.setHeader('Set-Cookie', liste.map(r => cookieEffacer(`sp_${r}`)));
  return res.status(200).json({ ok: true });
}
