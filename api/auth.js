// Fonction serverless Vercel : POST /api/auth
// Regroupe toutes les actions d'authentification en UN SEUL point d'entrée,
// pour rester sous la limite de 12 fonctions serverless du forfait Vercel Hobby.
// Le champ "action" du corps de la requête détermine l'opération effectuée :
//   - connexion-admin, connexion-proprio, connexion-locataire
//   - creer-compte, reinitialiser-mdp-locataire
//   - sauvegarder-compte, supprimer-mon-compte
//   - deconnexion

import bcrypt from 'bcryptjs';
import { signerSession, cookieSession, cookieEffacer, sessionDepuisRequete } from '../lib/session.js';
import { selectUn, upsert, supprimerUn } from '../lib/supabaseAdmin.js';

const ADMIN_EMAIL = "aurelie.briand@yahoo.fr";
const PROPRIO_EMAIL = "aurelie.briand@yahoo.fr";
const SESSION_COURTE = 60 * 60 * 8;       // 8h (admin/proprio)
const SESSION_LONGUE = 60 * 60 * 24 * 30; // 30 jours (locataire)

// ─── Anti-bruteforce côté serveur ──────────────────────────────────────────
// Persisté en base (table tentatives_connexion) : contrairement à un compteur
// React, ceci ne peut pas être contourné par un F5 ou un appel direct à l'API.
const MAX_TENTATIVES = 5;
const DUREE_BLOCAGE_MS = 30 * 60 * 1000; // 30 minutes

// Vérifie si l'identifiant est actuellement bloqué. Renvoie le nombre de
// minutes restantes si bloqué, ou null si l'accès est autorisé.
// Fail-open : si la table est absente ou en erreur, on n'empêche jamais une
// connexion légitime — l'anti-bruteforce est une protection additionnelle,
// pas un point de défaillance pour l'authentification elle-même.
async function verifierBlocage(id) {
  try {
    const row = await selectUn('tentatives_connexion', 'id', id, 'compteur,bloque_jusqua');
    if (!row || !row.bloque_jusqua) return null;
    const finBlocage = new Date(row.bloque_jusqua).getTime();
    if (finBlocage <= Date.now()) return null; // le blocage a expiré
    return Math.ceil((finBlocage - Date.now()) / 60000);
  } catch (e) {
    console.error('verifierBlocage (ignoré, fail-open):', e.message);
    return null;
  }
}

// Enregistre une tentative échouée ; bloque l'identifiant après MAX_TENTATIVES
async function enregistrerEchec(id) {
  try {
    const row = await selectUn('tentatives_connexion', 'id', id, 'compteur').catch(() => null);
    const compteur = (row?.compteur || 0) + 1;
    const bloque = compteur >= MAX_TENTATIVES;
    await upsert('tentatives_connexion', {
      id, compteur,
      bloque_jusqua: bloque ? new Date(Date.now() + DUREE_BLOCAGE_MS).toISOString() : null,
      updated_at: new Date().toISOString(),
    });
    return { compteur, bloque };
  } catch (e) {
    console.error('enregistrerEchec (ignoré, fail-open):', e.message);
    return { compteur: 0, bloque: false };
  }
}

