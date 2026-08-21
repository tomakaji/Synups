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

let pool = null; // Array<{ worker, pending, nextRequestId }>, créé au premier appel

function makeWorkerEntry() {
  const entry = { worker: null, pending: null, nextRequestId: 1 };
  // IMPORTANT: `new Worker(new URL(...), options)` doit rester un appel
  // inline en un seul statement — Vite détecte ce motif exact par analyse
  // statique pour émettre le worker comme un chunk séparé en build de
  // production. Extraire `new URL(...)` dans une variable intermédiaire
  // (comme fait ici temporairement pour logguer l'URL) casse cette
  // détection et fait basculer Vite sur un inlining base64 du script, qui
  // échoue silencieusement une fois déployé — c'est very probablement LA
  // cause du bug de génération en prod. Voir commentaire ci-dessous.
  console.log("[infiniteClient] création Worker (pool)");
  entry.worker = new Worker(new URL("./generator.worker.js", import.meta.url), { type: "module" });
  entry.worker.onmessage = (event) => {
    console.log("[infiniteClient] onmessage reçu du Worker", event.data);
    const { type, requestId } = event.data || {};
    if (!entry.pending || requestId !== entry.pending.requestId) return; // réponse obsolète: ignorée
    const { resolve, reject } = entry.pending;
    entry.pending = null;
    if (type === "result") resolve(event.data.result);
    else if (type === "error") reject(new Error(event.data.message || "Erreur du générateur"));
  };
  entry.worker.onerror = (event) => {
    console.log("[infiniteClient] onerror du Worker", event);
    if (!entry.pending) return;
    const { reject } = entry.pending;
    entry.pending = null;
    reject(event.error || new Error(event.message || "Erreur du Worker de génération"));
  };
  entry.worker.onmessageerror = (event) => {
    console.log("[infiniteClient] onmessageerror du Worker", event);
  };
  return entry;
}

function ensurePool() {
  if (pool) return pool;
  pool = Array.from({ length: POOL_SIZE }, makeWorkerEntry);
  return pool;
}

function runOnWorker(entry, payload) {
  const requestId = entry.nextRequestId++;
  return new Promise((resolve, reject) => {
    entry.pending = { requestId, resolve, reject };
    // TEMPORAIRE (debug déploiement) — à retirer une fois le problème identifié.
    console.log("[infiniteClient] postMessage vers Worker", requestId, payload);
    entry.worker.postMessage({ type: "generate", requestId, ...payload });
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
 * Lance UNE génération répartie sur TOUS les Workers du pool (chaque entrée
 * n'a qu'un seul emplacement `.pending` à la fois — voir runOnWorker/
 * makeWorkerEntry) et retourne une Promise résolue avec le résultat de
 * `generateLevel()` (voir generator.js), ou `null` si même le fallback
 * best-effort n'a rien trouvé nulle part. NE DOIT JAMAIS être appelée une
 * deuxième fois avant que la précédente se soit terminée (voir la file
 * d'attente `enqueuePoolJob` plus bas, qui garantit ça) : deux appels
 * chevauchants écraseraient le `.pending` de chaque Worker, orphelinant
 * silencieusement les Promises du premier appel (jamais résolues).
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
