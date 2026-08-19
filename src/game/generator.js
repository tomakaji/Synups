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
//
// -- Stratégie de génération (v2, "réparation ciblée" au lieu de "générer et
// prier") --------------------------------------------------------------
// La v1 tirait une forme ENTIÈREMENT aléatoire à une densité choisie pour le
// palier demandé, puis vérifiait l'unicité depuis zéro ; en cas d'échec, tout
// l'essai était jeté et un tout nouveau seed aléatoire était tiré. Comme
// Akari est NP-complet, aucune construction ne peut garantir l'unicité à
// 100% sans jamais vérifier — mais on peut être BEAUCOUP plus malin que "tout
// jeter et re-tirer au hasard" (recherche : générateur Akari dédié
// github.com/Borroot/akari, issu d'une thèse sur Akari — voir
// docs/infinite-mode-design.md §10 pour les détails et sources).
//
// Le nouveau pipeline part d'un plateau DENSE (donc rapide à résoudre et
// très probablement déjà unique, cf. le lien densité/facilité déjà mesuré
// empiriquement), puis:
//   1. RÉPARATION (repairToUnique) : si le plateau dense n'est PAS unique du
//      premier coup, on ne regénère PAS tout au hasard — on calcule la
//      différence entre les deux solutions trouvées (les cases où elles
//      divergent) et on ajoute un mur PRÉCISÉMENT là, ce qui casse
//      l'ambiguïté de façon ciblée plutôt qu'en espérant qu'un tirage
//      complètement neuf y arrive par chance.
//   2. MINIMISATION VERS LE PALIER CIBLE (stripToTargetTier) : une fois
//      unique, on retire des indices un par un (dans un ordre aléatoire), en
//      ne gardant chaque retrait QUE s'il préserve l'unicité — ce qui ne
//      peut QUE maintenir ou augmenter la difficulté mesurée (retirer une
//      contrainte ne peut jamais rendre un puzzle plus facile), jamais la
//      diminuer. On s'arrête dès que le palier mesuré atteint le palier
//      demandé, au lieu d'espérer qu'une densité aléatoire y tombe pile.
// Résultat : un plateau accepté est TOUJOURS unique par construction (chaque
// retrait est vérifié avant d'être gardé) — la boucle de secours à plusieurs
// tentatives (`generateLevel`, avec pool de Workers) reste en place pour les
// cas dégénérés (réparation qui ne converge pas), mais elle devrait être
// rarement sollicitée.

