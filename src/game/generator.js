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
import { analyzeAndCount } from "./solver.js";

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
 *
 * Recalibrage (retour utilisateur : l'ancien "difficile" jouait comme un
 * "intermédiaire", et la taille de grille seule ne suffit pas à faire un
 * niveau dur — il faut de vrais "lieux de doute", pas juste du remplissage).
 * Chaque palier est décalé d'un cran vers le bas par rapport à la première
 * version, et le nouveau tier 3 vise un régime où `analyzeSolve` mesure
 * quasi-systématiquement du Stage 2 (déduction croisée entre deux indices,
 * pas seulement du Stage 1 case-par-case) — voir solver.js. On plafonne à
 * 9×9 : un sweep empirique a montré des pics de latence jusqu'à ~50s sur des
 * grilles 10×10 clairsemées, largement au-delà du budget de génération.
 */
const DIFFICULTY_PRESETS = {
  1: { sizeRange: [6, 7], wallDensity: [0.28, 0.36], cornerVoidRange: [0, 1], budget: 6, nodeBudget: 400_000 },
  2: { sizeRange: [7, 8], wallDensity: [0.2, 0.28], cornerVoidRange: [0, 2], budget: 8, nodeBudget: 600_000 },
  3: { sizeRange: [8, 9], wallDensity: [0.14, 0.2], cornerVoidRange: [0, 2], budget: 12, nodeBudget: 500_000 },
};

// Budget global d'une génération (Phase F du doc) : le premier des deux
// atteint arrête la boucle et on sert le meilleur candidat rencontré. Le
// budget temps est délibérément plus généreux sur les paliers élevés : une
// seule tentative tier 3 (countSolutions + analyzeSolve à densité faible)
// peut déjà coûter 1-2s, donc un budget uniforme de 3s ne laissait quasiment
// aucune marge pour départager plusieurs candidats et converger vers un
// vrai "lieu de doute" (voir isBetterCandidate). Tourne dans le Worker, donc
// ne bloque jamais l'UI même quand ça dure quelques secondes de plus.
// Validé empiriquement (25-30 tirages/palier via generateLevel réel) : ~100%
// de candidats parfaits (solution unique + palier mesuré == demandé) en
// 1★/2★, ~60-70% en 3★ (le reste retombe honnêtement en 2★, jamais 0
// solution ni mal étiqueté) ; temps d'attente 3★ : ~2.5-3.5s en moyenne,
// jusqu'à ~11s dans le pire cas observé.
const DEFAULT_MAX_ATTEMPTS_BY_TIER = { 1: 40, 2: 40, 3: 100 };
const DEFAULT_MAX_TIME_MS_BY_TIER = { 1: 2000, 2: 3000, 3: 10000 };

/** Ramène une difficulté quelconque au palier valide le plus proche (1 par défaut). */
export function clampTier(difficulty) {
  return [1, 2, 3].includes(difficulty) ? difficulty : 1;
}

/**
 * Budget de génération par défaut pour un palier (voir commentaire
 * ci-dessus) — exporté pour que `infiniteClient.js` puisse répartir ce même
 * budget total entre plusieurs Workers en parallèle (voir section 8 du doc)
 * sans dupliquer ces chiffres.
 */
export function getGenerationBudget(tier) {
  return {
    maxAttempts: DEFAULT_MAX_ATTEMPTS_BY_TIER[tier],
    maxTimeMs: DEFAULT_MAX_TIME_MS_BY_TIER[tier],
  };
}

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
 * tout, puis palier de difficulté mesuré aussi proche que possible du palier
 * demandé, puis (à palier égal, imparfait) un `branchCount` qui pousse dans
 * la direction demandée — sans ce dernier critère, la boucle gardait le
 * premier candidat unique trouvé même s'il était nettement plus facile qu'un
 * autre vu plus tard dans le même budget (observé empiriquement : le tier 3
 * "ratait" sa cible dans ~40% des tirages faute de départager entre
 * candidats tier 2 de justesse et tier 2 très proche du seuil tier 3).
 */
