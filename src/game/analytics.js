// Firebase Analytics (Google Analytics for Firebase) — retour utilisateur:
// "est-ce qu'intégrer des outils d'analytics va coûter cher [...] ?" —
// réponse vérifiée: la collecte + le tableau de bord Analytics sont inclus
// gratuitement dans le plan Firebase "Spark" (celui déjà utilisé par ce
// projet pour Firestore/Auth, voir firebase-config.js), export BigQuery
// compris. Seul un usage payant de BigQuery LUI-MÊME (grosses requêtes SQL
// répétées) coûterait quelque chose — hors de portée pour une app de cette
// taille avec un usage tableau de bord classique.
//
// Même app Firebase que firestore/auth (voir firebase-config.js: un seul
// endroit connaît la config du projet) — SDK modulaire chargé depuis le CDN
// officiel, même raison qu'ailleurs dans ce projet (voir le commentaire en
// tête de firebase-config.js: environnement de build avec un node_modules
// trop lent pour installer le paquet npm "firebase").
//
// isSupported() (asynchrone) vérifie que l'environnement d'exécution sait
// utiliser Analytics (IndexedDB dispo, pas dans un contexte qui le bloque)
// AVANT d'appeler getAnalytics() — sans ça, certains contextes (webview
// très restreinte, navigation privée...) peuvent faire planter l'init.
// Comme ads.js/haptics.js: jamais de throw, tout événement de tracking est
// un best-effort silencieux, jamais un point de plantage du jeu.
import { app } from "./firebase-config.js";
import {
  getAnalytics,
  logEvent as fbLogEvent,
  isSupported,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-analytics.js";

let analyticsPromise = null;

function getAnalyticsInstance() {
  if (!analyticsPromise) {
    analyticsPromise = isSupported()
      .then((ok) => (ok ? getAnalytics(app) : null))
      .catch(() => null);
  }
  return analyticsPromise;
}

/** Envoie un événement Analytics nommé (voir appelants: main.js/sommation.js/
 * community-store.js) — no-op silencieux si Analytics n'est pas supporté ou
 * pas encore prêt, jamais bloquant/throwant (même appelé "à chaud" avant que
 * la promesse d'init ait résolu: l'événement est simplement perdu plutôt que
 * mis en file, acceptable pour du tracking best-effort). `params` doit rester
 * un objet simple de valeurs primitives (string/number/bool) — voir la doc
 * Firebase sur les noms d'événements/paramètres réservés à éviter. */
export function trackEvent(name, params = {}) {
  getAnalyticsInstance()
    .then((analytics) => {
      if (analytics) fbLogEvent(analytics, name, params);
    })
    .catch(() => {});
}