import { LightUpGrid, CellType } from "./grid.js";
import { analyzeAndCount, enumerateSolutions } from "./solver.js";

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
 * Palier SOLVEUR (voir `computeTier` dans solver.js, 1 à 4) visé par chaque
 * étoile affichée à l'écran (1 à 3). PAS une correspondance 1:1: un second
 * retour utilisateur a demandé un nouveau décalage ("l'intermédiaire actuel
 * devient le facile, le difficile actuel devient l'intermédiaire, et on
 * ajoute un difficile encore plus dur") — donc 1★ vise maintenant l'ancien
 * palier solveur "intermédiaire" (2), 2★ vise l'ancien "difficile" (3), et
 * 3★ vise un TOUT NOUVEAU palier solveur (4), plus dur que tout ce qui
 * existait avant. Le palier solveur 1 (Stage 1 seul, quasi trivial) n'est
 * plus jamais visé par aucune étoile — voir `DIFFICULTY_PRESETS` ci-dessous,
 * dont les clés 1/2/3 réfèrent aux ÉTOILES, pas aux paliers solveur.
 */
const SOLVER_TIER_FOR_STARS = { 1: 2, 2: 3, 3: 4 };

/**
 * Plages de génération par étoile (clés = étoiles affichées, PAS paliers
 * solveur — voir `SOLVER_TIER_FOR_STARS`). Contrairement à la v1, la densité
 * de départ n'est plus le levier principal de difficulté (`stripToTargetTier`
 * s'en charge) — elle est choisie DENSE pour tous les paliers, juste assez
 * pour que la réparation converge vite (plateau dense = rapide à résoudre,
 * cf. lien densité/facilité déjà mesuré empiriquement). La taille de grille
 * reste corrélée à l'étoile : plus de cellules = plus de marge pour retirer
 * des indices et atteindre un palier réellement difficile. Plafonné à 9×9
 * (voir plus bas, latence solveur) — y compris pour 3★/palier solveur 4 : un
 * sweep empirique a montré que la difficulté supplémentaire s'obtient très
 * bien par une minimisation plus poussée sur la MÊME taille, pas besoin
 * d'agrandir encore la grille (et donc pas besoin de rouvrir le risque de
 * latence ~50s mesuré sur du 10×10 clairsemé).
 *
 * `cornerVoidRange` (variété de silhouette, coins coupés) est resté modeste :
 * `resolveAndDeriveClues`/`stripToTargetTier` transforment les cases sans
 * contrainte en VOID plutôt qu'en WALL (voir plus bas), donc la minimisation
 * ajoute déjà naturellement pas mal de VOID au plateau — cumuler ça avec un
 * cornerVoid généreux donnerait une proportion de cases mortes trop élevée.
 */
const DIFFICULTY_PRESETS = {
  1: {
    sizeRange: [7, 8],
    initialClueDensity: [0.34, 0.42],
    cornerVoidRange: [0, 1],
    budget: 8,
    nodeBudget: 300_000,
    repairNodeBudget: 120_000,
  },
  2: {
    sizeRange: [8, 9],
    initialClueDensity: [0.32, 0.4],
    cornerVoidRange: [0, 1],
    budget: 12,
    nodeBudget: 450_000,
    repairNodeBudget: 150_000,
  },
  3: {
    sizeRange: [8, 9],
    initialClueDensity: [0.32, 0.4],
    cornerVoidRange: [0, 1],
    budget: 12,
    nodeBudget: 700_000,
    repairNodeBudget: 150_000,
  },
};

// Nombre maximum d'itérations de réparation ciblée avant d'abandonner cet
// essai (retour à `generateLevel`, qui retente avec un nouveau seed) — voir
// repairToUnique. Un plateau qui part dense converge presque toujours en 0-3
// itérations en pratique ; 15 est une marge large pour les cas malchanceux
// sans risquer de s'éterniser sur une forme fondamentalement dégénérée.
const MAX_REPAIR_ITERATIONS = 15;

// Budget global d'une génération (Phase F du doc), CLÉS = ÉTOILES affichées
// (voir SOLVER_TIER_FOR_STARS) : le premier des deux atteint arrête la
// boucle et on sert le meilleur candidat rencontré. Cette boucle est un
// FILET DE SÉCURITÉ (réparation qui ne converge pas, forme dégénérée, ou —
// pour 3★/palier solveur 4 — un plateau dont le "plafond" naturel de
// difficulté est trop bas pour cette forme précise, voir stripToTargetTier)
// plutôt que le mécanisme principal de recherche d'un candidat correct.
// 3★ reçoit un budget nettement plus généreux que les autres : atteindre le
// palier solveur 4 demande souvent d'épuiser presque tous les indices
// retirables d'un plateau, ce qui n'est pas toujours possible sur un seul
// essai (mesuré empiriquement : ~30% de réussite par essai isolé) — c'est
// la boucle de tentatives multiples (+ le pool de Workers, voir
// infiniteClient.js) qui compense.
const DEFAULT_MAX_ATTEMPTS_BY_TIER = { 1: 15, 2: 20, 3: 40 };
const DEFAULT_MAX_TIME_MS_BY_TIER = { 1: 1500, 2: 2500, 3: 9000 };

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

/** Convertit un palier SOLVEUR (1-4, voir solver.js/computeTier) en étoiles
 * affichées (1-3) — inverse de `SOLVER_TIER_FOR_STARS`. Le palier solveur 1
 * (quasi trivial) n'est visé par aucune étoile mais peut apparaître comme
 * résultat best-effort (réparation qui n'a pas eu la marge de durcir le
 * plateau) — dans ce cas il s'affiche comme 1★, au même titre qu'un palier
 * solveur 2 (la cible réelle du 1★) : les deux sont "aussi facile que
 * possible d'afficher". */
function starsForSolverTier(solverTier) {
  if (solverTier == null) return null;
  return Math.max(1, solverTier - 1);
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

/**
 * Représentation de travail d'un plateau en cours de génération: tableau 2D
 * de tokens à un caractère — 'X' (void, hors-grille), '.' (case vide) ou un
 * obstacle plein qui sera (re)dérivé depuis une solution fraîche à chaque
 * appel de `resolveAndDeriveClues` : 'W' (mur sans contrainte, pas encore
 * dérivé OU volontairement dépouillé de son indice — voir stripToTargetTier),
 * '0' (case interdite) ou un chiffre '1'-'4' (indice numéroté). Converti en
 * chaînes de lignes uniquement pour appeler grid.js/solver.js.
 */
function buildInitialLayout({ rows, cols, clueDensity, cornerVoid, rand }) {
  const layout = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const inCorner =
        cornerVoid > 0 && (r < cornerVoid || r >= rows - cornerVoid) && (c < cornerVoid || c >= cols - cornerVoid);
      row.push(inCorner ? "X" : rand() < clueDensity ? "W" : ".");
    }
    layout.push(row);
  }
  return layout;
}

