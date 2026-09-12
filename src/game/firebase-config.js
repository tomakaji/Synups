// Connexion Firebase (Round 20, retour utilisateur: "j'ai un compte firebase
// et un compte AdMob, tu peux mettre en place tout ce qu'il faut ?") — SDK
// modulaire chargé depuis le CDN officiel gstatic.com plutôt que via npm:
// l'environnement de build de ce projet a un node_modules sur un montage
// réseau trop lent pour installer proprement le paquet npm "firebase" (~1600
// fichiers, plusieurs tentatives ont expiré). Le CDN est une méthode de
// distribution officielle du SDK modulaire
// (https://firebase.google.com/docs/web/setup#add-sdks-cdn) et Vite laisse
// les imports en URL absolue tels quels dans le bundle final (jamais
// résolus/empaquetés par le bundler) — aucun inconvénient à l'usage, juste
// besoin du réseau, de toute façon déjà requis pour parler à Firestore.
//
// SEUL module autorisé à connaître la config Firebase et à appeler
// initializeApp/getAuth — voir community-store.js: c'est lui qui consomme
// `db`/`firebaseReady` ci-dessous, jamais l'inverse (même principe que
// ads.js: un seul endroit à retoucher si le projet Firebase est recréé).
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

// Config du projet "Synups" (console Firebase, app Web "Synups (Capacitor)").
// L'apiKey d'un SDK Web Firebase n'est PAS un secret à protéger (elle
// identifie juste le projet, pas un utilisateur) — la vraie protection vient
// des règles Firestore (voir firestore.rules à la racine du projet), pas de
// cette valeur : sûre à committer, comme le fait la doc officielle Firebase.
const firebaseConfig = {
  apiKey: "AIzaSyCWzYU5rTpSvWUCxnk9AqxM7elD8gBf7Io",
  authDomain: "synups-3b038.firebaseapp.com",
  projectId: "synups-3b038",
  storageBucket: "synups-3b038.firebasestorage.app",
  messagingSenderId: "865488839392",
  appId: "1:865488839392:web:21990673bb82923991a685",
  measurementId: "G-HZ1LM00DZE",
};

// Exportée (round analytics): analytics.js a besoin de CETTE MÊME instance
// d'app pour getAnalytics(app) — jamais une 2e initializeApp() séparée, qui
// dupliquerait la config pour rien et risquerait une désynchro si le projet
// Firebase change un jour (voir commentaire de tête: un seul endroit connaît
// firebaseConfig).
export const app = initializeApp(firebaseConfig);

/** Instance Firestore — sûre à utiliser immédiatement. Les lectures
 * publiques (ex. le fil communautaire) ne nécessitent PAS d'attendre
 * l'authentification anonyme ci-dessous : voir firestore.rules, `allow
 * read: if true` sur la collection `levels`. Seules les écritures en ont
 * besoin (voir firebaseReady).
 *
 * Round suivant (audit coûts serveur, retour utilisateur: "j'aimerais que
 * le serveur tienne bien") — cache local persistant (IndexedDB) activé ici:
 * une réouverture de l'app peut servir le fil Communauté depuis le disque
 * PENDANT que la requête réseau (voir community-store.js: refreshCommunityCloud)
 * part en tâche de fond, et surtout reste CONSULTABLE hors ligne (voir
 * échange avec l'utilisateur plus bas) au lieu de repartir d'un fil vide à
 * chaque lancement. `persistentSingleTabManager` plutôt que
 * `persistentMultipleTabManager`: l'app tourne dans une seule WebView
 * Capacitor à la fois (jamais plusieurs onglets d'un même appareil ouverts
 * sur ce cache), donc pas besoin de coordination multi-onglets. `getFirestore`
 * en repli si `initializeFirestore` échoue (IndexedDB indisponible :
 * navigation privée, très vieux WebView...) — jamais un point de plantage,
 * même principe "best-effort" que le reste de ce fichier. */
export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
    });
  } catch {
    return getFirestore(app);
  }
})();

const auth = getAuth(app);

let readyPromise = null;
/** Résout avec l'uid anonyme du device dès que la connexion Firebase Auth
 * (fournisseur "Anonyme", activé dans la console) aboutit — à utiliser AVANT
 * toute écriture Firestore (publier/retirer une grille), jamais pour les
 * lectures (voir `db` ci-dessus). Résout avec `null` en cas d'échec (réseau
 * coupé, quota...) plutôt que de rejeter : à l'appelant de décider quoi
 * faire d'un uid manquant, sans jamais faire planter le reste de l'app (voir
 * community-store.js: publishLevel reste purement local/optimiste dans ce
 * cas). Mise en cache — une seule tentative de connexion réelle même si
 * appelée plusieurs fois (même principe que ads.js: initPromise). */
export function firebaseReady() {
  if (!readyPromise) {
    readyPromise = new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
          unsubscribe();
          resolve(user.uid);
        }
      });
      signInAnonymously(auth).catch(() => resolve(null));
    });
  }
  return readyPromise;
}
