// Mode Infini — petit client qui possède un POOL de Web Workers de
// génération et expose une API à base de Promise à main.js, plutôt que de
// laisser main.js manipuler directement postMessage/onmessage. Voir
// generator.worker.js pour le protocole exact d'un Worker individuel.
//
// Pourquoi un pool plutôt qu'un seul Worker (voir aussi generator.js,
// analyzeAndCount) : au palier 3★, chaque tentative de génération coûte
// cher (grille peu dense = arbre de recherche large), et il faut souvent
// plusieurs dizaines de tentatives avant de tomber sur un candidat qui
// mesure vraiment tier 3 (~60-70% de réussite). Répartir ce même budget de
// tentatives entre plusieurs Workers qui tournent EN PARALLÈLE (un par
// coeur CPU dispo, jusqu'à 4) réduit d'autant le temps perçu — surtout
// combiné à la course "premier arrivé, premier servi" ci-dessous : dès
// qu'UN Worker rapporte un candidat parfait, on n'attend pas les autres.
//
// Expose aussi un petit buffer de pré-génération (voir section dédiée plus
// bas, `ensureLevelBuffer`/`takeBufferedLevel`) : le même pool tourne en
// arrière-plan pendant que le joueur résout le niveau courant, pour qu'aucun
// temps de chargement ne soit perçu tant que la config ne change pas.

import { clampTier, getGenerationBudget, isBetterCandidate } from "./generator.js";

const POOL_SIZE = Math.max(
  1,
  Math.min(4, (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4)
);

// Grand nombre premier utilisé pour espacer les seeds entre Workers, assez
// éloigné du multiplicateur (7919) déjà utilisé par generator.js en interne
// pour espacer les tentatives DANS un même Worker, pour éviter tout
// chevauchement de seeds entre deux Workers du pool.
const WORKER_SEED_STRIDE = 104_729;

let pool = null; // Array<{ worker }>, créé au premier appel
let nextRequestId = 1; // compteur global de requêtes (voir runOnWorker)

function makeWorkerEntry() {
  return { worker: new Worker(new URL("./generator.worker.js", import.meta.url), { type: "module" }) };
}

function ensurePool() {
  if (pool) return pool;
  pool = Array.from({ length: POOL_SIZE }, makeWorkerEntry);
  return pool;
}

// IMPORTANT — bug de build contourné ici (voir aussi le commentaire sur
// `new Worker(new URL(...))` plus haut dans l'historique) : une version
// antérieure stockait `resolve`/`reject` sur une propriété `entry.pending`,
// relue plus tard par un handler `onmessage` déclaré séparément dans
// `makeWorkerEntry`. En production (Vite/Rollup, PAS en dev), le
// tree-shaking de Rollup perdait la trace de cette indirection au travers
// d'une propriété d'objet et ÉLIMINAIT purement et simplement les appels à
// resolve()/reject() comme s'ils étaient du code mort — la génération
// restait donc bloquée indéfiniment une fois déployé, alors que tout
// fonctionnait normalement en `npm run dev`. Confirmé en comparant la
// sortie d'esbuild seul (correcte) à celle du pipeline Vite complet
// (cassée). Le contournement : `resolve`/`reject` restent des closures
// DIRECTES du listener qui les appelle (même portée lexicale, pas de
// passage par un objet intermédiaire relu ailleurs), via
// addEventListener/removeEventListener scopés à CET appel plutôt qu'un
// onmessage unique réassigné/relu via une propriété partagée.
function runOnWorker(entry, payload) {
  const requestId = nextRequestId++;
  const worker = entry.worker;
  return new Promise((resolve, reject) => {
    function cleanup() {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    }
    function onMessage(event) {
      const data = event.data || {};
      if (data.requestId !== requestId) return; // réponse obsolète: ignorée
      cleanup();
      if (data.type === "result") resolve(data.result);
      else if (data.type === "error") reject(new Error(data.message || "Erreur du générateur"));
    }
    function onError(event) {
      cleanup();
      reject(event.error || new Error(event.message || "Erreur du Worker de génération"));
    }
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ type: "generate", requestId, ...payload });
  });
}

/**
 * Combinateur générique : lance N tâches (déjà démarrées, sous forme de
 * Promises) et résout dès que l'une d'elles produit un résultat "parfait"
 * (`isPerfect`), sans attendre les autres. Si aucune n'est parfaite, résout
 * avec le meilleur résultat rencontré une fois TOUTES les tâches terminées
 * (`isBetter` compare deux résultats). Rejette seulement si toutes les
 * tâches échouent sans qu'aucune n'ait produit de résultat exploitable.
 *
 * Extrait en fonction pure (aucune dépendance à `Worker`) pour être
 * testable avec de simples Promises — voir la note dans le commentaire de
 * `requestLevel`.
 */
