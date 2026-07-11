// Fonction serverless Vercel : POST /api/sauvegarder-reservation
// Point de passage unique pour créer/modifier une réservation, quel que soit
// qui agit :
//   - Un visiteur/locataire connecté peut CRÉER sa propre demande (email = le sien),
//     ou MODIFIER une réservation existante SI elle lui appartient déjà en base
//     (annulation, état des lieux réalisé par lui-même).
//   - Le propriétaire/admin peut modifier N'IMPORTE QUELLE réservation
//     (acceptation, refus, annulation, remboursement...).
// Sans session valide correspondant à ces règles, la requête est rejetée.

import { sessionDepuisRequete } from './_lib/session.js';
import { selectUn, upsert } from './_lib/supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const SESSION_SECRET = process.env.SESSION_SECRET;
  if (!SESSION_SECRET) return res.status(500).json({ error: 'Configuration serveur manquante' });

  const { reservation } = req.body || {};
  if (!reservation || !reservation.ref) return res.status(400).json({ error: 'Réservation invalide' });

  const session = sessionDepuisRequete(req, ['proprio', 'admin', 'locataire'], SESSION_SECRET);
  if (!session) return res.status(401).json({ error: 'Non authentifié' });

  try {
    const existante = await selectUn('reservations', 'ref', reservation.ref, 'data');

    if (session.role === 'proprio' || session.role === 'admin') {
      // Le propriétaire/admin peut tout modifier
    } else {
      // Locataire : email de la nouvelle donnée ET de l'existante (s'il y en a une)
      // doivent correspondre à sa propre session
      const emailNouveau = (reservation.email || '').trim().toLowerCase();
      if (emailNouveau !== session.email) {
        return res.status(403).json({ error: 'Vous ne pouvez enregistrer que vos propres réservations' });
      }
      if (existante && (existante.data.email || '').trim().toLowerCase() !== session.email) {
        return res.status(403).json({ error: 'Cette réservation ne vous appartient pas' });
      }
    }

    await upsert('reservations', {
      ref: reservation.ref,
      data: reservation,
      date: reservation.date,
      email: reservation.email,
      statut: reservation.statut || 'en_attente',
      updated_at: new Date().toISOString(),
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Erreur sauvegarder-reservation:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
