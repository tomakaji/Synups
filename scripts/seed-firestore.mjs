// Script d'administration Firestore — (ré)injecte les 16 grilles
// communautaires "fictives" (voir scripts/community-seed-data.json) comme de
// VRAIS documents Firestore, avec de vrais compteurs likesCount/playsCount
// et un ownerUid dédié par faux auteur (voir ownerUid: "seed-<pseudo>").
//
// Retour utilisateur: "je veux que toutes les grilles de communauté soient
// désormais requêtées et non une donnée en local [...] tu peux créer un
// JSON d'init de DB pour créer les faux profils sur le firestore mais d'une
// façon vraie/véritablement fonctionnelle, on utilisera ce JSON pour réinit
// la DB lorsqu'on le voudra". Avant ce round, ces 16 grilles vivaient dans
// src/game/community-seed.js (un tableau JS importé directement par
// community-store.js) et étaient TOUJOURS mélangées au fil réel, même sans
// aucune connexion réseau — désormais community-store.js ne lit plus QUE
// Firestore (voir listLevels()), donc ces grilles doivent exister pour de
// vrai côté serveur pour continuer à apparaître dans Communauté.
//
// Utilise le SDK Admin (bypass les règles de sécurité — normal, un script
// d'admin n'est PAS un joueur anonyme) — nécessite une clé de compte de
// service, jamais commitée : voir la variable d'environnement
// GOOGLE_APPLICATION_CREDENTIALS ci-dessous.
//
// Usage :
//   GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json \
//     node scripts/seed-firestore.mjs
//
//   (upsert non-destructif : réécrit uniquement les 16 documents seed,
//   n'importe jamais aux grilles publiées par de vrais joueurs)
//
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/seed-firestore.mjs --reset
//
//   (DESTRUCTIF : vide ENTIÈREMENT les collections `levels` et `likes` —
//   TOUTES les grilles publiées par de vrais joueurs et tous les likes
//   partent avec — puis réinjecte uniquement les 16 grilles seed. Réservé à
//   une remise à zéro complète voulue explicitement, jamais lancé par
//   erreur : demande une confirmation tapée au clavier avant d'agir.)
//
// Comment obtenir la clé de compte de service (à faire UNE fois, depuis un
// poste où on est connecté au compte Google propriétaire du projet Firebase
// "synups-3b038") : console Firebase > Paramètres du projet > Comptes de
// service > "Générer une nouvelle clé privée". Le fichier téléchargé ne doit
// JAMAIS être commité dans le repo (voir .gitignore) — Claude/cet
// environnement n'y a pas accès et ne peut donc pas exécuter ce script à ta
// place : c'est un geste que TOI seul peux faire, depuis ta machine.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import readline from "node:readline/promises";
import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, "community-seed-data.json");
const LEVELS_COLLECTION = "levels";
const LIKES_COLLECTION = "likes";

function loadSeed() {
  const raw = readFileSync(SEED_PATH, "utf-8");
  return JSON.parse(raw);
}

/** Supprime tous les documents d'une collection, par lots de 400 (marge
 * sous la limite de 500 opérations par batch Firestore) — utilisé
 * uniquement par --reset, jamais par l'upsert normal. */
async function deleteAllDocs(db, collectionName) {
  const snapshot = await db.collection(collectionName).get();
  if (snapshot.empty) return 0;
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + 400)) batch.delete(doc.ref);
    await batch.commit();
  }
  return docs.length;
}

async function confirmReset() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    'Ceci va SUPPRIMER TOUTES les grilles publiées par de vrais joueurs et tous les likes, ' +
      'avant de réinjecter uniquement les 16 grilles seed. Cette action est IRRÉVERSIBLE.\n' +
      'Tape "reset" pour confirmer, autre chose pour annuler : '
  );
  rl.close();
  return answer.trim().toLowerCase() === "reset";
}

async function main() {
  const doReset = process.argv.includes("--reset");

  // applicationDefault() lit GOOGLE_APPLICATION_CREDENTIALS si définie,
  // sinon échoue avec un message clair — jamais de tentative silencieuse
  // d'utiliser des identifiants inattendus.
  initializeApp({ credential: process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : cert() });
  const db = getFirestore();

  if (doReset) {
    const proceed = await confirmReset();
    if (!proceed) {
      console.log("Annulé.");
      return;
    }
    const removedLevels = await deleteAllDocs(db, LEVELS_COLLECTION);
    const removedLikes = await deleteAllDocs(db, LIKES_COLLECTION);
    console.log(`Supprimé ${removedLevels} grille(s) et ${removedLikes} like(s).`);
  }

  const seed = loadSeed();
  const batch = db.batch();
  for (const entry of seed) {
    const { id, ...data } = entry;
    // doc(id) explicite (pas add() à ID auto-généré) : relancer ce script
    // plusieurs fois écrase proprement les MÊMES 16 documents plutôt que
    // d'en créer des doublons à chaque exécution — c'est ce qui rend le
    // script rejouable ("réinit la DB lorsqu'on le voudra").
    batch.set(db.collection(LEVELS_COLLECTION).doc(id), data);
  }
  await batch.commit();
  console.log(`${seed.length} grille(s) seed injectée(s)/mise(s) à jour dans Firestore.`);
}

main().catch((err) => {
  console.error("Échec du script de seed :", err.message);
  process.exit(1);
});