function layoutToRows(layout) {
  return layout.map((row) => row.join(""));
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
 * Résout la forme actuelle (tout ce qui n'est ni VOID ni EMPTY est opaque,
 * peu importe son ancien indice) pour obtenir une solution de référence
 * FRAÎCHE, puis redérive EN PLACE le nombre de CHAQUE case pleine à partir du
 * compte RÉEL de lumières adjacentes dans cette solution — jamais deviné.
 * `useForbidden` distingue une case dont le compte réel est 0 : case
 * interdite ("0", un vrai indice "0 lumière adjacente") si activé, sinon
 * VOID ("X") — c'est ce qui donne enfin un effet réel à la feature "Cases
 * interdites" (dans la v1, les deux chemins produisaient accidentellement
 * le même token, donc la case à cocher n'avait aucun effet observable).
 * VOID plutôt que WALL délibérément: tant qu'aucune mécanique laser n'est
 * générée (couleur/miroir/filtre/prisme — Phase 2+), WALL et VOID sont
 * mécaniquement identiques (tous deux opaques à la lumière blanche), donc
 * autant garder WALL réservé à son futur rôle utile (bloquer/induire en
 * erreur un laser) plutôt que de l'utiliser ici comme un void déguisé.
 * Retourne la solution utilisée, ou `null` si la forme est dégénérée (rien
 * à éclairer).
 */
function resolveAndDeriveClues(layout, rows, cols, useForbidden) {
  const { grid, lights } = greedySolve(layoutToRows(layout), rows, cols);
  if (lights.length === 0) return null;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const token = layout[r][c];
      if (token === "X" || token === ".") continue;
      let count = 0;
      for (const [dr, dc] of DIRECTIONS) {
        const nCell = grid.cellAt(r + dr, c + dc);
        if (nCell && nCell.type === CellType.EMPTY && grid.hasLight(r + dr, c + dc)) count++;
      }
      layout[r][c] = count === 0 ? (useForbidden ? "0" : "X") : String(count);
    }
  }
  return lights;
}

function randomEmptyCell(layout, rows, cols, rand) {
  const empties = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) if (layout[r][c] === ".") empties.push([r, c]);
  if (empties.length === 0) return null;
  return empties[Math.floor(rand() * empties.length)];
}

/** Cases où deux solutions divergent (l'une allumée, l'autre non) — c'est
 * précisément là qu'ajouter une contrainte a le plus de chances de casser
 * l'ambiguïté (voir commentaire d'en-tête, recherche Borroot/akari). */
function symmetricDifferenceCells(solutionA, solutionB) {
  const setA = new Set(solutionA.map(([r, c]) => `${r},${c}`));
  const setB = new Set(solutionB.map(([r, c]) => `${r},${c}`));
  const diff = [];
  for (const k of setA) if (!setB.has(k)) diff.push(k);
  for (const k of setB) if (!setA.has(k)) diff.push(k);
  return diff.map((k) => k.split(",").map(Number));
}

/**
 * Phase de réparation ciblée (voir commentaire d'en-tête) : dérive un
 * plateau plein dense, puis tant qu'il n'est pas confirmé unique, ajoute un
 * mur précisément là où les solutions trouvées divergent (ou, à défaut de
 * deux solutions distinctes — budget épuisé avant d'en trouver une 2e — une
 * case vide au hasard, ce qui reste une amélioration prudente : plus de
 * contraintes tend vers plus d'unicité). Modifie `layout` EN PLACE.
 * `deadline` est un timestamp absolu (Date.now()-comparable) partagé avec
 * `generateLevel`/`stripToTargetTier` — dépassé, cet essai abandonne
 * proprement au lieu de continuer (garde-fou wall-clock: `nodeBudget` ne
 * borne que CHAQUE appel solveur individuellement, pas leur somme cumulée
 * sur toute la boucle). Retourne `true` si un état confirmé unique a été
 * atteint, `false` sinon (forme dégénérée, réparation non convergée, ou
 * deadline dépassée).
 */
