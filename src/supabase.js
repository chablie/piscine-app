import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://tfklwizeioivhpnmhryp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_X1QS7GKVf1TVcYd6xa9VaA__Et6kJ_1";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ═══════════════════════════════════════════════════════════════════════
// Toutes les ÉCRITURES sensibles passent désormais par des fonctions serverless
// protégées par une session (cookie httpOnly signé), qui utilisent la clé
// service_role côté serveur — jamais exposée au navigateur. Les LECTURES restent
// publiques via la clé anonyme, comme avant (RLS : lecture seule pour le public).
// ═══════════════════════════════════════════════════════════════════════

async function proprioAction(table, action, extra = {}) {
  const rep = await fetch('/api/proprio-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ table, action, ...extra }),
  });
  if (!rep.ok) console.error(`proprioAction ${table}/${action}`, await rep.json().catch(() => ({})));
  return rep.ok;
}

// ═══════════════════════════════════════════════════════════════════════
// ANNONCE (un seul enregistrement, id=1)
// ═══════════════════════════════════════════════════════════════════════
export async function chargerAnnonce() {
  const { data, error } = await supabase.from('annonce').select('data').eq('id', 1).maybeSingle();
  if (error) { console.error('chargerAnnonce', error); return null; }
  return data?.data || null;
}

export async function sauvegarderAnnonce(annonceData) {
  return proprioAction('annonce', 'upsert', { ligne: { id: 1, data: annonceData, updated_at: new Date().toISOString() } });
}

// ═══════════════════════════════════════════════════════════════════════
// DISPONIBILITÉS (une ligne par date)
// ═══════════════════════════════════════════════════════════════════════
export async function chargerDisponibilites() {
  const { data, error } = await supabase.from('disponibilites').select('date, plages');
  if (error) { console.error('chargerDisponibilites', error); return {}; }
  const result = {};
  (data || []).forEach(row => { result[row.date] = row.plages; });
  return result;
}

export async function sauvegarderDisponibilites(disponibilitesObj) {
  // disponibilitesObj : { "2026-06-20": [{debut, fin}], ... }
  const { data: existantes } = await supabase.from('disponibilites').select('date');
  const datesEnBase = (existantes || []).map(r => r.date);
  const datesActuelles = Object.keys(disponibilitesObj);
  const datesASupprimer = datesEnBase.filter(d => !datesActuelles.includes(d));

  let ok = true;
  for (const date of datesASupprimer) {
    ok = (await proprioAction('disponibilites', 'delete', { cle: 'date', cleValeur: date })) && ok;
  }
  for (const [date, plages] of Object.entries(disponibilitesObj)) {
    ok = (await proprioAction('disponibilites', 'upsert', { ligne: { date, plages, updated_at: new Date().toISOString() } })) && ok;
  }
  return ok;
}

export async function supprimerDateDisponibilite(date) {
  return proprioAction('disponibilites', 'delete', { cle: 'date', cleValeur: date });
}

// ═══════════════════════════════════════════════════════════════════════
// RÉSERVATIONS
// ═══════════════════════════════════════════════════════════════════════
export async function chargerReservations() {
  const { data, error } = await supabase.from('reservations').select('data').order('created_at', { ascending: true });
  if (error) { console.error('chargerReservations', error); return []; }
  return (data || []).map(row => row.data);
}

export async function sauvegarderReservation(reservation) {
  const rep = await fetch('/api/sauvegarder-reservation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ reservation }),
  });
  if (!rep.ok) console.error('sauvegarderReservation', await rep.json().catch(() => ({})));
  return rep.ok;
}

// ═══════════════════════════════════════════════════════════════════════
// COMPTES LOCATAIRES
// La création (creer-compte), la connexion (connexion-locataire), la
// réinitialisation de mot de passe et la suppression RGPD passent par des
// fonctions serverless dédiées (voir App.jsx). sauvegarderCompte() ci-dessous
// ne sert plus qu'aux mises à jour de profil (ex. lier une réservation).
// ═══════════════════════════════════════════════════════════════════════
export async function chargerComptes() {
  const { data, error } = await supabase.from('comptes').select('email, data');
  if (error) { console.error('chargerComptes', error); return {}; }
  const result = {};
  (data || []).forEach(row => { result[row.email] = row.data; });
  return result;
}

export async function sauvegarderCompte(email, compteData) {
  const rep = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ action: 'sauvegarder-compte', email, data: compteData }),
  });
  if (!rep.ok) console.error('sauvegarderCompte', await rep.json().catch(() => ({})));
  return rep.ok;
}

// ═══════════════════════════════════════════════════════════════════════
// INVENTAIRE (photos de référence par élément)
// ═══════════════════════════════════════════════════════════════════════
export async function chargerInventaire() {
  const { data, error } = await supabase.from('inventaire').select('item, photos');
  if (error) { console.error('chargerInventaire', error); return {}; }
  const result = {};
  (data || []).forEach(row => { result[row.item] = row.photos; });
  return result;
}

export async function sauvegarderInventaireItem(item, photos) {
  return proprioAction('inventaire', 'upsert', { ligne: { item, photos, updated_at: new Date().toISOString() } });
}

export async function supprimerInventaireItem(item) {
  return proprioAction('inventaire', 'delete', { cle: 'item', cleValeur: item });
}

