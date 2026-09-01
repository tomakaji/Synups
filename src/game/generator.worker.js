// Mode Infini — Web Worker autour de generator.js (voir
// docs/infinite-mode-design.md, section 8) : la génération peut prendre
// jusqu'à quelques centaines de ms (plusieurs tentatives + vérifications
// d'unicité par backtracking), donc elle tourne ici plutôt que sur le
// thread principal, pour ne jamais geler l'interface.
//
// Protocole (simple requête/réponse, avec un `requestId` pour ignorer une
// réponse à une demande annulée/obsolète côté appelant) :
//   postMessage({ type: "generate", requestId, difficulty, enabledFeatureKeys, seed })
//   -> postMessage({ type: "result", requestId, result })
// `result` est exactement ce que retourne `generateLevel()` (voir
// generator.js) : `null` uniquement si même le fallback best-effort n'a
// trouvé aucune forme jouable (cas limite, ne devrait arriver que sur des
// réglages de difficulté/tailles très défavorables).

import { generateLevel } from "./generator.js";

self.onmessage = (event) => {
  const { type, requestId } = event.data || {};
  if (type !== "generate") return;

  let result = null;
  try {
    const { difficulty, enabledFeatureKeys, seed, maxAttempts, maxTimeMs, sizeBoost } = event.data;
    result = generateLevel({ difficulty, enabledFeatureKeys, seed, maxAttempts, maxTimeMs, sizeBoost });
  } catch (err) {
    self.postMessage({ type: "error", requestId, message: err?.message || String(err) });
    return;
  }
  self.postMessage({ type: "result", requestId, result });
};
