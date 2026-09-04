// Test de régression pour le durcissement du Défi Quotidien (retour
// utilisateur: "difficulté particulièrement forte (plus que trois étoiles)"
// + "augmenter la taille considérablement") — voir generator.js:
// DAILY_CHALLENGE_SIZE_BOOST / DAILY_CHALLENGE_MIN_BRANCH_COUNT.
//
// Reproduit le budget RÉEL d'un Worker du pool (voir infiniteClient.js:
// generateOnce — chaque Worker reçoit `Math.ceil(totalAttempts /
// poolSize)` tentatives mais la PLEINE fenêtre de temps `maxTimeMs`) avec
// poolSize=4 (le maximum, voir POOL_SIZE), donc perWorkerAttempts=15 —
// c'est la configuration la PLUS défavorable pour converger vite (une
// machine avec moins de coeurs donnerait MOINS de Workers mais PLUS de
// tentatives chacun, donc au moins autant de chances par Worker).
import { generateLevel, DAILY_CHALLENGE_SIZE_BOOST, DAILY_CHALLENGE_MIN_BRANCH_COUNT } from "../src/game/generator.js";
import { LightUpGrid } from "../src/game/grid.js";
import { analyzeAndCount } from "../src/game/solver.js";

const PER_WORKER_ATTEMPTS = Math.ceil(60 / 4);
const MAX_TIME_MS = 45_000;

let failures = 0;
let belowMin = 0;
const branchCounts = [];
const cellCounts = [];
let totalMs = 0;

for (let i = 0; i < 15; i++) {
  const seed = 500000 + i * 97;
  const best = generateLevel({
    difficulty: 3,
    enabledFeatureKeys: ["forbidden", "color"],
    seed,
    maxAttempts: PER_WORKER_ATTEMPTS,
    maxTimeMs: MAX_TIME_MS,
    sizeBoost: DAILY_CHALLENGE_SIZE_BOOST,
    minBranchCount: DAILY_CHALLENGE_MIN_BRANCH_COUNT,
  });

  if (!best) {
    console.error(`[seed=${seed}] generateLevel a retourné null`);
    failures++;
    continue;
  }

  totalMs += best.timeMs;
  cellCounts.push(best.level.rows * best.level.cols);
  branchCounts.push(best.branchCount ?? 0);
  if ((best.branchCount ?? 0) < DAILY_CHALLENGE_MIN_BRANCH_COUNT) belowMin++;

  // Unicité indépendante (comme test-prism.mjs) — budget bien plus large
  // que pour les autres scripts de régression (300k suffisait aux plateaux
  // 3★ normaux, ~96-150 cases) : à cette taille (jusqu'à ~216 cases) et
  // avec DAILY_CHALLENGE_MIN_BRANCH_COUNT poussant le branchCount parfois
  // au-delà de 300k rien que pour la preuve d'unicité elle-même (voir
  // scripts/test-daily-hint-perf.mjs pour la distinction avec le coût,
  // bien moindre, de trouver UNE seule solution), un budget trop bas ferait
  // remonter un faux échec ("non exhaustif") sans rapport avec une vraie
  // régression du générateur (vérifié manuellement sur le seed qui
  // déclenchait ce faux positif à 300k : confirmé unique dès 1M).
  const verify = analyzeAndCount(best.level, 2, 3_000_000);
  let ok = true;
  if (!verify || !verify.exhausted || verify.count !== 1) {
    console.error(`[seed=${seed}] unicité non confirmée: count=${verify?.count}, exhausted=${verify?.exhausted}`);
    ok = false;
  }

  // Gagnabilité (rejoue best.solution via toggleLight, comme les autres
  // scripts de régression du générateur).
  const replay = new LightUpGrid(best.level);
  const remaining = new Set(best.solution.map(([r, c]) => `${r},${c}`));
  let guard = 0;
  while (remaining.size > 0 && guard++ < 400) {
    let progressed = false;
    for (const key of Array.from(remaining)) {
      const [r, c] = key.split(",").map(Number);
      if (replay.hasLight(r, c)) {
        remaining.delete(key);
        progressed = true;
        continue;
      }
      if (replay.toggleLight(r, c) === "placed") {
        remaining.delete(key);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  const won = replay.isWon();
  if (!won) {
    console.error(`[seed=${seed}] niveau NON gagnable (won=${won})`);
    ok = false;
  }

  if (ok) {
    console.log(
      `[seed=${seed}] OK — ${best.level.rows}x${best.level.cols} (${best.level.rows * best.level.cols} cases), mesuré=${best.measuredTier}★, branchCount=${best.branchCount}, attempts=${best.attemptsUsed}, ${best.timeMs}ms`
    );
  } else {
    failures++;
  }
}

branchCounts.sort((a, b) => a - b);
console.log(
  `\nTotal: ${branchCounts.length + failures} générations, ${failures} échec(s), ${belowMin} sous le plancher ${DAILY_CHALLENGE_MIN_BRANCH_COUNT}.`
);
console.log(
  `branchCount: min=${branchCounts[0]}, médiane=${branchCounts[Math.floor(branchCounts.length / 2)]}, max=${branchCounts[branchCounts.length - 1]}`
);
console.log(`cases: min=${Math.min(...cellCounts)}, max=${Math.max(...cellCounts)}`);
console.log(`temps total=${totalMs}ms, moyenne=${Math.round(totalMs / (branchCounts.length || 1))}ms`);
process.exit(failures > 0 ? 1 : 0);
