// Mode Infini [Phase 1 / MVP] — générateur de niveau à la volée.
//
// Voir docs/infinite-mode-design.md pour la conception complète. Ce fichier
// n'a AUCUNE dépendance au DOM : il tourne aussi bien dans un Web Worker
// (voir generator.worker.js) que dans un script Node (comme
// scripts/generate-unique-levels.mjs, dont il généralise directement le
// pipeline). Aucune règle de jeu n'est réimplémentée ici : on ne fait que
// construire un objet `{rows, cols, cells}` standard, entièrement vérifié
// via `LightUpGrid`/`solver.js` — le même moteur que n'importe quel niveau
// de `levels.js`.
//
// Portée de cette Phase 1 : formes (murs/void) + cases interdites (FORBIDDEN)
// + indices numériques (CLUE) dérivés d'une solution de référence. Pas de
// couleur ni de mécaniques spéciales (miroir/filtre/prisme/pyra/neurone
// miroir) — voir FEATURES ci-dessous, elles sont déjà répertoriées (poids,
// dépendances) mais marquées `implemented:false` tant que leur logique de
// placement (Phase B, section 4.2 du doc) n'est pas écrite.

import { LightUpGrid, CellType } from "./grid.js";
import { countSolutions, analyzeSolve } from "./solver.js";

const DIRECTIONS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Features sélectionnables dans l'UI (voir docs/infinite-mode-design.md,
 * section 5). `weight` sert au budget de complexité par palier (voir
 * DIFFICULTY_PRESETS) ; `requires` grise une feature tant que sa dépendance
 * n'est pas cochée ; `implemented:false` = déjà répertoriée pour l'UI et le
 * phasage futur, mais pas encore générée (voir le plan de phasage du doc).
 */
export const FEATURES = {
  forbidden: { label: "Cases interdites", weight: 1, implemented: true },
  color: { label: "Couleur (charges + cibles)", weight: 3, implemented: false },
  mirror: { label: "Miroir dévieur", weight: 2, implemented: false, requires: "color" },
  filter: { label: "Filtre", weight: 2, implemented: false, requires: "color" },
  prism: { label: "Prisme", weight: 3, implemented: false, requires: "color" },
  pyra: { label: "Pyra", weight: 3, implemented: false },
  mirrorNeuron: { label: "Neurone miroir [expérimental]", weight: 5, implemented: false },
};

/**
 * Plages de génération par palier (section 6 du doc). Point de départ
 * empirique — mesuré directement (voir docs/infinite-mode-design.md,
 * section 10) : contre-intuitivement, PLUS de murs/indices rend un plateau
 * PLUS facile pour ce solveur (chaque indice contraint ses voisins, Stage 1
 * peut trancher sans deviner), tandis qu'un plateau clairsemé laisse de
 * grandes zones ouvertes non couvertes par un indice, qui n'ont d'autre
 * choix que d'être tranchées par du branchement pur — d'où une densité de
 * murs qui DÉCROÎT avec la difficulté demandée, à l'inverse de l'intuition
 * "plus de murs = plus dur". Toujours pas une loi figée : à réajuster une
 * fois qu'on observe le taux réel de candidats parfaits par palier.
 */
const DIFFICULTY_PRESETS = {
  1: { sizeRange: [5, 6], wallDensity: [0.4, 0.48], cornerVoidRange: [0, 0], budget: 3, nodeBudget: 200_000 },
  2: { sizeRange: [6, 7], wallDensity: [0.28, 0.36], cornerVoidRange: [0, 1], budget: 6, nodeBudget: 400_000 },
  3: { sizeRange: [7, 9], wallDensity: [0.16, 0.24], cornerVoidRange: [0, 2], budget: 10, nodeBudget: 800_000 },
};

// Budget global d'une génération (Phase F du doc) : le premier des deux
// atteint arrête la boucle et on sert le meilleur candidat rencontré.
const DEFAULT_MAX_ATTEMPTS = 40;
const DEFAULT_MAX_TIME_MS = 3000;

