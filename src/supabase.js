import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://tfklwizeioivhpnmhryp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_X1QS7GKVf1TVcYd6xa9VaA__Et6kJ_1";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ═══════════════════════════════════════════════════════════════════════
// ANNONCE (un seul enregistrement, id=1)
// ═══════════════════════════════════════════════════════════════════════
export async function chargerAnnonce() {
  const { data, error } = await supabase.from('annonce').select('data').eq('id', 1).maybeSingle();
  if (error) { console.error('chargerAnnonce', error); return null; }
  return data?.data || null;
}

export async function sauvegarderAnnonce(annonceData) {
  const { error } = await supabase.from('annonce').upsert({ id: 1, data: annonceData, updated_at: new Date().toISOString() });
  if (error) console.error('sauvegarderAnnonce', error);
  return !error;
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
  // On récupère les dates actuellement en base pour détecter celles à supprimer
  const { data: existantes } = await supabase.from('disponibilites').select('date');
  const datesEnBase = (existantes || []).map(r => r.date);
  const datesActuelles = Object.keys(disponibilitesObj);
  const datesASupprimer = datesEnBase.filter(d => !datesActuelles.includes(d));

  if (datesASupprimer.length > 0) {
    const { error: delError } = await supabase.from('disponibilites').delete().in('date', datesASupprimer);
    if (delError) console.error('sauvegarderDisponibilites delete', delError);
  }

  const lignes = Object.entries(disponibilitesObj).map(([date, plages]) => ({
    date, plages, updated_at: new Date().toISOString()
  }));
  if (lignes.length === 0) return true;
  const { error } = await supabase.from('disponibilites').upsert(lignes);
  if (error) console.error('sauvegarderDisponibilites', error);
  return !error;
}

export async function supprimerDateDisponibilite(date) {
  const { error } = await supabase.from('disponibilites').delete().eq('date', date);
  if (error) console.error('supprimerDateDisponibilite', error);
  return !error;
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
  const { error } = await supabase.from('reservations').upsert({
    ref: reservation.ref,
    data: reservation,
    date: reservation.date,
    email: reservation.email,
    statut: reservation.statut || 'en_attente',
    updated_at: new Date().toISOString(),
  });
  if (error) console.error('sauvegarderReservation', error);
  return !error;
}

// ═══════════════════════════════════════════════════════════════════════
// COMPTES LOCATAIRES
// ═══════════════════════════════════════════════════════════════════════
export async function chargerComptes() {
  const { data, error } = await supabase.from('comptes').select('email, data');
  if (error) { console.error('chargerComptes', error); return {}; }
  const result = {};
  (data || []).forEach(row => { result[row.email] = row.data; });
  return result;
}

export async function sauvegarderCompte(email, compteData) {
  const { error } = await supabase.from('comptes').upsert({ email, data: compteData });
  if (error) console.error('sauvegarderCompte', error);
  return !error;
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
  const { error } = await supabase.from('inventaire').upsert({ item, photos, updated_at: new Date().toISOString() });
  if (error) console.error('sauvegarderInventaireItem', error);
  return !error;
}

export async function supprimerInventaireItem(item) {
  const { error } = await supabase.from('inventaire').delete().eq('item', item);
  if (error) console.error('supprimerInventaireItem', error);
  return !error;
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
  const { error } = await supabase.from('elements_edl').upsert({ id: 1, liste, updated_at: new Date().toISOString() });
  if (error) console.error('sauvegarderElementsEdl', error);
  return !error;
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
  // On vide et on réinsère pour gérer suppressions/ajouts simplement
  const { error: delError } = await supabase.from('extras').delete().neq('id', '__never__');
  if (delError) console.error('sauvegarderExtras delete', delError);
  if (extrasArray.length === 0) return true;
  const lignes = extrasArray.map(e => ({ id: e.id, data: e, updated_at: new Date().toISOString() }));
  const { error } = await supabase.from('extras').upsert(lignes);
  if (error) console.error('sauvegarderExtras', error);
  return !error;
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
  const { error } = await supabase.from('codes_promo').upsert({ code, data: codeData });
  if (error) console.error('sauvegarderCodePromo', error);
  return !error;
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
  const { error } = await supabase.from('notes_locataires').upsert({ reservation_ref: reservationRef, data: noteData });
  if (error) console.error('sauvegarderNoteLocataire', error);
  return !error;
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
  const { error } = await supabase.from('config').upsert({
    id: 1, mode_maintenance: modeMaintenance, message_maintenance: messageMaintenance, updated_at: new Date().toISOString()
  });
  if (error) console.error('sauvegarderConfig', error);
  return !error;
}

// ═══════════════════════════════════════════════════════════════════════
// RÉINITIALISATION DES DONNÉES DE TEST (admin uniquement)
// ═══════════════════════════════════════════════════════════════════════
export async function supprimerToutesReservations() {
  const { error } = await supabase.from('reservations').delete().neq('ref', '__never__');
  if (error) console.error('supprimerToutesReservations', error);
  return !error;
}

export async function supprimerToutesNotesLocataires() {
  const { error } = await supabase.from('notes_locataires').delete().neq('reservation_ref', '__never__');
  if (error) console.error('supprimerToutesNotesLocataires', error);
  return !error;
}

export async function supprimerTousCodesPromo() {
  const { error } = await supabase.from('codes_promo').delete().neq('code', '__never__');
  if (error) console.error('supprimerTousCodesPromo', error);
  return !error;
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
