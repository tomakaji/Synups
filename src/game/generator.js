// Mode Infini [Phase 1+2] — générateur de niveau à la volée.
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
// Portée : Phase 1 (formes/murs/void + cases interdites FORBIDDEN + indices
// numériques CLUE dérivés d'une solution de référence) + Phase 2 (charges
// colorées + cibles, voir plus bas). Pas encore de mécaniques spéciales
// (miroir/filtre/prisme/pyra/neurone miroir) — voir FEATURES ci-dessous,
// déjà répertoriées (poids, dépendances) mais marquées `implemented:false`
// tant que leur logique de placement (Phase B, section 4.2 du doc) n'est pas
// écrite.
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

// -- Phase 2 (Couleur) : la couleur doit toujours être NÉCESSAIRE quand elle
// est présente, jamais purement décorative (retour utilisateur explicite:
// "l'utilisation de la couleur dans le niveau doit être nécessaire, toujours
// — pas chaque couleur individuellement, mais l'usage global"). Concrètement:
// un niveau qui utilise la couleur doit avoir PLUSIEURS solutions en lumière
// blanche seule (`enumerateSolutions(..., {ignoreColor:true})`) mais UNE
// SEULE une fois la couleur prise en compte — jamais l'inverse (couleur
// ajoutée sur un niveau déjà unique en blanc, qui ne ferait alors que
// décorer une solution déjà connue).
//
// `solver.js` n'a besoin d'AUCUNE modification pour ça: `propagate`/le
// branchement ne raisonnent QUE sur les indices numériques (jamais la
// couleur), la couleur n'intervient qu'à la toute fin via `isWon`/
// `ignoreColor` — déjà threadé partout (voir countSolutions/
// enumerateSolutions/analyzeAndCount, paramètre `options`). Ça veut dire que
// `repairToUnique`/`stripToTargetTier` (les étapes coûteuses, appelées des
// dizaines de fois par tentative) restent INCHANGÉES et gardent exactement
// la même perf qu'avant — la couleur n'est ajoutée qu'après coup, une seule
// fois par tentative de génération.
//
// Stratégie (voir `tryColorizeForNecessity` ci-dessous), une fois le plateau
// déjà réparé + minimisé au palier cible EN BLANC (comme avant) :
//   1. Retirer UNE charge numérique parmi les survivantes (candidate au
//      hasard) pour réintroduire une ambiguïté CONTRÔLÉE — vérifiée via
//      `enumerateSolutions(cap=3, ignoreColor:true)`: on ne garde que les
//      cas à 2-3 solutions blanches exactement (pas "beaucoup", pour rester
//      rapide à discriminer), en s'assurant que la solution DE RÉFÉRENCE
//      (celle déjà validée par la minimisation) en fait toujours partie —
//      retirer une contrainte ne peut jamais l'invalider, seulement en
//      ajouter d'autres.
//   2. Colorier un sous-ensemble aléatoire des charges restantes, simuler la
//      grille (recompute()) séparément avec CHAQUE solution candidate
//      (celle de référence = "gagnante" + les alternatives), et chercher au
//      moins une case vide dont la teinte réelle DIFFÈRE entre la solution
//      gagnante et CHAQUE alternative — c'est cette case qui devient une
//      cible colorée (couleur lue directement dans la simulation gagnante,
//      jamais devinée). Si une alternative ne peut être discriminée par
//      aucune case sous ce coloriage, on réessaie (nouveau sous-ensemble de
//      charges coloriées, ou nouvelle charge retirée à l'étape 1).
//   3. Vérification finale au solveur (une seule fois, pas cher): le niveau
//      colorié doit être `count===1` avec couleur ET `count>=2` sans — sinon
//      on abandonne la couleur pour cette tentative plutôt que de risquer un
//      niveau mal formé (voir philosophie déjà en place: "tout coché
//      n'implique pas présent à chaque génération" — la couleur reste
//      probabiliste, jamais forcée si elle ne peut être rendue nécessaire).

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
 * `pickProbability` (voir `pickFeatureSubset`) : probabilité qu'une feature
 * cochée ET dans le budget soit effectivement incluse dans UNE tentative de
 * génération donnée — 0.6 par défaut (variété, "tout coché" ne veut pas dire
 * "présent partout"). La Couleur déroge à cette règle (retour utilisateur
 * explicite: quand elle est cochée, il doit être RARE de tomber sur un
 * niveau sans elle) — voir aussi `generateLevel`, qui élargit le budget de
 * tentatives et ne s'arrête plus tôt que sur un candidat qui l'a vraiment
 * obtenue, ce qui fait le plus gros du travail ; ce taux de pioche élevé
 * n'est qu'un premier filtre, pas la garantie à lui seul.
 */