// Réinitialise le compteur après une connexion réussie
async function reinitialiserTentatives(id) {
  await supprimerUn('tentatives_connexion', 'id', id).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) return res.status(500).json({ error: 'Configuration serveur manquante' });

  const { action } = req.body || {};

  try {
    // ── connexion-admin ──
    if (action === 'connexion-admin') {
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
      if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'Configuration serveur manquante' });
      const { email, motdepasse } = req.body;
      const idTentative = `admin:${email || ''}`;
      const minutesRestantes = await verifierBlocage(idTentative);
      if (minutesRestantes) return res.status(429).json({ error: `Trop de tentatives. Réessayez dans ${minutesRestantes} min.` });
      const ok = email === ADMIN_EMAIL && typeof motdepasse === 'string' && motdepasse.length === ADMIN_PASSWORD.length && motdepasse === ADMIN_PASSWORD;
      if (!ok) {
        await new Promise(r => setTimeout(r, 400));
        const { bloque } = await enregistrerEchec(idTentative);
        return res.status(401).json({ error: bloque ? 'Trop de tentatives. Compte bloqué 30 minutes.' : 'Email ou mot de passe incorrect' });
      }
      await reinitialiserTentatives(idTentative);
      const token = signerSession({ role: 'admin', exp: Date.now() + SESSION_COURTE * 1000 }, SESSION_SECRET);
      res.setHeader('Set-Cookie', cookieSession('sp_admin', token, SESSION_COURTE));
      return res.status(200).json({ ok: true });
    }

    // ── connexion-proprio ──
    if (action === 'connexion-proprio') {
      const PROPRIO_PASSWORD = process.env.PROPRIO_PASSWORD;
      if (!PROPRIO_PASSWORD) return res.status(500).json({ error: 'Configuration serveur manquante' });
      const { email, motdepasse } = req.body;
      const idTentative = `proprio:${email || ''}`;
      const minutesRestantes = await verifierBlocage(idTentative);
      if (minutesRestantes) return res.status(429).json({ error: `Trop de tentatives. Réessayez dans ${minutesRestantes} min.` });
      const ok = email === PROPRIO_EMAIL && typeof motdepasse === 'string' && motdepasse.length === PROPRIO_PASSWORD.length && motdepasse === PROPRIO_PASSWORD;
      if (!ok) {
        await new Promise(r => setTimeout(r, 400));
        const { bloque } = await enregistrerEchec(idTentative);
        return res.status(401).json({ error: bloque ? 'Trop de tentatives. Compte bloqué 30 minutes.' : 'Email ou mot de passe incorrect' });
      }
      await reinitialiserTentatives(idTentative);
      const token = signerSession({ role: 'proprio', exp: Date.now() + SESSION_COURTE * 1000 }, SESSION_SECRET);
      res.setHeader('Set-Cookie', cookieSession('sp_proprio', token, SESSION_COURTE));
      return res.status(200).json({ ok: true });
    }

    // ── creer-compte ──
    if (action === 'creer-compte') {
      const { prenom, nom, email, telephone, adresse, codePostal, ville, motdepasse } = req.body;
      const emailNorm = (email || '').trim().toLowerCase();
      if (!prenom || !nom || !emailNorm.includes('@') || !telephone || !motdepasse) return res.status(400).json({ error: 'Champs requis manquants' });
      if (motdepasse.length < 8) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
      const existant = await selectUn('comptes', 'email', emailNorm, 'email');
      if (existant) return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });
      const motdepasseHache = bcrypt.hashSync(motdepasse, 10);
      const compteData = { prenom, nom, telephone, adresse: adresse || '', codePostal: codePostal || '', ville: ville || '', reservations: [] };
      await upsert('comptes', { email: emailNorm, data: compteData });
      await upsert('comptes_auth', { email: emailNorm, motdepasse_hache: motdepasseHache, updated_at: new Date().toISOString() });
      const token = signerSession({ role: 'locataire', email: emailNorm, exp: Date.now() + SESSION_LONGUE * 1000 }, SESSION_SECRET);
      res.setHeader('Set-Cookie', cookieSession('sp_locataire', token, SESSION_LONGUE));
      return res.status(200).json({ ok: true, email: emailNorm, compte: compteData });
    }

    // ── connexion-locataire ──
    if (action === 'connexion-locataire') {
      const { email, motdepasse } = req.body;
      const emailNorm = (email || '').trim().toLowerCase();
      if (!emailNorm || !motdepasse) return res.status(400).json({ error: 'Email et mot de passe requis' });
      const idTentative = `locataire:${emailNorm}`;
      const minutesRestantes = await verifierBlocage(idTentative);
      if (minutesRestantes) return res.status(429).json({ error: `Trop de tentatives. Réessayez dans ${minutesRestantes} min, ou utilisez « Mot de passe oublié ».` });
      const auth = await selectUn('comptes_auth', 'email', emailNorm, 'motdepasse_hache');
      if (!auth || !bcrypt.compareSync(motdepasse, auth.motdepasse_hache)) {
        await new Promise(r => setTimeout(r, 300));
        const { bloque } = await enregistrerEchec(idTentative);
        return res.status(401).json({ error: bloque ? 'Trop de tentatives. Compte bloqué 30 minutes. Utilisez « Mot de passe oublié ».' : 'Email ou mot de passe incorrect' });
      }
      await reinitialiserTentatives(idTentative);
      const profil = await selectUn('comptes', 'email', emailNorm, 'data');
      const token = signerSession({ role: 'locataire', email: emailNorm, exp: Date.now() + SESSION_LONGUE * 1000 }, SESSION_SECRET);
      res.setHeader('Set-Cookie', cookieSession('sp_locataire', token, SESSION_LONGUE));
      return res.status(200).json({ ok: true, email: emailNorm, compte: profil?.data || {} });
    }

    // ── reinitialiser-mdp-locataire (après validation OTP côté client) ──
    if (action === 'reinitialiser-mdp-locataire') {
      const { email, nouveauMotdepasse } = req.body;
      const emailNorm = (email || '').trim().toLowerCase();
      if (!emailNorm || !nouveauMotdepasse) return res.status(400).json({ error: 'Champs requis manquants' });
      if (nouveauMotdepasse.length < 8) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
      const motdepasseHache = bcrypt.hashSync(nouveauMotdepasse, 10);
      await upsert('comptes_auth', { email: emailNorm, motdepasse_hache: motdepasseHache, updated_at: new Date().toISOString() });
      await reinitialiserTentatives(`locataire:${emailNorm}`);
      return res.status(200).json({ ok: true });
    }

    // ── sauvegarder-compte (profil uniquement, jamais le mot de passe) ──
    if (action === 'sauvegarder-compte') {
      const { email, data } = req.body;
      const emailNorm = (email || '').trim().toLowerCase();
      if (!emailNorm || !data) return res.status(400).json({ error: 'Champs requis manquants' });
      const session = sessionDepuisRequete(req, ['locataire', 'proprio', 'admin'], SESSION_SECRET);
      if (!session) return res.status(401).json({ error: 'Non authentifié' });
      if (session.role === 'locataire' && session.email !== emailNorm) return res.status(403).json({ error: 'Vous ne pouvez modifier que votre propre profil' });
      const { prenom, nom, telephone, adresse, codePostal, ville, reservations } = data;
      await upsert('comptes', { email: emailNorm, data: { prenom, nom, telephone, adresse, codePostal, ville, reservations } });
      return res.status(200).json({ ok: true });
    }

    // ── supprimer-mon-compte (RGPD) ──
    if (action === 'supprimer-mon-compte') {
      const session = sessionDepuisRequete(req, ['locataire'], SESSION_SECRET);
      if (!session) return res.status(401).json({ error: 'Non authentifié' });
      await supprimerUn('comptes', 'email', session.email);
      await supprimerUn('comptes_auth', 'email', session.email);
      res.setHeader('Set-Cookie', cookieEffacer('sp_locataire'));
      return res.status(200).json({ ok: true });
    }

    // ── deconnexion ──
    if (action === 'deconnexion') {
      const { roles } = req.body;
      const liste = Array.isArray(roles) && roles.length ? roles : ['admin', 'proprio', 'locataire'];
      res.setHeader('Set-Cookie', liste.map(r => cookieEffacer(`sp_${r}`)));
      return res.status(200).json({ ok: true });
    }

    // ── verifier-session (restaure l'état de connexion au chargement de l'app) ──
    if (action === 'verifier-session') {
      const session = sessionDepuisRequete(req, ['admin', 'proprio', 'locataire'], SESSION_SECRET);
      if (!session) return res.status(200).json({ role: null });
      if (session.role === 'locataire') {
        const profil = await selectUn('comptes', 'email', session.email, 'data');
        return res.status(200).json({ role: 'locataire', email: session.email, compte: profil?.data || {} });
      }
      return res.status(200).json({ role: session.role });
    }

    return res.status(400).json({ error: 'Action inconnue' });
  } catch (e) {
    console.error(`Erreur auth/${action}:`, e);
    return res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
}
