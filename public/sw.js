// Service worker de My Piscine Privée
//
// Stratégie volontairement prudente : « réseau d'abord, cache en secours ».
// Le cache ne sert QUE lorsque le téléphone est hors ligne ou que le réseau
// échoue. Ainsi, après chaque déploiement, les visiteurs reçoivent toujours la
// dernière version du site — jamais une version figée dans le cache, qui est le
// piège classique des applications installables.
//
// Rien de sensible n'est mis en cache : les appels à /api/ (authentification,
// paiements, réservations) sont systématiquement exclus.

const VERSION_CACHE = 'mypiscine-v1';
const RESSOURCES_DE_BASE = [
  '/',
  '/manifest.webmanifest',
  '/icone-192.png',
  '/icone-512.png',
];

// Installation : on met en cache la coquille minimale de l'application
self.addEventListener('install', evenement => {
  evenement.waitUntil(
    caches.open(VERSION_CACHE)
      .then(cache => cache.addAll(RESSOURCES_DE_BASE))
      // Un échec de mise en cache ne doit jamais empêcher l'installation
      .catch(err => console.warn('Mise en cache initiale partielle :', err))
      .then(() => self.skipWaiting()) // la nouvelle version prend la main aussitôt
  );
});

// Activation : on supprime les caches des versions précédentes
self.addEventListener('activate', evenement => {
  evenement.waitUntil(
    caches.keys()
      .then(cles => Promise.all(
        cles.filter(cle => cle !== VERSION_CACHE).map(cle => caches.delete(cle))
      ))
      .then(() => self.clients.claim()) // prend le contrôle des onglets déjà ouverts
  );
});

self.addEventListener('fetch', evenement => {
  const requete = evenement.request;

  // On ne gère que les lectures simples
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);

  // Jamais de cache pour les appels serveur (authentification, paiements,
  // réservations) ni pour les domaines tiers (Supabase, Stripe, Google Fonts…)
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  evenement.respondWith(
    fetch(requete)
      .then(reponse => {
        // Réseau disponible : on répond avec la version fraîche et on rafraîchit le cache
        if (reponse && reponse.status === 200 && reponse.type === 'basic') {
          const copie = reponse.clone();
          caches.open(VERSION_CACHE).then(cache => cache.put(requete, copie)).catch(() => {});
        }
        return reponse;
      })
      .catch(async () => {
        // Hors ligne : on tente le cache
        const enCache = await caches.match(requete);
        if (enCache) return enCache;
        // Pour une navigation, on retombe sur la page d'accueil mise en cache
        if (requete.mode === 'navigate') {
          const accueil = await caches.match('/');
          if (accueil) return accueil;
        }
        return new Response(
          "Vous êtes hors ligne. Reconnectez-vous à Internet pour accéder à My Piscine Privée.",
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
      })
  );
});