export const FEATURES = {
  forbidden: { label: "Cases interdites", weight: 1, implemented: true },
  color: { label: "Couleur (charges + cibles)", weight: 3, implemented: true, pickProbability: 0.95 },
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

// Phase 2 (Couleur) : bornes de la recherche "réintroduire une ambiguïté
// contrôlée puis la discriminer par la couleur" (voir tryColorizeForNecessity/
// tryDiscriminatingColoring). Le nombre de combinaisons de RETRAIT essayées
// est défini par étoile dans COLOR_REMOVAL_PLAN_BY_STAR (plus bas) ; celle-ci
// borne le nombre de sous-ensembles de charges COLORIÉES essayés une fois
// l'ambiguïté trouvée. `deadline` (partagé, voir plus haut) reste le vrai
// garde-fou wall-clock dans les deux cas.
const MAX_COLOR_ATTEMPTS_PER_SIZE = 10;
const CLUE_COLOR_LETTERS = ["r", "g", "b"];

// Retour utilisateur : la couleur ne doit pas se rabattre sur un
// renforcement numérique pour paraître plus difficile — au contraire, plus
// le palier visé est élevé, plus on retire d'indices SIMULTANÉMENT pour
// ouvrir une ambiguïté plus riche (plusieurs alternatives à discriminer,
// donc potentiellement plusieurs charges/cibles nécessaires) que la couleur
// vient trancher. Essayé du plus grand nombre au plus petit (repli
// progressif si le plus ambitieux échoue sur ce plateau précis) — clés =
// ÉTOILES. 1★ reste à un seul retrait (déjà jugé satisfaisant).
// K=3 mesuré à l'usage: sur un plateau 3★ déjà très épuré (peu de charges
// survivantes), retirer 3 charges à la fois peut ouvrir une ambiguïté
// massive (bien au-delà de COLOR_AMBIGUITY_CAP), rendant CHAQUE tentative
// d'énumération coûteuse — jusqu'à ~30s cumulés mesurés sur un essai
// malchanceux malgré le garde-fou deadline (le même type de dépassement que
// le bug corrigé plus tôt sur stripToTargetTier: le budget de nœuds borne
// chaque appel individuellement, pas leur somme). Plafonné à 2 partout.
// `candidates` est VOLONTAIREMENT réduit pour un retrait multiple (plus
// cher par tentative que le retrait unique) — mesuré: passer autant de
// tentatives sur k=2 qu'aujourd'hui sur k=1 consommait presque tout le
// budget de temps avant même d'atteindre le repli k=1 (pourtant bien plus
// fiable), faisant chuter la fréquence globale de la couleur. Un budget k=2
// plus court laisse plus de marge au repli fiable si k=2 ne marche pas vite.
const COLOR_REMOVAL_PLAN_BY_STAR = {
  1: [{ count: 1, candidates: 24 }],
  2: [
    { count: 2, candidates: 10 },
    { count: 1, candidates: 24 },
  ],
  3: [
    { count: 2, candidates: 10 },
    { count: 1, candidates: 24 },
  ],
};
// Cap d'énumération pour la détection d'ambiguïté (voir
// tryColorizeForNecessity) : plus large que du temps du retrait unique (qui
// se contentait de 3) car retirer 2 indices à la fois peut légitimement
// ouvrir plus de 2-3 solutions blanches — `tryDiscriminatingColoring` gère
// nativement un nombre arbitraire d'alternatives.
const COLOR_AMBIGUITY_CAP = 5;
// Budget de nœuds DÉDIÉ (pas preset.repairNodeBudget, potentiellement 150k)
// pour la détection d'ambiguïté: chaque tentative doit rester bon marché
// puisqu'il y en a potentiellement des dizaines par génération — un budget
// plus généreux ferait juste explorer plus longtemps une forme déjà trop
// relâchée pour ce retrait précis, sans plus de chances utiles d'exhaustivité.
const COLOR_AMBIGUITY_NODE_BUDGET = 40_000;

// Multiplicateur appliqué au budget de tentatives/temps (voir
// DEFAULT_MAX_ATTEMPTS_BY_TIER/DEFAULT_MAX_TIME_MS_BY_TIER) quand la Couleur
// est cochée par le joueur (voir generateLevel) — trouver un candidat à la
// fois au bon palier ET avec une couleur nécessaire est un objectif combiné
// plus dur qu'un seul des deux, donc la boucle a besoin d'un peu plus de
// marge pour y arriver presque toujours plutôt que d'abandonner tôt.
const COLOR_BUDGET_MULTIPLIER = 2.2;

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
    if (rand() < (FEATURES[k].pickProbability ?? 0.6)) {
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

// Toujours joint par des espaces (jamais concaténé): depuis la Phase 2, une
// case peut porter un token à 2 caractères ("2r" = charge 2 rouge) — voir
// grid.js/parseCellToken, qui découpe par espaces dès qu'il en trouve un
// dans la rangée. Fonctionnellement identique à une concaténation directe
// pour les tokens à 1 caractère (le découpage par espaces ou par caractère
// donne alors exactement les mêmes tokens), donc aucun changement de
// comportement pour les plateaux sans couleur.
function layoutToRows(layout) {
  return layout.map((row) => row.join(" "));
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

// -- Phase 2 (Couleur) : helpers -------------------------------------------

// Table inverse de TARGET_CODES (grid.js) : combinaison de canaux -> lettre
// de case-cible. Dupliquée ici plutôt qu'exportée depuis grid.js, pour
// garder grid.js focalisé sur les règles de jeu (pas la génération).
const RGB_TO_TARGET_LETTER = new Map([
  ["100", "r"],
  ["010", "g"],
  ["001", "b"],
  ["110", "y"],
  ["011", "c"],
  ["101", "m"],
  ["111", "w"],
]);

function targetLetterFor(lit) {
  const key = `${lit.r ? 1 : 0}${lit.g ? 1 : 0}${lit.b ? 1 : 0}`;
  return RGB_TO_TARGET_LETTER.get(key) || null; // null: case jamais éclairée (défensif, ne devrait pas arriver)
}

function sameLitColor(a, b) {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/** Cases actuellement charge numérique SANS couleur ("1"-"4" seuls, pas
 * encore "2r" etc.) — candidates à la fois pour le retrait ciblé (étape 1)
 * et le coloriage (étape 2) de tryColorizeForNecessity. */
function collectPlainClueCells(layout, rows, cols) {
  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (/^[1-4]$/.test(layout[r][c])) cells.push([r, c]);
    }
  return cells;
}

function sameLightSet(a, b) {
  if (a.length !== b.length) return false;
  const setB = new Set(b.map(([r, c]) => `${r},${c}`));
  return a.every(([r, c]) => setB.has(`${r},${c}`));
}

/** Retrouve, parmi plusieurs solutions blanches trouvées après un retrait de
 * charge, celle qui correspond à la solution de référence déjà validée —
 * elle en fait TOUJOURS partie (retirer une contrainte ne peut jamais
 * invalider une solution déjà valide, voir commentaire d'en-tête). Filet de
 * sécurité défensif: si jamais introuvable (ne devrait pas arriver), on
 * retombe sur la première trouvée plutôt que de planter. */
function findReferenceSolutionIndex(solutions, reference) {
  const idx = solutions.findIndex((s) => sameLightSet(s, reference));
  return idx >= 0 ? idx : 0;
}

/** Construit une grille à partir du plateau actuel (déjà coloré ou non) et y
 * pose directement un jeu de lumières donné (une solution déjà connue,
 * jamais rejouée via toggleLight — pas besoin de revalider un placement déjà
 * prouvé légal), puis recalcule l'état complet (lasers, teintes...). Utilisé
 * pour COMPARER comment une même charge colorée illuminerait chaque case
 * selon la solution retenue. */
function buildGridWithLights(layout, rows, cols, lights) {
  const grid = new LightUpGrid({ name: "Infini", rows, cols, cells: layoutToRows(layout) });
  for (const [r, c] of lights) grid.lights.add(grid.key(r, c));
  grid.recompute();
  return grid;
}

/** Vrai si (r,c) est atteinte par un VRAI laser coloré (pas juste "blanc par
 * défaut, faute de mieux") dans `grid` — voir grid.js recompute(): `_lit`
 * retombe sur du blanc dès qu'AUCUNE lumière colorée n'atteint la case, donc
 * ce n'est PAS `_lit` qu'il faut lire pour savoir si un laser a vraiment
 * joué un rôle ici, mais `_litColor` (l'accumulation de teinte AVANT ce
 * retombé). Utilisé pour ne jamais désigner une cible "blanche par défaut"
 * (voir commentaire d'en-tête, bug rapporté: cible blanche sans neurone
 * coloré visiblement connecté). */
function isGenuinelyColored(grid, r, c) {
  const tint = grid.cellAt(r, c)._litColor;
  return !!(tint && (tint.r || tint.g || tint.b));
}

/**
 * Étape 2 (voir commentaire d'en-tête) : essaie de colorier un sous-ensemble
 * des charges numériques restantes puis de désigner des cases-cibles dont la
 * teinte, sous ce coloriage, DIFFÈRE entre `winner` (la solution qu'on veut
 * rendre gagnante) et CHACUNE des `alternates` (les autres solutions
 * blanches valides, qui doivent donc échouer une fois la couleur prise en
 * compte). Modifie `layout` EN PLACE en cas de succès (charges coloriées +
 * cases-cibles) et retourne la liste des mutations appliquées (pour
 * permettre à l'appelant de tout annuler si la vérification finale échoue
 * malgré tout) ; retourne `null` si aucune combinaison essayée dans le
 * budget n'a discriminé toutes les alternatives (layout déjà remis dans son
 * état d'origine dans ce cas).
 *
 * Deux garde-fous de LISIBILITÉ (retour utilisateur après un premier essai:
 * des niveaux avaient une cible blanche sans neurone coloré visiblement en
 * cause, ou un neurone colorié qui ne servait à rien) — au-delà de la seule
 * propriété logique "ambigu en blanc, unique en couleur" déjà garantie par
 * l'appelant:
 * 1. Une case-cible n'est retenue QUE si elle est réellement colorée dans la
 *    solution GAGNANTE (`isGenuinelyColored`, pas juste "différente de
 *    l'alternative") — jamais de cible "blanche par défaut" qui ne
 *    s'explique par aucun laser visible dans la vraie solution.
 * 2. Une fois les cibles choisies, une passe de nettoyage retire la couleur
 *    de toute charge qui ne contribue à AUCUNE cible retenue (vérifié
 *    localement contre `winner`/`alternates`, déjà connues — pas besoin de
 *    relancer une recherche solveur ici). Gère nativement les mélanges: si
 *    deux charges se combinent pour produire la couleur exacte d'une cible,
 *    retirer l'une romprait le mélange, donc la vérification les garde
 *    toutes les deux.
 * Les tailles de sous-ensemble sont essayées en ordre DÉCROISSANT (retour
 * utilisateur: préférer plus de couleur visible plutôt que le minimum
 * strict) — la passe de nettoyage élimine de toute façon ce qui s'avère
 * décoratif, donc partir large ne risque jamais de laisser une charge
 * inutile dans le résultat final.
 */
function tryDiscriminatingColoring(layout, rows, cols, winner, alternates, rand, deadline) {
  const clueCells = collectPlainClueCells(layout, rows, cols);
  if (clueCells.length === 0) return null;

  const sizes = [...new Set([clueCells.length, 5, 3, 2, 1].filter((n) => n <= clueCells.length))];

  for (const size of sizes) {
    for (let attempt = 0; attempt < MAX_COLOR_ATTEMPTS_PER_SIZE; attempt++) {
      if (Date.now() > deadline) return null;

      const chosen = shuffle([...clueCells], rand).slice(0, size);
      const applied = []; // [r, c, prevToken] — dans l'ordre d'application, pour un revert LIFO propre
      for (const [r, c] of chosen) {
        applied.push([r, c, layout[r][c]]);
        layout[r][c] = layout[r][c] + CLUE_COLOR_LETTERS[Math.floor(rand() * CLUE_COLOR_LETTERS.length)];
      }

      const winnerGrid = buildGridWithLights(layout, rows, cols, winner);
      const altGrids = alternates.map((alt) => buildGridWithLights(layout, rows, cols, alt));

      // Pour chaque alternative: quelles cases vides (encore "." — pas déjà
      // charge/interdite/void/cible), réellement colorées dans winner (voir
      // garde-fou 1 ci-dessus), ont une teinte différente entre winner et
      // cette alternative, sous CE coloriage précis ?
      const perAlternateDiffs = altGrids.map((altGrid) => {
        const diffs = [];
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            if (layout[r][c] !== ".") continue;
            if (!isGenuinelyColored(winnerGrid, r, c)) continue;
            const wLit = winnerGrid.cellAt(r, c)._lit;
            const aLit = altGrid.cellAt(r, c)._lit;
            if (!sameLitColor(wLit, aLit)) diffs.push([r, c]);
          }
        return diffs;
      });

      if (perAlternateDiffs.some((diffs) => diffs.length === 0)) {
        // Au moins une alternative reste indiscernable de winner sous ce
        // coloriage: annule et réessaie une autre combinaison.
        for (let i = applied.length - 1; i >= 0; i--) layout[applied[i][0]][applied[i][1]] = applied[i][2];
        continue;
      }

      // Choisit un ensemble de cases-cibles couvrant TOUTES les
      // alternatives (glouton: une case qui discrimine plusieurs
      // alternatives à la fois compte pour toutes, minimise le nombre de
      // cibles ajoutées).
      const covered = new Array(alternates.length).fill(false);
      const targets = [];
      for (let i = 0; i < alternates.length; i++) {
        if (covered[i]) continue;
        const pool = perAlternateDiffs[i];
        const [tr, tc] = pool[Math.floor(rand() * pool.length)];
        targets.push([tr, tc]);
        for (let j = 0; j < alternates.length; j++) {
          if (covered[j]) continue;
          const wLit = winnerGrid.cellAt(tr, tc)._lit;
          const ajLit = altGrids[j].cellAt(tr, tc)._lit;
          if (!sameLitColor(wLit, ajLit)) covered[j] = true;
        }
      }

      for (const [tr, tc] of targets) {
        const letter = targetLetterFor(winnerGrid.cellAt(tr, tc)._lit);
        if (!letter) continue; // défensif: ne devrait jamais arriver (winner illumine toujours ses cases vides)
        applied.push([tr, tc, layout[tr][tc]]);
        layout[tr][tc] = letter;
      }

      // Garde-fou 2 (voir commentaire de la fonction): nettoie les charges
      // coloriées décoratives. `applied[0..chosen.length-1]` correspond,
      // dans le même ordre, aux entrées de `chosen` (poussées avant tout le
      // reste, une par charge coloriée) — chaque test est purement local
      // (pas de recherche solveur): winner doit toujours atteindre CHAQUE
      // cible avec exactement sa couleur déjà figée, ET chaque alternative
      // doit encore échouer sur AU MOINS une cible.
      for (let i = 0; i < chosen.length; i++) {
        const [r, c] = chosen[i];
        const numberOnlyToken = applied[i][2];
        const coloredToken = layout[r][c];
        layout[r][c] = numberOnlyToken; // retrait tentatif

        const testWinnerGrid = buildGridWithLights(layout, rows, cols, winner);
        const winnerStillWins = targets.every(
          ([tr, tc]) => targetLetterFor(testWinnerGrid.cellAt(tr, tc)._lit) === layout[tr][tc]
        );
        const altsStillFail =
          winnerStillWins &&
          alternates.every((alt) => {
            const testAltGrid = buildGridWithLights(layout, rows, cols, alt);
            return targets.some(([tr, tc]) => targetLetterFor(testAltGrid.cellAt(tr, tc)._lit) !== layout[tr][tc]);
          });

        if (!(winnerStillWins && altsStillFail)) layout[r][c] = coloredToken; // nécessaire: on la remet
      }

      return applied;
    }
  }
  return null;
}

/**
 * Étape 1 + orchestration (voir commentaire d'en-tête) : essaie de rendre la
 * couleur NÉCESSAIRE sur le plateau déjà unique/minimisé `layout`. Retire
 * PLUSIEURS charges à la fois selon `stars` (voir COLOR_REMOVAL_COUNTS_BY_STAR
 * — plus le palier est élevé, plus l'ambiguïté ouverte est riche, avec repli
 * progressif vers un retrait plus modeste si le plus ambitieux échoue sur ce
 * plateau précis). Modifie `layout` EN PLACE seulement en cas de succès
 * complet (retrait + coloriage discriminant + vérification finale au
 * solveur, les trois validés) ; le restaure fidèlement à son état d'entrée
 * sinon. Retourne le résultat `analyzeAndCount` du plateau colorié final
 * (avec couleur prise en
 * compte) en cas de succès, `null` sinon — dans ce cas l'appelant garde le
 * plateau non colorié tel quel (la couleur reste probabiliste, jamais
 * forcée: voir commentaire d'en-tête).
 */
function tryColorizeForNecessity(layout, rows, cols, referenceSolution, rand, preset, stars, deadline) {
  const removalPlan = COLOR_REMOVAL_PLAN_BY_STAR[stars] ?? [{ count: 1, candidates: 24 }];

  for (const { count: k, candidates: maxCandidates } of removalPlan) {
    const clueCells = collectPlainClueCells(layout, rows, cols);
    if (clueCells.length < k) continue; // pas assez de charges survivantes pour retirer k à la fois

    for (let attempt = 0; attempt < maxCandidates; attempt++) {
      if (Date.now() > deadline) return null;

      const subset = shuffle([...clueCells], rand).slice(0, k);
      const prevTokens = subset.map(([r, c]) => layout[r][c]);
      for (const [r, c] of subset) layout[r][c] = "X"; // retrait tentatif: réintroduit potentiellement une ambiguïté blanche contrôlée

      const level = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
      const { solutions, exhausted } = enumerateSolutions(level, COLOR_AMBIGUITY_CAP, COLOR_AMBIGUITY_NODE_BUDGET, {
        ignoreColor: true,
      });

      // On ne garde que les cas à ambiguïté CONTRÔLÉE (au moins 2 solutions
      // blanches, cap atteint et épuisé) — "trop" de solutions (cap non
      // épuisé) serait coûteux à discriminer entièrement et signale une
      // forme trop relâchée pour ce retrait précis.
      if (!exhausted || solutions.length < 2) {
        subset.forEach(([r, c], i) => (layout[r][c] = prevTokens[i]));
        continue;
      }

      const winnerIdx = findReferenceSolutionIndex(solutions, referenceSolution);
      const winner = solutions[winnerIdx];
      const alternates = solutions.filter((_, idx) => idx !== winnerIdx);

      const applied = tryDiscriminatingColoring(layout, rows, cols, winner, alternates, rand, deadline);
      if (applied) {
        const finalLevel = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
        const verify = analyzeAndCount(finalLevel, 2, preset.nodeBudget);
        const whiteCheck = enumerateSolutions(finalLevel, 2, preset.repairNodeBudget, { ignoreColor: true });

        if (
          verify &&
          verify.exhausted &&
          verify.count === 1 &&
          whiteCheck.exhausted &&
          whiteCheck.solutions.length >= 2
        ) {
          return verify; // succès: layout garde son retrait + coloriage, c'est le résultat final
        }
        // Vérification finale ratée malgré un coloriage a priori
        // discriminant (garde-fou défensif, ex. interaction imprévue) :
        // annule le coloriage avant de restaurer aussi les charges retirées.
        for (let i = applied.length - 1; i >= 0; i--) layout[applied[i][0]][applied[i][1]] = applied[i][2];
      }

      subset.forEach(([r, c], i) => (layout[r][c] = prevTokens[i])); // ce retrait n'a mené à rien: on essaie un autre sous-ensemble
    }
  }
  return null;
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
  const wantsColor = featureSubset.includes("color");

  const layout = buildInitialLayout({ rows, cols, clueDensity, cornerVoid, rand });
  if (!repairToUnique(layout, rows, cols, useForbidden, rand, preset.repairNodeBudget, deadline)) return null;

  const analysis = stripToTargetTier(layout, rows, cols, solverTarget, preset.nodeBudget, rand, deadline);
  if (!analysis) return null;

  // Phase 2 (Couleur, voir commentaire d'en-tête) : tentative best-effort,
  // JAMAIS forcée — si aucune combinaison retrait+coloriage n'a pu être
  // rendue nécessaire dans le budget, on sert le plateau non colorié tel
  // quel (déjà confirmé unique par stripToTargetTier ci-dessus) plutôt que
  // d'ajouter une couleur purement décorative.
  let finalAnalysis = analysis;
  let colorApplied = false;
  if (wantsColor) {
    const colorAnalysis = tryColorizeForNecessity(layout, rows, cols, analysis.solution, rand, preset, stars, deadline);
    if (colorAnalysis) {
      finalAnalysis = colorAnalysis;
      colorApplied = true;
    }
  }
  const actualFeatureSubset = colorApplied ? featureSubset : featureSubset.filter((k) => k !== "color");

  return { rows, cols, cells: layoutToRows(layout), analysis: finalAnalysis, featureSubset: actualFeatureSubset };
}

/**
 * Compare deux candidats déjà générés et retourne le meilleur selon l'ordre
 * de préférence de la Phase F (section 4/10 du doc) : solution unique avant
 * tout, puis palier de difficulté mesuré aussi proche que possible du palier
 * demandé, puis — si `preferColor` (voir `generateLevel`, la couleur a été
 * cochée par le joueur) — la présence de couleur à palier égal, puis (à
 * palier ET couleur égaux, imparfait) un `branchCount` qui pousse dans la
 * direction demandée.
 */
export function isBetterCandidate(a, b, requestedTier, preferColor = false) {
  if (!a) return true;
  const aUnique = a.solutionCount === 1;
  const bUnique = b.solutionCount === 1;
  if (aUnique !== bUnique) return bUnique;

  const aDist = a.measuredTier == null ? Infinity : Math.abs(a.measuredTier - requestedTier);
  const bDist = b.measuredTier == null ? Infinity : Math.abs(b.measuredTier - requestedTier);
  if (aDist !== bDist) return bDist < aDist;

  if (preferColor) {
    const aColor = a.featureSubset?.includes("color") ?? false;
    const bColor = b.featureSubset?.includes("color") ?? false;
    if (aColor !== bColor) return bColor;
  }

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
  const colorRequested = Array.isArray(enabledFeatureKeys) && enabledFeatureKeys.includes("color");
  const defaultBudget = getGenerationBudget(stars);
  // Voir COLOR_BUDGET_MULTIPLIER: viser À LA FOIS le bon palier ET une
  // couleur nécessaire est un objectif combiné plus dur qu'un seul des deux
  // (voir le critère `isPerfect` ci-dessous, qui n'accepte plus l'un sans
  // l'autre quand la couleur est demandée) — élargi pour que ça reste rare
  // d'échouer sur la couleur plutôt que de réduire le budget effectif.
  const budgetMultiplier = colorRequested ? COLOR_BUDGET_MULTIPLIER : 1;
  const timeBudgetMs = Math.round((maxTimeMs ?? defaultBudget.maxTimeMs) * budgetMultiplier);
  const attemptsBudget = Math.round((maxAttempts ?? defaultBudget.maxAttempts) * budgetMultiplier);

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

    // "Parfait" (arrêt immédiat) exige désormais AUSSI la couleur quand elle
    // a été demandée par le joueur (voir commentaire ci-dessus) — un
    // candidat au bon palier mais sans couleur reste un excellent filet de
    // sécurité (via isBetterCandidate juste en dessous), mais ne coupe plus
    // la boucle : on continue à retenter, dans le budget élargi, jusqu'à
    // trouver mieux ou épuiser le budget.
    const isPerfect = measuredTier === solverTarget && (!colorRequested || candidate.featureSubset.includes("color"));
    if (isPerfect) {
      best = candidate;
      break;
    }
    if (isBetterCandidate(best, candidate, solverTarget, colorRequested)) best = candidate;
  }

  if (!best) return null; // n'arrive que si même le fallback échoue à générer une forme jouable

  best.measuredTier = starsForSolverTier(best.measuredTier); // palier solveur -> étoiles affichées
  best.requestedTier = stars;
  best.level.starThresholds = [best.solution.length, Math.ceil(best.solution.length * 1.5)];
  best.attemptsUsed = attempts;
  best.timeMs = Date.now() - start;
  return best;
}