export function raceForBest(taskPromises, { isPerfect, isBetter }) {
  return new Promise((resolve, reject) => {
    const total = taskPromises.length;
    if (total === 0) {
      resolve(null);
      return;
    }
    let settled = false;
    let doneCount = 0;
    let best = null;
    let lastError = null;

    for (const task of taskPromises) {
      task
        .then((result) => {
          if (settled) return;
          doneCount++;
          if (result && isPerfect(result)) {
            settled = true;
            resolve(result);
            return;
          }
          if (result && (!best || isBetter(best, result))) best = result;
          if (!settled && doneCount === total) {
            settled = true;
            resolve(best);
          }
        })
        .catch((err) => {
          if (settled) return;
          doneCount++;
          lastError = err;
          if (!settled && doneCount === total) {
            settled = true;
            if (best) resolve(best);
            else reject(lastError);
          }
        });
    }
  });
}

/**
 * Lance UNE génération répartie sur TOUS les Workers du pool et retourne une
 * Promise résolue avec le résultat de `generateLevel()` (voir generator.js),
 * ou `null` si même le fallback best-effort n'a rien trouvé nulle part.
 * Chaque appel à `runOnWorker` s'identifie via un `requestId` unique (voir
 * son commentaire) et ignore toute réponse dont l'id ne correspond pas, donc
 * plusieurs générations peuvent en théorie cohabiter sur un même Worker sans
 * se corrompre — en pratique la file d'attente `enqueuePoolJob` plus bas les
 * sérialise de toute façon (une seule génération à la fois sur le pool).
 */
function generateOnce({ difficulty, enabledFeatureKeys, seed, maxAttempts, maxTimeMs } = {}) {
  const tier = clampTier(difficulty);
  // Voir generator.js/generateLevel: quand la couleur est demandée, un
  // résultat n'est "parfait" que s'il l'a AUSSI obtenue — sinon on continue
  // à comparer les candidats de tous les Workers (isBetterCandidate,
  // préférence couleur) plutôt que de s'arrêter sur le premier bon palier
  // trouvé sans couleur. Le miroir, lui, n'entre PAS dans ce critère
  // "parfait" (voir MIRROR_DENSITY dans generator.js pour le pourquoi — le
  // miroir doit rester un bonus opportuniste, jamais un motif de prolonger
  // la recherche) : il reste seulement PRÉFÉRÉ à palier/couleur égaux via
  // isBetterCandidate.
  const colorRequested = Array.isArray(enabledFeatureKeys) && enabledFeatureKeys.includes("color");
  const mirrorRequested = Array.isArray(enabledFeatureKeys) && enabledFeatureKeys.includes("mirror");
  const defaultBudget = getGenerationBudget(tier);
  const totalAttempts = maxAttempts ?? defaultBudget.maxAttempts;
  const totalTimeMs = maxTimeMs ?? defaultBudget.maxTimeMs;
  const baseSeed = Math.floor(seed ?? (Date.now() ^ Math.floor(Math.random() * 0xffffffff)));

  const workers = ensurePool();
  const perWorkerAttempts = Math.max(1, Math.ceil(totalAttempts / workers.length));

  const tasks = workers.map((entry, i) =>
    runOnWorker(entry, {
      difficulty,
      enabledFeatureKeys,
      seed: baseSeed + i * WORKER_SEED_STRIDE,
      maxAttempts: perWorkerAttempts,
      maxTimeMs: totalTimeMs,
    })
  );

  return raceForBest(tasks, {
    isPerfect: (r) => r.confirmedUnique && r.measuredTier === tier && (!colorRequested || r.featureSubset?.includes("color")),
    isBetter: (best, candidate) => isBetterCandidate(best, candidate, tier, colorRequested, mirrorRequested),
  });
}

// -- File d'attente du pool --------------------------------------------------
// `generateOnce` utilise TOUS les Workers du pool à la fois (un seul
// `.pending` par Worker) — deux générations qui se chevauchent orphelinent
// silencieusement l'une des deux (voir son commentaire). Le buffer de
// pré-génération (plus bas) peut vouloir lancer PLUSIEURS générations pour
// combler son manque, potentiellement PENDANT qu'une requête au premier plan
// (le joueur clique "Générer"/"Niveau suivant") est aussi en cours — cette
// file d'attente garantit qu'une seule génération tourne à la fois sur le
// pool, quelle que soit son origine. Deux files de priorité plutôt qu'une
// seule : une requête au premier plan (le joueur attend activement) passe
// devant les remplissages de buffer en attente (mais n'interrompt jamais un
// remplissage DÉJÀ en cours — les jobs ne sont pas préemptibles).
const highPriorityQueue = [];
const lowPriorityQueue = [];
let activeJob = false;