function pickInt(rand, [lo, hi]) {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function pickFloat(rand, [lo, hi]) {
  return lo + rand() * (hi - lo);
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pioche un sous-ensemble des features cochées ET implémentées, respectant
 * leurs dépendances et un budget de poids — voir section 5 du doc : "tout
 * coché" autorise, ça ne force pas la présence de tout à chaque génération
 * (probabilité d'inclusion < 1 même quand le budget le permettrait).
 */
function pickFeatureSubset(rand, enabledKeys, budget) {
  const enabled = new Set(enabledKeys);
  const candidates = Object.keys(FEATURES).filter((k) => {
    const f = FEATURES[k];
    if (!f.implemented) return false;
    if (!enabled.has(k)) return false;
    if (f.requires && !enabled.has(f.requires)) return false;
    return true;
  });
  shuffle(candidates, rand);

  const chosen = [];
  let remaining = budget;
  for (const k of candidates) {
    const w = FEATURES[k].weight;
    if (w > remaining) continue;
    if (rand() < 0.6) {
      chosen.push(k);
      remaining -= w;
    }
  }
  return chosen;
}

/** Forme de grille (murs "#"/void "X" aléatoires mais reproductibles). */
function buildLayout({ rows, cols, wallDensity, cornerVoid, rand }) {
  const rowsOut = [];
  for (let r = 0; r < rows; r++) {
    let row = "";
    for (let c = 0; c < cols; c++) {
      const inCorner =
        cornerVoid > 0 && (r < cornerVoid || r >= rows - cornerVoid) && (c < cornerVoid || c >= cols - cornerVoid);
      row += inCorner ? "X" : rand() < wallDensity ? "#" : ".";
    }
    rowsOut.push(row);
  }
  return rowsOut;
}

/** Remplissage glouton : garantit une solution complète et valide pour la
 * forme donnée (une lumière dès qu'une case n'est pas déjà illuminée). */
function greedySolve(cells, rows, cols) {
  const grid = new LightUpGrid({ rows, cols, cells });
  const lights = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid.cellAt(r, c);
      if (cell.type === CellType.EMPTY && !cell._illuminated) {
        const res = grid.toggleLight(r, c);
        if (res === "placed") lights.push([r, c]);
      }
    }
  }
  return { grid, lights };
}

/**
 * Transforme les murs "#" en indices dérivés de la solution de référence
 * (le compte RÉEL de lumières adjacentes dans `grid`, jamais deviné) — voir
 * Phase C du doc. Si `useForbidden`, un mur dont le compte réel est 0
 * devient une case FORBIDDEN ("0") plutôt qu'un indice numéroté "0" (les
 * deux sont équivalents pour la résolution, FORBIDDEN est juste l'habillage
 * dédié du jeu pour ce cas — voir grid.js).
 */
function wallsToClues(cells, grid, rows, cols, clueFraction, useForbidden, rand) {
  const out = cells.map((row) => row.split(""));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (out[r][c] !== "#") continue;
      if (rand() >= clueFraction) continue;
      let count = 0;
      for (const [dr, dc] of DIRECTIONS) {
        const nCell = grid.cellAt(r + dr, c + dc);
        if (nCell && nCell.type === CellType.EMPTY && grid.hasLight(r + dr, c + dc)) count++;
      }
      out[r][c] = useForbidden && count === 0 ? "0" : String(count);
    }
  }
  return out.map((row) => row.join(""));
}

/** Une tentative de génération complète (Phases A-C), sans encore vérifier
 * l'unicité — voir `generateLevel` pour la boucle Phase D/E/F. */
function tryGenerate(seed, tier, enabledFeatureKeys) {
  const preset = DIFFICULTY_PRESETS[tier];
  const rand = seededRandom(seed);

  const rows = pickInt(rand, preset.sizeRange);
  const cols = pickInt(rand, preset.sizeRange);
  const wallDensity = pickFloat(rand, preset.wallDensity);
  const cornerVoid = pickInt(rand, preset.cornerVoidRange);

  const rawCells = buildLayout({ rows, cols, wallDensity, cornerVoid, rand });
  const { grid, lights } = greedySolve(rawCells, rows, cols);
  if (lights.length === 0) return null; // forme dégénérée (rien à éclairer), on retente ailleurs

  const featureSubset = pickFeatureSubset(rand, enabledFeatureKeys, preset.budget);
  const useForbidden = featureSubset.includes("forbidden");

  const finalCells = wallsToClues(rawCells, grid, rows, cols, 1, useForbidden, rand);
  return { rows, cols, cells: finalCells, referenceSolution: lights, featureSubset };
}

