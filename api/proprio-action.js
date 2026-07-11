// Fonction serverless Vercel : POST /api/proprio-action
// Point de passage UNIQUE pour toutes les écritures réservées au propriétaire/admin
// (annonce, disponibilités, inventaire, extras, codes promo, notes, config,
// réinitialisation des statistiques). Exige une session "proprio" ou "admin".
// Utilise la clé service_role — jamais exposée au navigateur.

import { sessionDepuisRequete } from './_lib/session.js';
import { upsert, supprimerUn, supprimerTout } from './_lib/supabaseAdmin.js';

// Tables autorisées et leur clé primaire (whitelist stricte — aucune autre table
// n'est accessible via ce proxy, même avec une session valide)
const TABLES = {
  annonce: 'id',
  disponibilites: 'date',
  inventaire: 'item',
  elements_edl: 'id',
  extras: 'id',
  codes_promo: 'code',
  notes_locataires: 'reservation_ref',
  config: 'id',
  reservations: 'ref',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) return res.status(500).json({ error: 'Configuration serveur manquante' });

  const session = sessionDepuisRequete(req, ['proprio', 'admin'], SESSION_SECRET);
  if (!session) return res.status(401).json({ error: 'Non authentifié' });

  const { table, action, ligne, cle, cleValeur } = req.body || {};
  const colonneCle = TABLES[table];
  if (!colonneCle) return res.status(400).json({ error: 'Table non autorisée' });

  try {
    if (action === 'upsert') {
      if (!ligne || ligne[colonneCle] === undefined) return res.status(400).json({ error: 'Ligne invalide' });
      await upsert(table, ligne);
      return res.status(200).json({ ok: true });
    }
    if (action === 'delete') {
      if (cleValeur === undefined) return res.status(400).json({ error: 'Valeur de clé manquante' });
      await supprimerUn(table, cle || colonneCle, cleValeur);
      return res.status(200).json({ ok: true });
    }
    if (action === 'delete_all') {
      // Réservé aux tables où une purge totale est légitime (réinitialisation des stats)
      if (!['reservations', 'notes_locataires', 'codes_promo'].includes(table)) {
        return res.status(403).json({ error: 'Purge totale non autorisée sur cette table' });
      }
      await supprimerTout(table, colonneCle);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Action inconnue' });
  } catch (e) {
    console.error('Erreur proprio-action:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
