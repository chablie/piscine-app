// Librairie partagée : requêtes Supabase authentifiées par la clé service_role.
// Cette clé contourne totalement le RLS — elle ne doit JAMAIS être envoyée au navigateur.
// Utilisée uniquement par les fonctions serverless, après vérification d'une session.

const SUPABASE_URL = "https://tfklwizeioivhpnmhryp.supabase.co";

function headers() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante');
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

export async function selectUn(table, colonne, valeur, select = '*') {
  const rep = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${colonne}=eq.${encodeURIComponent(valeur)}&select=${encodeURIComponent(select)}`,
    { headers: headers() }
  );
  if (!rep.ok) throw new Error(`selectUn ${table} : ${rep.status}`);
  const rows = await rep.json();
  return rows[0] || null;
}

export async function upsert(table, ligne) {
  const rep = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(ligne),
  });
  if (!rep.ok) throw new Error(`upsert ${table} : ${rep.status} ${await rep.text()}`);
  return true;
}

export async function supprimerUn(table, colonne, valeur) {
  const rep = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${colonne}=eq.${encodeURIComponent(valeur)}`,
    { method: 'DELETE', headers: headers() }
  );
  if (!rep.ok) throw new Error(`supprimerUn ${table} : ${rep.status}`);
  return true;
}

export async function supprimerTout(table, colonneCle) {
  const rep = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${colonneCle}=neq.__never__`,
    { method: 'DELETE', headers: headers() }
  );
  if (!rep.ok) throw new Error(`supprimerTout ${table} : ${rep.status}`);
  return true;
}
