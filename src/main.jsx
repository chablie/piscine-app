import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// ─── Application installable (PWA) ──────────────────────────────────────────
// L'enregistrement du service worker permet d'installer le site sur l'écran
// d'accueil du téléphone et de l'ouvrir comme une vraie application.
// On l'enregistre après le chargement pour ne pas ralentir le premier affichage.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(enregistrement => {
        // Vérifie la présence d'une nouvelle version à chaque ouverture
        enregistrement.update().catch(() => {});
      })
      .catch(err => console.warn('Service worker non enregistré :', err));
  });
}
