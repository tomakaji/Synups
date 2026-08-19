// Mode Infini — petit client qui possède le Web Worker de génération et
// expose une API à base de Promise à main.js, plutôt que de laisser
// main.js manipuler directement postMessage/onmessage. Voir
// generator.worker.js pour le protocole exact.

let worker = null;
let nextRequestId = 1;
let pending = null; // { requestId, resolve, reject } — une seule génération à la fois

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./generator.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const { type, requestId } = event.data || {};
    if (!pending || requestId !== pending.requestId) return; // réponse à une demande obsolète: ignorée
    const { resolve, reject } = pending;
    pending = null;
    if (type === "result") resolve(event.data.result);
    else if (type === "error") reject(new Error(event.data.message || "Erreur du générateur"));
  };
  worker.onerror = (event) => {
    if (!pending) return;
    const { reject } = pending;
    pending = null;
    reject(event.error || new Error(event.message || "Erreur du Worker de génération"));
  };
  return worker;
}

/**
 * Lance une génération et retourne une Promise résolue avec le résultat de
 * `generateLevel()` (voir generator.js), ou `null` si même le fallback
 * best-effort n'a rien trouvé. Si une génération précédente est encore en
 * vol, sa réponse sera silencieusement ignorée (seule la plus récente
 * compte) — évite une course si le joueur reclique vite sur "Générer".
 */
export function requestLevel({ difficulty, enabledFeatureKeys, seed, maxAttempts, maxTimeMs } = {}) {
  const w = ensureWorker();
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending = { requestId, resolve, reject };
    w.postMessage({
      type: "generate",
      requestId,
      difficulty,
      enabledFeatureKeys,
      seed: seed ?? Date.now() ^ Math.floor(Math.random() * 0xffffffff),
      maxAttempts,
      maxTimeMs,
    });
  });
}
