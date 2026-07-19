-- ═══════════════════════════════════════════════════════════════════════
-- Ajout : banque d'images réutilisable pour les extras
-- À exécuter dans Supabase > SQL Editor > New query
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists banque_images (
  id text primary key,
  nom text not null,
  url text not null,
  updated_at timestamptz default now()
);

alter table banque_images enable row level security;

-- Lecture publique (nécessaire pour afficher les extras illustrés côté client),
-- écriture réservée au serveur (proprio-action.js, clé service_role)
create policy "Lecture publique banque_images" on banque_images for select using (true);
