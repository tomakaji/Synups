// Vérifie que `findSolution` (utilisé par le bouton Indice EN JEU, voir
// main.js: findNextHintCell) reste rapide même sur les plateaux du Défi
// Quotidien durci (voir DAILY_CHALLENGE_MIN_BRANCH_COUNT) — ce chiffre
// mesure le coût de la preuve D'UNICITÉ (recherche exhaustive, voir
// generator.js: finalVerify/analyzeAndCount), pas le coût de trouver UNE
// SEULE solution (ce que fait réellement `findSolution`, sans exploration
// des alternatives) : les deux ne sont pas nécessairement corrélés sur de
// grands plateaux, d'où cette vérification séparée.
import { generateLevel, DAILY_CHALLENGE_SIZE_BOOST, DAILY_CHALLENGE_MIN_BRANCH_COUNT } from "../src/game/generator.js";
import { findSolution } from "../src/game/solver.js";

for (let i = 0; i < 8; i++) {
  const seed = 800000 + i * 211;
  const best = generateLevel({
    difficulty: 3,
    enabledFeatureKeys: ["forbidden", "color"],
    seed,
    maxAttempts: 15,
    maxTimeMs: 45000,
    sizeBoost: DAILY_CHALLENGE_SIZE_BOOST,
    minBranchCount: DAILY_CHALLENGE_MIN_BRANCH_COUNT,
  });
  if (!best) {
    console.log(`seed=${seed} -> NULL`);
    continue;
  }
  const t0 = Date.now();
  const sol = findSolution(best.level);
  const ms = Date.now() - t0;
  console.log(
    `seed=${seed} -> ${best.level.rows}x${best.level.cols}, branchCount(unicité)=${best.branchCount}, findSolution=${ms}ms, solLen=${sol?.length}`
  );
}
