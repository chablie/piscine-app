-- ═══════════════════════════════════════════════════════════════════════
-- Script de SÉCURISATION RLS — Ma Piscine Privée (AB Kaizen)
-- À exécuter dans Supabase > SQL Editor > New query
-- Remplace les anciennes règles "Public read/write" (ouvertes à tous) par
-- des règles restrictives : lecture publique conservée là où l'app en a
-- besoin, écriture réservée à la clé service_role (utilisée uniquement par
-- les fonctions serverless Vercel, après vérification d'une session).
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Nouvelle table : identifiants locataires (mots de passe hachés) ───
-- Totalement fermée en accès direct : AUCUNE policy publique n'est créée.
-- Seule la clé service_role (qui contourne le RLS) peut la lire/écrire,
-- via /api/creer-compte, /api/connexion-locataire, /api/reinitialiser-mdp-locataire.
create table if not exists comptes_auth (
  email text primary key,
  motdepasse_hache text not null,
  updated_at timestamptz default now()
);
alter table comptes_auth enable row level security;
-- Pas de "create policy" ici : par défaut, RLS activé sans policy = accès refusé à tout le monde
-- sauf à la clé service_role, qui contourne systématiquement le RLS.

-- ─── 2. Table comptes : on retire l'ancienne policy "tout public" ───
-- Elle ne contient plus de mot de passe depuis la mise à jour de l'app
-- (désormais dans comptes_auth). Lecture publique conservée (nécessaire à
-- l'app), écriture réservée au serveur.
drop policy if exists "Public read/write comptes" on comptes;
create policy "Lecture publique comptes" on comptes for select using (true);
-- Aucune policy insert/update/delete pour le rôle anon : ces opérations ne
-- passent plus que par /api/creer-compte, /api/sauvegarder-compte,
-- /api/supprimer-mon-compte (clé service_role).

-- ─── 3. Table reservations ───
-- Lecture publique conservée (nécessaire au calendrier de disponibilité et
-- à l'affichage des réservations). Création publique conservée (nouvelle
-- demande de réservation). Modification/suppression réservées au serveur
-- (accepter/refuser/annuler/rembourser/EDL passent par
-- /api/sauvegarder-reservation, qui vérifie la session).
drop policy if exists "Public read/write reservations" on reservations;
create policy "Lecture publique reservations" on reservations for select using (true);
create policy "Creation publique reservations" on reservations for insert with check (true);
-- Pas de policy update/delete pour anon.

-- ─── 4. Tables de configuration : lecture publique, écriture serveur ───
drop policy if exists "Public read/write annonce" on annonce;
create policy "Lecture publique annonce" on annonce for select using (true);

drop policy if exists "Public read/write disponibilites" on disponibilites;
create policy "Lecture publique disponibilites" on disponibilites for select using (true);

drop policy if exists "Public read/write inventaire" on inventaire;
create policy "Lecture publique inventaire" on inventaire for select using (true);

drop policy if exists "Public read/write elements_edl" on elements_edl;
create policy "Lecture publique elements_edl" on elements_edl for select using (true);

drop policy if exists "Public read/write extras" on extras;
create policy "Lecture publique extras" on extras for select using (true);

drop policy if exists "Public read/write codes_promo" on codes_promo;
create policy "Lecture publique codes_promo" on codes_promo for select using (true);

drop policy if exists "Public read/write notes_locataires" on notes_locataires;
create policy "Lecture publique notes_locataires" on notes_locataires for select using (true);

drop policy if exists "Public read/write config" on config;
create policy "Lecture publique config" on config for select using (true);

-- ═══════════════════════════════════════════════════════════════════════
-- Résumé après exécution :
--   - comptes_auth      : AUCUN accès public (ni lecture, ni écriture)
--   - comptes           : lecture publique / écriture via service_role
--   - reservations      : lecture + création publiques / modif-suppr via service_role
--   - annonce, disponibilites, inventaire, elements_edl, extras,
--     codes_promo, notes_locataires, config :
--                          lecture publique / écriture via service_role
--
-- ⚠️ Si tu as des comptes de test créés AVANT cette mise à jour, leur mot de
-- passe (en clair, dans l'ancienne colonne data.motdepasse) reste orphelin :
-- ces comptes ne pourront plus se connecter tant qu'ils n'auront pas été
-- recréés. Supprime-les si ce sont des données de test :
--   delete from comptes;
-- ═══════════════════════════════════════════════════════════════════════