function runNextQueuedJob() {
  if (activeJob) return;
  const next = highPriorityQueue.shift() || lowPriorityQueue.shift();
  if (!next) return;
  activeJob = true;
  generateOnce(next.config)
    .then(next.resolve, next.reject)
    .finally(() => {
      activeJob = false;
      runNextQueuedJob();
    });
}

function enqueuePoolJob(config, priority) {
  return new Promise((resolve, reject) => {
    (priority === "high" ? highPriorityQueue : lowPriorityQueue).push({ config, resolve, reject });
    runNextQueuedJob();
  });
}

/**
 * Lance une génération au premier plan (priorité haute — voir file
 * d'attente ci-dessus) et retourne une Promise résolue avec le résultat de
 * `generateLevel()`, ou `null` si même le fallback best-effort n'a rien
 * trouvé. C'est le point d'entrée à utiliser pour une génération demandée
 * activement par le joueur (voir `takeBufferedLevel` pour servir un niveau
 * déjà prêt sans passer par ici).
 */
export function requestLevel(config) {
  return enqueuePoolJob(config, "high");
}

// -- Buffer de pré-génération -----------------------------------------------
// Retour utilisateur : viser 3 niveaux d'avance, générés en arrière-plan
// pendant que le joueur résout le niveau courant, pour qu'aucun temps de
// chargement ne soit perçu tant que la config (difficulté/features) ne
// change pas. Indexé par une SIGNATURE de config plutôt que par valeur: dès
// que la difficulté ou les features cochées changent, l'ancien buffer est
// simplement abandonné (les générations déjà en vol pour l'ancienne config,
// une fois terminées, sont jetées — voir la vérification de signature dans
// `ensureLevelBuffer`) et un nouveau se remplit pour la config actuelle.
const BUFFER_SIZE = 3;
let bufferSignature = null;
let bufferItems = []; // niveaux prêts (résultats de requestLevel), FIFO
let bufferPending = 0; // générations actuellement en vol pour bufferSignature

function configSignature({ difficulty, enabledFeatureKeys }) {
  const keys = Array.isArray(enabledFeatureKeys) ? [...enabledFeatureKeys].sort() : [];
  return `${difficulty}::${keys.join(",")}`;
}

/**
 * S'assure que le buffer contient jusqu'à BUFFER_SIZE niveaux prêts pour la
 * config donnée, en mettant en file d'attente (priorité basse — voir
 * enqueuePoolJob) les générations manquantes — ne bloque JAMAIS l'appelant.
 * Sûr à appeler souvent (ex: à chaque changement de réglage, après chaque
 * niveau chargé) : ne relance des générations que pour combler le manque
 * réel (`bufferItems.length + bufferPending`), jamais plus que BUFFER_SIZE
 * en vol simultanément.
 */
export function ensureLevelBuffer(config) {
  const signature = configSignature(config);
  if (bufferSignature !== signature) {
    bufferSignature = signature;
    bufferItems = [];
    bufferPending = 0;
  }
  const missing = BUFFER_SIZE - bufferItems.length - bufferPending;
  for (let i = 0; i < missing; i++) {
    bufferPending++;
    enqueuePoolJob(config, "low")
      .then((result) => {
        bufferPending--;
        // La config a pu changer pendant cette génération (plusieurs
        // secondes en 2★/3★) : un résultat pour une config PÉRIMÉE est
        // silencieusement jeté plutôt que stocké dans le buffer actuel.
        if (result && configSignature(config) === bufferSignature) bufferItems.push(result);
      })
      .catch(() => {
        bufferPending--;
      });
  }
}

/**
 * Sert un niveau déjà prêt pour la config donnée SANS attendre — retourne
 * `null` si le buffer est vide ou périmé (config différente), auquel cas
 * l'appelant doit retomber sur `requestLevel` classique (avec écran de
 * chargement). Relance immédiatement un remplissage pour remplacer le
 * niveau consommé.
 */
export function takeBufferedLevel(config) {
  const signature = configSignature(config);
  if (bufferSignature !== signature || bufferItems.length === 0) return null;
  const level = bufferItems.shift();
  ensureLevelBuffer(config);
  return level;
}
