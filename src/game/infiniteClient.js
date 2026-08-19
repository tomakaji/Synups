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
  entry.worker = new Worker(new URL("./generator.worker.js", import.meta.url), { type: "module" });
  entry.worker.onmessage = (event) => {
    const { type, requestId } = event.data || {};
    if (!entry.pending || requestId !== entry.pending.requestId) return; // réponse obsolète: ignorée
    const { resolve, reject } = entry.pending;
    entry.pending = null;
    if (type === "result") resolve(event.data.result);
    else if (type === "error") reject(new Error(event.data.message || "Erreur du générateur"));
  };
  entry.worker.onerror = (event) => {
    if (!entry.pending) return;
    const { reject } = entry.pending;
    entry.pending = null;
    reject(event.error || new Error(event.message || "Erreur du Worker de génération"));
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
 * Lance une génération répartie sur le pool de Workers et retourne une
 * Promise résolue avec le résultat de `generateLevel()` (voir generator.js),
 * ou `null` si même le fallback best-effort n'a rien trouvé nulle part.
 */
export function requestLevel({ difficulty, enabledFeatureKeys, seed, maxAttempts, maxTimeMs } = {}) {
  const tier = clampTier(difficulty);
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
    isPerfect: (r) => r.confirmedUnique && r.measuredTier === tier,
    isBetter: (best, candidate) => isBetterCandidate(best, candidate, tier),
  });
}
