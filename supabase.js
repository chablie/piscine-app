// Librairie partagée : sessions signées (admin / propriétaire / locataire).
// Le secret ne quitte JAMAIS le serveur (variable d'environnement Vercel).
// Le cookie est httpOnly (illisible en JavaScript côté client, protège contre le vol par XSS),
// Secure (HTTPS uniquement) et SameSite=Lax.

import crypto from 'crypto';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

// Signe une session { role, email?, exp } → jeton "payload.signature"
export function signerSession(payload, secret) {
  const json = JSON.stringify(payload);
  const payloadB64 = b64url(json);
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

// Vérifie un jeton et renvoie le payload, ou null si invalide/expiré/altéré
export function verifierSession(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sigB64] = token.split('.');
  const attendu = b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
  try {
    if (!crypto.timingSafeEqual(Buffer.from(attendu), Buffer.from(sigB64))) return null;
  } catch { return null; }
  let payload;
  try { payload = JSON.parse(fromB64url(payloadB64).toString('utf8')); } catch { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// Lit les cookies d'une requête Vercel (Node)
export function lireCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

// Construit un en-tête Set-Cookie sécurisé
export function cookieSession(nom, valeur, maxAgeSecondes) {
  const parts = [
    `${nom}=${encodeURIComponent(valeur)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSecondes}`,
  ];
  return parts.join('; ');
}

// Construit un en-tête Set-Cookie qui efface le cookie
export function cookieEffacer(nom) {
  return `${nom}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Vérifie qu'une requête porte une session valide pour l'un des rôles autorisés.
// Renvoie le payload de session ou null.
export function sessionDepuisRequete(req, rolesAutorises, secret) {
  const cookies = lireCookies(req);
  for (const role of rolesAutorises) {
    const token = cookies[`sp_${role}`];
    if (!token) continue;
    const payload = verifierSession(token, secret);
    if (payload && payload.role === role) return payload;
  }
  return null;
}