/**
 * Compare deux candidats déjà générés et retourne le meilleur selon l'ordre
 * de préférence de la Phase F (section 4/10 du doc) : solution unique avant
 * tout, puis palier de difficulté mesuré correct.
 */
function isBetterCandidate(a, b, requestedTier) {
  if (!a) return true;
  const aUnique = a.solutionCount === 1;
  const bUnique = b.solutionCount === 1;
  if (aUnique !== bUnique) return bUnique;
  const aTierOk = a.measuredTier === requestedTier;
  const bTierOk = b.measuredTier === requestedTier;
  if (aTierOk !== bTierOk) return bTierOk;
  return false; // équivalents sur les deux critères : on garde le premier trouvé
}

/**
 * Point d'entrée principal du mode Infini. `difficulty` ∈ {1,2,3},
 * `enabledFeatureKeys` = clés de FEATURES cochées dans l'UI (les features
 * non `implemented` sont silencieusement ignorées, prêt pour les phases
 * suivantes). Retourne toujours un niveau jouable (jamais 0 solution) avec
 * un rapport de difficulté honnête — voir Phase F du doc pour la politique
 * best-effort si aucun candidat parfait n'est trouvé dans le budget.
 */
export function generateLevel({
  difficulty = 1,
  enabledFeatureKeys = ["forbidden"],
  seed = Date.now() ^ (Math.random() * 0xffffffff),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  maxTimeMs = DEFAULT_MAX_TIME_MS,
} = {}) {
  const tier = [1, 2, 3].includes(difficulty) ? difficulty : 1;
  const preset = DIFFICULTY_PRESETS[tier];

  const start = Date.now();
  let best = null;
  let attempts = 0;

  while (attempts < maxAttempts && Date.now() - start < maxTimeMs) {
    attempts++;
    const candidateSeed = Math.floor(seed) + attempts * 7919; // grand premier: étale les seeds
    const raw = tryGenerate(candidateSeed, tier, enabledFeatureKeys);
    if (!raw) continue;

    const level = { name: "Infini", rows: raw.rows, cols: raw.cols, cells: raw.cells };
    const { count, exhausted } = countSolutions(level, 2, preset.nodeBudget);
    if (count === 0 && exhausted) continue; // vraiment 0 solution: jamais servi (Phase D)
    if (count === 0 && !exhausted) continue; // inconclusif SANS avoir vu de solution: pas assez fiable pour être un candidat

    // `count` est plafonné à 2 par countSolutions (juste assez pour distinguer
    // aucune/unique/plusieurs). L'unicité n'est confirmée QUE si le budget de
    // noeuds n'a PAS été dépassé avant de conclure (`exhausted`) — un
    // `count === 1` avec `!exhausted` veut juste dire "on n'a pas encore
    // trouvé de 2e solution", pas "il n'y en a pas" : on le traite comme
    // "plusieurs/incertain" par prudence plutôt que de mentir sur l'unicité.
    const confirmedUnique = exhausted && count === 1;

    let measuredTier = null;
    let solution = raw.referenceSolution;
    if (confirmedUnique) {
      const analysis = analyzeSolve(level, preset.nodeBudget);
      if (analysis) {
        measuredTier = analysis.tier;
        solution = analysis.solution;
      }
    }

    const candidate = {
      level,
      solution,
      solutionCount: confirmedUnique ? 1 : 2, // 2 = "plusieurs ou incertain", jamais présenté comme unique
      confirmedUnique,
      measuredTier,
      requestedTier: tier,
      featureSubset: raw.featureSubset,
      attempts,
    };

    if (confirmedUnique && measuredTier === tier) {
      best = candidate;
      break; // candidat parfait: inutile de continuer
    }
    if (isBetterCandidate(best, candidate, tier)) best = candidate;
  }

  if (!best) return null; // n'arrive que si même le fallback échoue à générer une forme jouable

  best.level.starThresholds = [best.solution.length, Math.ceil(best.solution.length * 1.5)];
  best.attemptsUsed = attempts;
  best.timeMs = Date.now() - start;
  return best;
}