export function isBetterCandidate(a, b, requestedTier) {
  if (!a) return true;
  const aUnique = a.solutionCount === 1;
  const bUnique = b.solutionCount === 1;
  if (aUnique !== bUnique) return bUnique;

  const aDist = a.measuredTier == null ? Infinity : Math.abs(a.measuredTier - requestedTier);
  const bDist = b.measuredTier == null ? Infinity : Math.abs(b.measuredTier - requestedTier);
  if (aDist !== bDist) return bDist < aDist;

  // Même distance au palier demandé (et donc, la plupart du temps, même
  // measuredTier) : on préfère le candidat dont le branchCount va dans le
  // sens du palier demandé — plus dur si on visait plus dur qu'obtenu, plus
  // facile si on visait plus facile qu'obtenu.
  if (a.measuredTier != null && b.measuredTier != null && a.measuredTier === b.measuredTier) {
    const aBranch = a.branchCount ?? 0;
    const bBranch = b.branchCount ?? 0;
    if (a.measuredTier < requestedTier) return bBranch > aBranch;
    if (a.measuredTier > requestedTier) return bBranch < aBranch;
  }
  return false; // équivalents sur tous les critères : on garde le premier trouvé
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
  maxAttempts,
  maxTimeMs,
} = {}) {
  const tier = clampTier(difficulty);
  const preset = DIFFICULTY_PRESETS[tier];
  const defaultBudget = getGenerationBudget(tier);
  const timeBudgetMs = maxTimeMs ?? defaultBudget.maxTimeMs;
  const attemptsBudget = maxAttempts ?? defaultBudget.maxAttempts;

  const start = Date.now();
  let best = null;
  let attempts = 0;

  while (attempts < attemptsBudget && Date.now() - start < timeBudgetMs) {
    attempts++;
    const candidateSeed = Math.floor(seed) + attempts * 7919; // grand premier: étale les seeds
    const raw = tryGenerate(candidateSeed, tier, enabledFeatureKeys);
    if (!raw) continue;

    const level = { name: "Infini", rows: raw.rows, cols: raw.cols, cells: raw.cells };
    // Un seul arbre de recherche pour prouver l'unicité ET mesurer la
    // difficulté (au lieu de countSolutions + analyzeSolve séparés, qui
    // relançaient deux fois la même résolution) — voir solver.js,
    // analyzeAndCount. Résultat numériquement identique, ~2x plus rapide
    // sur les candidats acceptés.
    const { count, exhausted, tier: measuredTierRaw, branchCount: branchCountRaw, solution: analyzedSolution } =
      analyzeAndCount(level, 2, preset.nodeBudget);
    if (count === 0 && exhausted) continue; // vraiment 0 solution: jamais servi (Phase D)
    if (count === 0 && !exhausted) continue; // inconclusif SANS avoir vu de solution: pas assez fiable pour être un candidat

    // `count` est plafonné à 2 (juste assez pour distinguer aucune/unique/
    // plusieurs). L'unicité n'est confirmée QUE si le budget de noeuds n'a
    // PAS été dépassé avant de conclure (`exhausted`) — un `count === 1`
    // avec `!exhausted` veut juste dire "on n'a pas encore trouvé de 2e
    // solution", pas "il n'y en a pas" : on le traite comme
    // "plusieurs/incertain" par prudence plutôt que de mentir sur l'unicité.
    const confirmedUnique = exhausted && count === 1;

    const measuredTier = confirmedUnique ? measuredTierRaw : null;
    const branchCount = confirmedUnique ? branchCountRaw : null;
    const solution = confirmedUnique && analyzedSolution ? analyzedSolution : raw.referenceSolution;

    const candidate = {
      level,
      solution,
      solutionCount: confirmedUnique ? 1 : 2, // 2 = "plusieurs ou incertain", jamais présenté comme unique
      confirmedUnique,
      measuredTier,
      branchCount,
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