// ═══════════════════════════════════════════════════════════════════════
// ÉLÉMENTS ÉTAT DES LIEUX (liste des items suivis, id=1)
// ═══════════════════════════════════════════════════════════════════════
export async function chargerElementsEdl() {
  const { data, error } = await supabase.from('elements_edl').select('liste').eq('id', 1).maybeSingle();
  if (error) { console.error('chargerElementsEdl', error); return null; }
  return data?.liste || null;
}

export async function sauvegarderElementsEdl(liste) {
  return proprioAction('elements_edl', 'upsert', { ligne: { id: 1, liste, updated_at: new Date().toISOString() } });
}

// ═══════════════════════════════════════════════════════════════════════
// EXTRAS
// ═══════════════════════════════════════════════════════════════════════
export async function chargerExtras() {
  const { data, error } = await supabase.from('extras').select('id, data');
  if (error) { console.error('chargerExtras', error); return null; }
  if (!data || data.length === 0) return null;
  return data.map(row => row.data);
}

export async function sauvegarderExtras(extrasArray) {
  // Uniquement des upserts — ne supprime JAMAIS automatiquement. Une
  // suppression ne doit se produire que via un geste explicite de l'utilisateur
  // (voir supprimerExtra ci-dessous), jamais par simple déduction d'un tableau
  // local temporairement incomplet (c'est ce qui causait des pertes de données).
  let ok = true;
  let derniereErreur = null;
  for (const e of extrasArray) {
    const rep = await fetch('/api/proprio-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ table: 'extras', action: 'upsert', ligne: { id: e.id, data: e, updated_at: new Date().toISOString() } }),
    });
    if (!rep.ok) {
      const err = await rep.json().catch(() => ({}));
      derniereErreur = err.error || `Erreur ${rep.status}`;
      console.error('sauvegarderExtras', e.id, derniereErreur);
      ok = false;
    }
  }
  return { ok, error: derniereErreur };
}

// Suppression explicite et unitaire d'un extra — à appeler uniquement au
// moment précis où l'utilisateur confirme vouloir le supprimer.
export async function supprimerExtra(id) {
  return proprioAction('extras', 'delete', { cle: 'id', cleValeur: id });
}

// ═══════════════════════════════════════════════════════════════════════
// CODES PROMO
// ═══════════════════════════════════════════════════════════════════════
export async function chargerCodesPromo() {
  const { data, error } = await supabase.from('codes_promo').select('code, data');
  if (error) { console.error('chargerCodesPromo', error); return {}; }
  const result = {};
  (data || []).forEach(row => { result[row.code] = row.data; });
  return result;
}

export async function sauvegarderCodePromo(code, codeData) {
  return proprioAction('codes_promo', 'upsert', { ligne: { code, data: codeData } });
}

// ═══════════════════════════════════════════════════════════════════════
// NOTES LOCATAIRES
// ═══════════════════════════════════════════════════════════════════════
export async function chargerNotesLocataires() {
  const { data, error } = await supabase.from('notes_locataires').select('reservation_ref, data');
  if (error) { console.error('chargerNotesLocataires', error); return {}; }
  const result = {};
  (data || []).forEach(row => { result[row.reservation_ref] = row.data; });
  return result;
}

export async function sauvegarderNoteLocataire(reservationRef, noteData) {
  return proprioAction('notes_locataires', 'upsert', { ligne: { reservation_ref: reservationRef, data: noteData } });
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIG (maintenance)
// ═══════════════════════════════════════════════════════════════════════
export async function chargerConfig() {
  const { data, error } = await supabase.from('config').select('*').eq('id', 1).maybeSingle();
  if (error) { console.error('chargerConfig', error); return null; }
  return data;
}

export async function sauvegarderConfig(modeMaintenance, messageMaintenance) {
  return proprioAction('config', 'upsert', {
    ligne: { id: 1, mode_maintenance: modeMaintenance, message_maintenance: messageMaintenance, updated_at: new Date().toISOString() },
  });
}

// ═══════════════════════════════════════════════════════════════════════
// RÉINITIALISATION DES DONNÉES DE TEST (admin uniquement)
// ═══════════════════════════════════════════════════════════════════════
export async function supprimerToutesReservations() {
  return proprioAction('reservations', 'delete_all');
}

export async function supprimerToutesNotesLocataires() {
  return proprioAction('notes_locataires', 'delete_all');
}

export async function supprimerTousCodesPromo() {
  return proprioAction('codes_promo', 'delete_all');
}

// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// BANQUE D'IMAGES (réutilisable pour illustrer les extras)
// ═══════════════════════════════════════════════════════════════════════
export async function chargerBanqueImages() {
  const { data, error } = await supabase.from('banque_images').select('id, nom, url').order('updated_at', { ascending: false });
  if (error) { console.error('chargerBanqueImages', error); return []; }
  return data || [];
}

export async function sauvegarderImageBanque(id, nom, url) {
  return proprioAction('banque_images', 'upsert', { ligne: { id, nom, url, updated_at: new Date().toISOString() } });
}

export async function supprimerImageBanque(id) {
  return proprioAction('banque_images', 'delete', { cle: 'id', cleValeur: id });
}

// ═══════════════════════════════════════════════════════════════════════
// TEMPS RÉEL : s'abonner aux changements sur une table
// ═══════════════════════════════════════════════════════════════════════
export function ecouterReservations(callback) {
  const channel = supabase
    .channel('reservations-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, callback)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export function ecouterAnnonce(callback) {
  const channel = supabase
    .channel('annonce-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'annonce' }, callback)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