function repairToUnique(layout, rows, cols, useForbidden, rand, repairNodeBudget, deadline) {
  if (!resolveAndDeriveClues(layout, rows, cols, useForbidden)) return false;

  for (let iter = 0; iter < MAX_REPAIR_ITERATIONS; iter++) {
    if (Date.now() > deadline) return false; // budget de temps global dépassé: cet essai abandonne
    const level = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
    const { solutions, exhausted } = enumerateSolutions(level, 2, repairNodeBudget);

    if (exhausted && solutions.length === 1) return true; // confirmé unique
    if (solutions.length === 0) return false; // garde-fou défensif: ne devrait jamais arriver

    let target = null;
    if (solutions.length >= 2) {
      const diffCells = symmetricDifferenceCells(solutions[0], solutions[1]);
      if (diffCells.length > 0) target = diffCells[Math.floor(rand() * diffCells.length)];
    }
    if (!target) target = randomEmptyCell(layout, rows, cols, rand);
    if (!target) return false; // plus aucune case vide disponible: abandon

    layout[target[0]][target[1]] = "W";
    if (!resolveAndDeriveClues(layout, rows, cols, useForbidden)) return false;
  }
  return false; // budget de réparation épuisé sans converger
}

/**
 * Phase de minimisation (voir commentaire d'en-tête) : retire des indices un
 * par un (ordre aléatoire, chaque retrait devient un VOID neutre — voir
 * resolveAndDeriveClues), ne gardant chaque retrait QUE s'il préserve
 * l'unicité ET que le palier mesuré ne dépasse pas le palier demandé.
 * S'arrête dès que le palier demandé est atteint OU que `deadline` (même
 * timestamp partagé qu'ailleurs, voir `repairToUnique`) est dépassée — sans
 * ce garde-fou, un plateau qui approche du palier 3 peut enchaîner des
 * dizaines d'appels solveur de plus en plus coûteux (mesuré : jusqu'à ~30s
 * cumulés sur un essai malchanceux) alors que chaque appel individuel
 * respecte pourtant son propre `nodeBudget`. `layout` doit déjà être
 * confirmé unique (post-`repairToUnique`) — modifié EN PLACE. Retourne le
 * dernier résultat `analyzeAndCount` valide (toujours confirmé unique), ou
 * `null` seulement si l'état de départ n'était déjà pas mesurable (ne
 * devrait pas arriver après `repairToUnique`, garde-fou défensif).
 */
function stripToTargetTier(layout, rows, cols, targetTier, nodeBudget, rand, deadline) {
  const startLevel = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
  let best = analyzeAndCount(startLevel, 2, nodeBudget);
  if (!best || best.tier == null) return null;
  if (best.tier >= targetTier) return best;

  const candidates = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const t = layout[r][c];
      if (t !== "X" && t !== "." && t !== "W") candidates.push([r, c]); // indice (1-4) ou interdite ("0")
    }
  shuffle(candidates, rand);

  for (const [r, c] of candidates) {
    if (Date.now() > deadline) break; // budget de temps global dépassé: on sert le meilleur trouvé jusqu'ici
    const prevToken = layout[r][c];
    layout[r][c] = "X"; // retrait tentatif: VOID (voir resolveAndDeriveClues, WALL réservé aux lasers)
    const level = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
    const result = analyzeAndCount(level, 2, nodeBudget);
    const stillUnique = result.exhausted && result.count === 1;

    if (stillUnique && result.tier != null && result.tier <= targetTier) {
      best = result;
      if (result.tier === targetTier) break; // cible atteinte: inutile de continuer
    } else {
      layout[r][c] = prevToken; // revert: ce retrait cassait l'unicité ou dépassait la cible
    }
  }
  return best;
}

/**
 * Une tentative de génération complète : forme dense + réparation ciblée
 * vers l'unicité + minimisation vers le palier SOLVEUR correspondant à
 * `stars` (1 à 3, voir `SOLVER_TIER_FOR_STARS`). `deadline` (timestamp
 * absolu) borne le temps total de CET essai, y compris à travers plusieurs
 * appels solveur internes (voir `repairToUnique`/`stripToTargetTier`).
 * Retourne `null` si la forme était dégénérée ou si la réparation n'a pas
 * convergé — `generateLevel` retente alors avec un nouveau seed. Un
 * résultat non-null est TOUJOURS confirmé unique (chaque étape ne commite
 * un changement qu'après l'avoir vérifié). `analysis.tier` est un palier
 * SOLVEUR (1-4), pas encore converti en étoiles — voir `generateLevel`.
 */
