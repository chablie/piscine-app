-- ═══════════════════════════════════════════════════════════════════════
-- Anti-bruteforce côté serveur : suivi des tentatives de connexion échouées
-- À exécuter dans Supabase > SQL Editor > New query
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists tentatives_connexion (
  id text primary key,              -- "admin:email", "proprio:email" ou "locataire:email"
  compteur int not null default 0,
  bloque_jusqua timestamptz,
  updated_at timestamptz default now()
);

alter table tentatives_connexion enable row level security;
-- Aucune policy publique : cette table n'est accessible que via la clé
-- service_role (donc uniquement depuis /api/auth côté serveur).
