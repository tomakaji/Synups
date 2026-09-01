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
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
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

const app = initializeApp(firebaseConfig);

/** Instance Firestore — sûre à utiliser immédiatement. Les lectures
 * publiques (ex. le fil communautaire) ne nécessitent PAS d'attendre
 * l'authentification anonyme ci-dessous : voir firestore.rules, `allow
 * read: if true` sur la collection `levels`. Seules les écritures en ont
 * besoin (voir firebaseReady). */
export const db = getFirestore(app);

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