function tryGenerate(seed, stars, enabledFeatureKeys, deadline) {
  const preset = DIFFICULTY_PRESETS[stars];
  const solverTarget = SOLVER_TIER_FOR_STARS[stars];
  const rand = seededRandom(seed);

  const rows = pickInt(rand, preset.sizeRange);
  const cols = pickInt(rand, preset.sizeRange);
  const clueDensity = pickFloat(rand, preset.initialClueDensity);
  const cornerVoid = pickInt(rand, preset.cornerVoidRange);

  const featureSubset = pickFeatureSubset(rand, enabledFeatureKeys, preset.budget);
  const useForbidden = featureSubset.includes("forbidden");

  const layout = buildInitialLayout({ rows, cols, clueDensity, cornerVoid, rand });
  if (!repairToUnique(layout, rows, cols, useForbidden, rand, preset.repairNodeBudget, deadline)) return null;

  const analysis = stripToTargetTier(layout, rows, cols, solverTarget, preset.nodeBudget, rand, deadline);
  if (!analysis) return null;

  return { rows, cols, cells: layoutToRows(layout), analysis, featureSubset };
}

/**
 * Compare deux candidats déjà générés et retourne le meilleur selon l'ordre
 * de préférence de la Phase F (section 4/10 du doc) : solution unique avant
 * tout, puis palier de difficulté mesuré aussi proche que possible du palier
 * demandé, puis (à palier égal, imparfait) un `branchCount` qui pousse dans
 * la direction demandée.
 */
export function isBetterCandidate(a, b, requestedTier) {
  if (!a) return true;
  const aUnique = a.solutionCount === 1;
  const bUnique = b.solutionCount === 1;
  if (aUnique !== bUnique) return bUnique;

  const aDist = a.measuredTier == null ? Infinity : Math.abs(a.measuredTier - requestedTier);
  const bDist = b.measuredTier == null ? Infinity : Math.abs(b.measuredTier - requestedTier);
  if (aDist !== bDist) return bDist < aDist;

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
 * suivantes). Retourne toujours un niveau jouable (jamais 0 solution, jamais
 * multi-solution — voir commentaire d'en-tête) avec un rapport de difficulté
 * honnête — voir Phase F du doc pour la politique best-effort si aucun
 * candidat n'atteint pile le palier demandé dans le budget.
 */
export function generateLevel({
  difficulty = 1,
  enabledFeatureKeys = ["forbidden"],
  seed = Date.now() ^ (Math.random() * 0xffffffff),
  maxAttempts,
  maxTimeMs,
} = {}) {
  const stars = clampTier(difficulty);
  const solverTarget = SOLVER_TIER_FOR_STARS[stars]; // voir SOLVER_TIER_FOR_STARS: 1★→2, 2★→3, 3★→4
  const defaultBudget = getGenerationBudget(stars);
  const timeBudgetMs = maxTimeMs ?? defaultBudget.maxTimeMs;
  const attemptsBudget = maxAttempts ?? defaultBudget.maxAttempts;

  const start = Date.now();
  const deadline = start + timeBudgetMs; // partagé jusque dans repairToUnique/stripToTargetTier (voir leurs docs)
  let best = null;
  let attempts = 0;

  // Toute la boucle ci-dessous travaille en palier SOLVEUR (1-4, voir
  // solver.js/computeTier), pas en étoiles — la conversion vers les étoiles
  // affichées (1-3) n'a lieu qu'à la toute fin, sur `best` uniquement (voir
  // `starsForSolverTier`).
  while (attempts < attemptsBudget && Date.now() - start < timeBudgetMs) {
    attempts++;
    const candidateSeed = Math.floor(seed) + attempts * 7919; // grand premier: étale les seeds
    const raw = tryGenerate(candidateSeed, stars, enabledFeatureKeys, deadline);
    if (!raw) continue; // forme dégénérée ou réparation non convergée: on retente ailleurs

    const level = { name: "Infini", rows: raw.rows, cols: raw.cols, cells: raw.cells };
    const { tier: measuredTier, branchCount, solution } = raw.analysis;

    const candidate = {
      level,
      solution,
      solutionCount: 1, // garanti unique par construction (repair+strip ne commitent jamais un état ambigu)
      confirmedUnique: true,
      measuredTier, // palier SOLVEUR (1-4) à ce stade
      branchCount,
      requestedTier: solverTarget,
      featureSubset: raw.featureSubset,
      attempts,
    };

    if (measuredTier === solverTarget) {
      best = candidate;
      break; // candidat parfait: inutile de continuer
    }
    if (isBetterCandidate(best, candidate, solverTarget)) best = candidate;
  }

  if (!best) return null; // n'arrive que si même le fallback échoue à générer une forme jouable

  best.measuredTier = starsForSolverTier(best.measuredTier); // palier solveur -> étoiles affichées
  best.requestedTier = stars;
  best.level.starThresholds = [best.solution.length, Math.ceil(best.solution.length * 1.5)];
  best.attemptsUsed = attempts;
  best.timeMs = Date.now() - start;
  return best;
}
