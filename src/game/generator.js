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
  // pickProbability élevée (comme color) : voir generateLevel/isPerfect — la
  // boucle s'arrête dès le premier essai qui atteint le bon palier ET la
  // couleur, SANS jamais comparer d'essais ultérieurs via isBetterCandidate
  // (qui ne s'exécute qu'en cas d'échec de isPerfect) — donc la seule vraie
  // façon d'augmenter la fréquence du miroir gratuitement (sans budget de
  // recherche dédié) est de maximiser la chance qu'il soit DÉJÀ tiré sur CET
  // essai précis, pas de compter sur une comparaison ultérieure qui
  // n'arrive presque jamais en pratique.
  mirror: { label: "Miroir dévieur", weight: 2, implemented: true, requires: "color", pickProbability: 0.92 },
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
 * cf. lien densité/facilité déjà mesuré empiriquement). Le NOMBRE de cellules
 * reste corrélé à l'étoile : plus de cellules = plus de marge pour retirer
 * des indices et atteindre un palier réellement difficile.
 *
 * `rowsRange`/`colsRange` (plutôt qu'un seul `sizeRange` carré comme avant) :
 * retour utilisateur — le jeu est destiné au mobile en orientation portrait,
 * donc les grilles générées doivent être plus hautes que larges plutôt que
 * carrées. `rowsRange` est décalé vers le haut et `colsRange` vers le bas
 * d'environ un cran chacun par rapport à l'ancien `sizeRange` commun, ce qui
 * donne un ratio lignes/colonnes ~1.1 à ~1.5 selon le tirage — un biais
 * portrait net sans grille filiforme. La surface totale (lignes×colonnes)
 * est gardée quasiment identique à l'ancien `sizeRange` carré (à 1 cellule
 * près sur les bornes) : ni la difficulté ni la perf ne devraient bouger,
 * seule la FORME change. Toujours plafonné à ~80 cellules max (voir plus
 * bas, latence solveur) — y compris pour 3★/palier solveur 4 : un sweep
 * empirique a montré que la difficulté supplémentaire s'obtient très bien
 * par une minimisation plus poussée sur la MÊME surface, pas besoin
 * d'agrandir encore la grille (et donc pas besoin de rouvrir le risque de
 * latence ~50s mesuré sur du 10×10 clairsemé, 100 cellules).
 *
 * `cornerVoidRange` (variété de silhouette, coins coupés) est resté modeste :
 * `resolveAndDeriveClues`/`stripToTargetTier` transforment les cases sans
 * contrainte en VOID plutôt qu'en WALL (voir plus bas), donc la minimisation
 * ajoute déjà naturellement pas mal de VOID au plateau — cumuler ça avec un
 * cornerVoid généreux donnerait une proportion de cases mortes trop élevée.
 */
const DIFFICULTY_PRESETS = {
  1: {
    rowsRange: [8, 9],
    colsRange: [6, 7],
    initialClueDensity: [0.34, 0.42],
    cornerVoidRange: [0, 1],
    budget: 8,
    nodeBudget: 300_000,
    repairNodeBudget: 120_000,
  },
  2: {
    rowsRange: [9, 10],
    colsRange: [7, 8],
    initialClueDensity: [0.32, 0.4],
    cornerVoidRange: [0, 1],
    budget: 12,
    nodeBudget: 450_000,
    repairNodeBudget: 150_000,
  },
  3: {
    rowsRange: [9, 10],
    colsRange: [7, 8],
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

// EXPÉRIMENTAL / TEST (voir tryDiscriminatingColoring) : multiplie l'échelle
// des tailles de coloriage essayées (la charge la plus haute, `clueCells.
// length`, reste toujours tentée en premier inchangée — seul le palier de
// repli [5,3,2,1] est mis à l'échelle). 1 = comportement par défaut inchangé.
// Sert uniquement à mesurer/générer des variantes "plus de lumières
// colorées" à la demande — pas câblé à l'UI, à remettre à 1 après usage.
const COLOR_SIZE_MULTIPLIER = 1;

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
//
// 3★: k=1 (choix définitif de Toma). k=2 avait été essayé combiné à
// COLOR_MIN_SOLUTIONS_REQUIRED=5 (ci-dessous) mais mesuré sans bénéfice net
// sur la richesse de couleur par rapport à k=1+seuil=5 (qui donnait même une
// médiane plus haute) — et plus lent. C'est donc le seuil de solutions, pas
// k, qui reste le vrai levier de richesse colorée ; k=1 seul suffit et reste
// le plus rapide.
const COLOR_REMOVAL_PLAN_BY_STAR = {
  1: [{ count: 1, candidates: 24 }],
  2: [
    { count: 2, candidates: 10 },
    { count: 1, candidates: 24 },
  ],
  3: [{ count: 1, candidates: 24 }],
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

// Seuil minimal de solutions blanches exigé avant d'accepter un retrait
// candidat (voir tryColorizeForNecessity, juste en dessous de l'appel à
// enumerateSolutions). Choix définitif de Toma après comparaison A/B: viser
// le plafond d'énumération (COLOR_AMBIGUITY_CAP=5) plutôt que s'arrêter à la
// première ambiguïté trouvée (2, l'ancien comportement) — force une
// ambiguïté plus riche à discriminer, donc plus de charges colorées
// réellement nécessaires en moyenne (Garde-fou 2, le nettoyage décoratif,
// reste PLEINEMENT actif: rien ici ne contourne la règle "couleur jamais
// décorative", ça change seulement l'ambiguïté qu'on lui donne à nettoyer).
const COLOR_MIN_SOLUTIONS_REQUIRED = 5;

// Multiplicateur appliqué au budget de tentatives/temps (voir
// DEFAULT_MAX_ATTEMPTS_BY_TIER/DEFAULT_MAX_TIME_MS_BY_TIER) quand la Couleur
// est cochée par le joueur (voir generateLevel) — trouver un candidat à la
// fois au bon palier ET avec une couleur nécessaire est un objectif combiné
// plus dur qu'un seul des deux, donc la boucle a besoin d'un peu plus de
// marge pour y arriver presque toujours plutôt que d'abandonner tôt.
const COLOR_BUDGET_MULTIPLIER = 2.2;

// Phase 3 (Miroir dévieur, "une feature à la fois" — retour utilisateur:
// pas de mix avec Filtre pour l'instant, contrairement au plan initial).
// Placés directement dans buildInitialLayout comme des obstacles opaques
// génériques (voir plus haut) — aucun changement de solveur nécessaire, un
// miroir ne se distingue de "X" que pour les lasers colorés (voir
// grid.js/recompute), jamais pour la propagation blanche qui pilote tout le
// pipeline repair/strip.
//
// Calibrage mesuré à l'usage (deux itérations) : un miroir n'est utile QUE
// s'il se trouve être le premier obstacle sur le trajet d'un laser de charge
// colorée. Première itération (placement 100% aléatoire) : ~4% de niveaux
// avec un miroir vraiment utilisé — corrigé en exigeant le miroir dans le
// critère "parfait" comme la couleur (voir isPerfect plus bas), mais ça
// revenait à PAYER le hasard en temps de recherche plutôt qu'à le réduire :
// mesuré jusqu'à ~15-24s par génération en 2★/3★ (contre ~6-14s pour la
// couleur seule), un coût jugé "interdit" par l'utilisateur — ce n'était pas
// un problème de réglage mais d'approche (compter sur une coïncidence
// indépendante rare, puis rallonger le budget pour compenser, ne scale pas —
// chaque nouvelle feature dépendante future paierait le même prix). Deuxième
// itération, retenue : rendre la coïncidence beaucoup MOINS rare à la
// racine plutôt que d'attendre plus longtemps qu'elle survienne —
// `placeAlignedMirrors` (pose les miroirs alignés avec les cases-indice
// candidates) + `orderCluesByMirrorAlignment` (le coloriage préfère les
// charges déjà alignées avec un miroir) — les deux gratuits, aucun appel
// solveur de plus. Le miroir n'entre PLUS dans `isPerfect`/le budget élargi
// (voir MIRROR_BUDGET_MULTIPLIER) : il reste un bonus opportuniste
// (isBetterCandidate), mais qui survient bien plus souvent naturellement.
const MIRROR_DENSITY = 0.24;
// Volontairement 1 (aucun effet) : voir le commentaire ci-dessus — le
// miroir ne doit plus jamais coûter de recherche supplémentaire, sa
// fréquence repose entièrement sur le placement/la sélection biaisés, pas
// sur un budget de temps élargi. Gardé (plutôt que supprimé) pour rester
// symétrique avec COLOR_BUDGET_MULTIPLIER et réutilisable si jamais un futur
// réglage en avait de nouveau besoin.
const MIRROR_BUDGET_MULTIPLIER = 1;

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
 *
 * `f.requires` est vérifié DEUX fois, à deux niveaux différents : d'abord
 * contre `enabled` (coché dans l'UI — filtre juste les candidats à considérer
 * du tout), puis à la fin contre `chosen` (RÉELLEMENT piochée pour CET essai
 * précis). Le premier ne suffit pas : "color" a une probabilité de pioche
 * élevée mais pas 1, donc rien ne garantit qu'elle finisse dans `chosen`
 * même si elle est cochée — sans la seconde vérification, une feature
 * dépendante (Miroir, Filtre, Prisme) pourrait être piochée SEULE, ce qui
 * la rendrait purement décorative (un miroir ne dévie QUE les lasers de
 * charge colorée, voir grid.js — sans couleur nulle part, aucun effet
 * observable).
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
  return chosen.filter((k) => !FEATURES[k].requires || chosen.includes(FEATURES[k].requires));
}

/**
 * Représentation de travail d'un plateau en cours de génération: tableau 2D
 * de tokens à un caractère — 'X' (void, hors-grille), '.' (case vide), '/'
 * ou '\' (miroir dévieur, case FIXE jamais dérivée — voir isMirrorToken) ou
 * un obstacle plein qui sera (re)dérivé depuis une solution fraîche à chaque
 * appel de `resolveAndDeriveClues` : 'W' (mur sans contrainte, pas encore
 * dérivé OU volontairement dépouillé de son indice — voir stripToTargetTier),
 * '0' (case interdite) ou un chiffre '1'-'4' (indice numéroté). Converti en
 * chaînes de lignes uniquement pour appeler grid.js/solver.js.
 *
 * `mirrorDensity` (0 si la feature Miroir n'est pas demandée pour cet essai)
 * : probabilité, pour chaque case qui aurait sinon été vide, de devenir un
 * miroir plutôt — orientation "/"("\\" tirée 50/50. Un miroir ne dévie QUE
 * les lasers de charge colorée (voir grid.js) : placé ici, AVANT tout appel
 * solveur, il est ensuite traité comme un obstacle opaque générique par tout
 * le pipeline blanc (repair/strip/isolement), exactement comme "X" — aucune
 * case indice ne peut donc jamais s'y dériver (voir resolveAndDeriveClues).
 * La légitimité ("au moins un miroir réellement traversé par un laser") est
 * vérifiée a posteriori dans `tryGenerate` (voir `mirrorGenuinelyUsed`), pas
 * ici : à ce stade, aucune charge n'a encore de couleur.
 */
function buildInitialLayout({ rows, cols, clueDensity, cornerVoid, mirrorDensity, rand }) {
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
  // Passe séparée (pas dans la boucle ci-dessus) : voir placeAlignedMirrors,
  // le placement des miroirs a besoin de connaître TOUTES les cases "W" déjà
  // décidées, y compris celles de lignes/colonnes pas encore visitées au
  // moment où une case donnée serait remplie dans un unique passage.
  if (mirrorDensity > 0) placeAlignedMirrors(layout, rows, cols, mirrorDensity, rand);
  // Voir relaxIsolatedCells : le remplissage ci-dessus tire chaque case
  // indépendamment, ce qui peut par pur hasard entourer une case vide sur
  // ses 4 côtés — cette passe répare les cas vraiment inutiles et plafonne
  // les autres, AVANT tout appel solveur (donc sans risque pour l'unicité
  // et sans coût de recalcul).
  relaxIsolatedCells(layout, rows, cols, rand);
  return layout;
}

/** Vrai si (r,c) partage sa ligne OU sa colonne avec au moins une case
 * indice candidate ("W") — voir placeAlignedMirrors. */
function alignedWithClueCandidate(layout, r, c, rows, cols) {
  for (let cc = 0; cc < cols; cc++) if (cc !== c && layout[r][cc] === "W") return true;
  for (let rr = 0; rr < rows; rr++) if (rr !== r && layout[rr][c] === "W") return true;
  return false;
}

/**
 * Pose les miroirs EN PRIORITÉ sur des cases vides alignées (même ligne OU
 * colonne) avec au moins une charge candidate ("W") — plutôt qu'un tirage
 * totalement indépendant sur toute la grille (l'approche initiale, mesurée
 * trop peu efficace : voir docs/infinite-mode-design.md). Une charge
 * satisfaite tire un laser dans TOUTES ses directions non déjà occupées par
 * une lumière — un miroir hors de portée de toute charge ne sera donc
 * JAMAIS traversé par aucun laser (voir mirrorGenuinelyUsed), alors qu'un
 * miroir aligné a une vraie chance géométrique de l'être dès qu'une charge
 * de cette ligne/colonne est effectivement coloriée. Rien ne garantit encore
 * l'absence d'obstacle intermédiaire (voir tryDiscriminatingColoring, qui
 * complète côté SÉLECTION des charges à colorier) — mais ça change la base
 * probabiliste de "quasi jamais" à "souvent". Coût : toujours zéro appel
 * solveur, fait avant toute résolution comme le reste de cette fonction.
 */
function placeAlignedMirrors(layout, rows, cols, mirrorDensity, rand) {
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (layout[r][c] !== ".") continue;
      if (!alignedWithClueCandidate(layout, r, c, rows, cols)) continue;
      if (rand() < mirrorDensity) layout[r][c] = rand() < 0.5 ? "/" : "\\";
    }
}

// Distance 1 (orthogonale) uniquement : c'est la seule qui compte pour
// l'isolement d'une case vide — un rayon lumineux posé sur une case '.' ne
// peut illuminer une AUTRE case '.' que si rien d'opaque ne s'interpose
// directement entre les deux, donc tout se décide sur les 4 voisins
// immédiats (le bord de grille ferme tout autant qu'un obstacle).
const ORTHOGONAL_DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function orthogonalNeighbors(r, c, rows, cols) {
  const result = [];
  for (const [dr, dc] of ORTHOGONAL_DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) result.push([nr, nc]);
  }
  return result;
}

/** Vrai si la case vide (r,c) n'a AUCUN voisin orthogonal vide : aucune
 * lumière posée ailleurs ne peut jamais l'atteindre, elle DOIT recevoir sa
 * propre lumière sans la moindre ambiguïté possible — voir
 * relaxIsolatedCells pour pourquoi ce n'est un problème que dans certains
 * cas. */
function isIsolatedEmptyCell(layout, r, c, rows, cols) {
  return orthogonalNeighbors(r, c, rows, cols).every(([nr, nc]) => layout[nr][nc] !== ".");
}

/** Vrai si (r,c) a au moins un voisin orthogonal "W" (futur indice) : une
 * case isolée MAIS adjacente à un indice reste utile, sa lumière forcée
 * contribue au compte réel de ce voisin une fois `resolveAndDeriveClues`
 * passé — elle a donc un impact réel sur la logique du puzzle, contrairement
 * à une case isolée entourée uniquement de vide ("X")/bord. */
function hasClueNeighbor(layout, r, c, rows, cols) {
  return orthogonalNeighbors(r, c, rows, cols).some(([nr, nc]) => layout[nr][nc] === "W");
}

/** Vrai si `t` est un token de miroir dévieur ("/" ou "\\") — voir grid.js:
 * un miroir ne dévie QUE les lasers de charge colorée, la lumière blanche de
 * base le traverse comme n'importe quel obstacle opaque (bloque, sans
 * dévier). Ce n'est donc PAS un indice: il ne compte aucune lumière
 * adjacente et ne doit jamais être traité comme tel (dérivation de charge,
 * retrait de charge, adjacence "utile" pour une case isolée...). */
function isMirrorToken(t) {
  return t === "/" || t === "\\";
}

/** Vrai si `t` est un token d'indice DÉJÀ dérivé (numéro "1"-"4" ou case
 * interdite "0") — c'est-à-dire ni vide, ni void, ni "W" (candidat pas
 * encore résolu), ni miroir (voir `isMirrorToken`, un miroir n'est jamais un
 * indice). Utilisé après `resolveAndDeriveClues`, quand les cases indice ne
 * portent plus "W" mais leur vraie valeur — voir `wouldCreateDeadIsolation`,
 * le pendant de `hasClueNeighbor` pour cette phase-là. */
function isClueToken(t) {
  return t !== "X" && t !== "." && t !== "W" && !isMirrorToken(t);
}

/**
 * Répare EN PLACE, juste après le remplissage aléatoire initial et avant
 * tout appel solveur, les cases isolées "mortes" — une case vide sans aucun
 * voisin vide ET sans voisin indice, qui est donc à la fois forcément
 * éclairée (aucune ambiguïté possible) ET sans le moindre effet sur le reste
 * du puzzle : pur bruit. On la reconnecte en rouvrant un de ses voisins
 * opaques (redevenu '.'), ce qui la fait rejoindre un vrai segment d'au
 * moins 2 cases. Plafonne aussi le nombre total de cases isolées tolérées
 * sur le plateau (même celles adjacentes à un indice, donc "utiles"), pour
 * éviter l'effet "il y en a trop" même quand chacune prise séparément est
 * défendable.
 *
 * Volontairement fait ici et nulle part ailleurs dans le pipeline : c'est le
 * SEUL moment où la grille n'a encore aucune garantie d'unicité à préserver
 * (repairToUnique/stripToTargetTier n'ont pas encore tourné), donc rouvrir
 * une case ne risque jamais de casser une propriété déjà validée par le
 * solveur — pas besoin de re-solveur pour re-vérifier quoi que ce soit après
 * coup. Note : une case isolée créée PENDANT repairToUnique (qui pose des
 * murs pour casser une ambiguïté) est automatiquement du côté "utile" — le
 * mur qui vient de l'isoler est lui-même son voisin indice — donc jamais
 * "morte" ; inutile de dupliquer cette passe là-bas.
 * Coût : une seule passe O(lignes×colonnes) sur un tableau déjà en mémoire,
 * négligeable face aux dizaines/centaines d'appels solveur du reste du
 * pipeline.
 */
function relaxIsolatedCells(layout, rows, cols, rand) {
  const isolated = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (layout[r][c] === "." && isIsolatedEmptyCell(layout, r, c, rows, cols)) isolated.push([r, c]);
    }
  if (isolated.length === 0) return;

  const reconnect = (r, c) => {
    // Jamais un miroir dans le pool: contrairement à "W"/"X" (candidats sans
    // conséquence à rouvrir ici), un miroir a été placé intentionnellement
    // (voir buildInitialLayout) — le rouvrir le détruirait silencieusement.
    const opaque = orthogonalNeighbors(r, c, rows, cols).filter(
      ([nr, nc]) => layout[nr][nc] !== "." && !isMirrorToken(layout[nr][nc])
    );
    if (opaque.length === 0) return; // plus aucun voisin réparable (ex: entouré uniquement de miroirs) : rien à faire
    // Préfère rouvrir un voisin "W" plutôt qu'un "X" de coin, pour garder le
    // découpage de silhouette (cornerVoid) intact autant que possible.
    const wNeighbors = opaque.filter(([nr, nc]) => layout[nr][nc] === "W");
    const pool = wNeighbors.length > 0 ? wNeighbors : opaque;
    const [nr, nc] = pool[Math.floor(rand() * pool.length)];
    layout[nr][nc] = ".";
  };

  // 1) Cases mortes (aucun voisin indice) : toujours réparées.
  const stillIsolated = [];
  for (const [r, c] of isolated) {
    if (layout[r][c] !== "." || !isIsolatedEmptyCell(layout, r, c, rows, cols)) continue; // déjà reconnectée en chaîne
    if (!hasClueNeighbor(layout, r, c, rows, cols)) reconnect(r, c);
    else stillIsolated.push([r, c]);
  }

  // 2) Cases isolées "utiles" restantes : plafonnées pour éviter l'effet
  // "il y en a trop", même si chacune prise séparément est défendable.
  const cap = Math.max(1, Math.round((rows * cols) / 35));
  if (stillIsolated.length > cap) {
    shuffle(stillIsolated, rand);
    for (let i = cap; i < stillIsolated.length; i++) reconnect(stillIsolated[i][0], stillIsolated[i][1]);
  }
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
      // Miroir: jamais dérivé en indice (voir isMirrorToken) — un miroir ne
      // compte aucune lumière adjacente, c'est une case fixe du niveau, pas
      // une charge. Sans cette exclusion, cette boucle écraserait
      // silencieusement chaque miroir placé par un chiffre/VOID dérivé de
      // son compte de lumières, comme n'importe quelle charge classique.
      if (token === "X" || token === "." || isMirrorToken(token)) continue;
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
/**
 * Vrai si convertir TOUTES les cases-indice de `cells` en VOID (en une seule
 * fois — voir Phase 2 Couleur, qui en retire plusieurs à la fois pour un
 * même essai) ferait perdre à un voisin vide déjà isolé (voir
 * isIsolatedEmptyCell) son SEUL voisin indice restant EN DEHORS de l'ensemble
 * retiré — ce voisin, jusque-là "utile" (sa lumière forcée comptait dans un
 * des indices retirés), deviendrait alors une case morte au sens de
 * `relaxIsolatedCells` : forcée ET sans le moindre impact sur la logique du
 * puzzle. Appelée comme garde-fou AVANT de tenter le retrait (donc avant
 * tout appel solveur pour ces candidats) — coût O(1) par ensemble déjà
 * choisi, aucun appel solveur en plus. Ne modifie rien : simple test, les
 * candidats sont juste ignorés si vrai, la logique de retrait/vérification
 * reste inchangée sinon. `wouldCreateDeadIsolation` (cas à une seule case,
 * utilisé par `stripToTargetTier`) est un raccourci vers cette même logique.
 */
function wouldCreateDeadIsolationForSet(layout, cells, rows, cols) {
  const isRemoved = (r, c) => cells.some(([cr, cc]) => cr === r && cc === c);
  const checked = new Set();
  for (const [r, c] of cells) {
    for (const [nr, nc] of orthogonalNeighbors(r, c, rows, cols)) {
      const key = `${nr},${nc}`;
      if (checked.has(key)) continue;
      checked.add(key);
      if (layout[nr][nc] !== ".") continue;
      if (!isIsolatedEmptyCell(layout, nr, nc, rows, cols)) continue;
      const stillHasClueNeighbor = orthogonalNeighbors(nr, nc, rows, cols).some(
        ([or, oc]) => !isRemoved(or, oc) && isClueToken(layout[or][oc])
      );
      if (!stillHasClueNeighbor) return true;
    }
  }
  return false;
}

function wouldCreateDeadIsolation(layout, r, c, rows, cols) {
  return wouldCreateDeadIsolationForSet(layout, [[r, c]], rows, cols);
}

// EXPÉRIMENTAL (mesure en cours, voir tryColorizeForNecessity): taille de la
// plus grande région connexe de cases vides SANS AUCUN voisin indice — ces
// zones sont précisément celles où pickBranchCell perd son heuristique de
// guidage (voir solver.js: "sans indice actif à proximité, on retombe sur la
// première case non décidée") et où l'énumération d'ambiguïté devient chère,
// pas parce qu'elle est inefficace mais parce qu'il existe réellement
// beaucoup de remplissages valides différents à distinguer. Coût: un simple
// flood-fill, O(lignes×colonnes), aucun appel solveur.
const REGION_FILTER_THRESHOLD = 0; // 0 = désactivé; mis à une valeur >0 pour activer le filtre pendant la mesure

function largestClueSparseRegionSize(layout, rows, cols) {
  const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
  let best = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (seen[r][c] || layout[r][c] !== ".") continue;
      const stack = [[r, c]];
      seen[r][c] = true;
      let size = 0;
      let touchesClue = false;
      while (stack.length) {
        const [cr, cc] = stack.pop();
        size++;
        for (const [nr, nc] of orthogonalNeighbors(cr, cc, rows, cols)) {
          if (isClueToken(layout[nr][nc])) touchesClue = true;
          if (layout[nr][nc] === "." && !seen[nr][nc]) {
            seen[nr][nc] = true;
            stack.push([nr, nc]);
          }
        }
      }
      if (!touchesClue) best = Math.max(best, size);
    }
  }
  return best;
}

function stripToTargetTier(layout, rows, cols, targetTier, nodeBudget, rand, deadline) {
  const startLevel = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
  let best = analyzeAndCount(startLevel, 2, nodeBudget);
  if (!best || best.tier == null) return null;
  if (best.tier >= targetTier) return best;

  const candidates = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (isClueToken(layout[r][c])) candidates.push([r, c]); // indice (1-4) ou interdite ("0"), jamais un miroir
    }
  shuffle(candidates, rand);

  for (const [r, c] of candidates) {
    if (Date.now() > deadline) break; // budget de temps global dépassé: on sert le meilleur trouvé jusqu'ici
    if (wouldCreateDeadIsolation(layout, r, c, rows, cols)) continue; // voir commentaire dédié, aucun appel solveur gaspillé
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
 * Vrai si AU MOINS UN miroir du plateau est réellement traversé par un laser
 * de charge colorée dans la solution gagnante `solution` — c'est le pendant
 * de `isGenuinelyColored`/la passe de nettoyage de `tryDiscriminatingColoring`
 * pour le Miroir : la feature ne doit jamais rester purement décorative
 * (retour utilisateur déjà appliqué à la Couleur, même philosophie ici).
 * Lit `_mirrorColor` (union des couleurs qui ont traversé ce miroir précis,
 * voir grid.js recompute()) plutôt que de deviner géométriquement — aucun
 * nouvel appel solveur, juste une simulation locale (`buildGridWithLights`,
 * déjà utilisée ailleurs pour la même raison). Si aucune charge n'a de
 * couleur (Couleur pas obtenue pour cet essai), aucun laser n'existe jamais
 * et cette fonction retourne naturellement `false` sans cas particulier à
 * gérer côté appelant.
 */
function mirrorGenuinelyUsed(layout, rows, cols, solution) {
  const grid = buildGridWithLights(layout, rows, cols, solution);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!isMirrorToken(layout[r][c])) continue;
      const mc = grid.cellAt(r, c)._mirrorColor;
      if (mc && (mc.r || mc.g || mc.b)) return true;
    }
  return false;
}

/**
 * Nettoie EN PLACE les miroirs purement décoratifs (retour utilisateur:
 * "la plupart des miroirs générés ne servent à rien, il y en a beaucoup pour
 * rien, c'est polluant") — mesuré sur 10 générations 3★+couleur+miroir avant
 * ce correctif : seulement ~31% des miroirs POSÉS (`placeAlignedMirrors`,
 * densité MIRROR_DENSITY sur les cases alignées) étaient réellement
 * traversés par un laser dans la solution gagnante ; les ~69% restants
 * restaient sur le plateau sans jamais rien faire (`mirrorGenuinelyUsed` ne
 * vérifiait qu'"AU MOINS UN" miroir utilisé pour la sélection du candidat,
 * jamais un nettoyage par miroir individuel comme Garde-fou 2 le fait pour
 * la couleur).
 *
 * Convertit chaque miroir non traversé en VOID ("X") plutôt qu'en case vide :
 * un miroir est DÉJÀ, par construction, strictement équivalent à VOID pour
 * la propagation blanche (voir commentaire Phase 3 plus haut : "un miroir ne
 * se distingue de 'X' que pour les lasers colorés, jamais pour la
 * propagation blanche") — ce nettoyage ne change donc RIEN à la
 * solvabilité/unicité blanche déjà confirmée, et ne peut pas non plus
 * affecter un laser coloré de la solution gagnante puisque, par définition,
 * aucun ne traverse ce miroir précis. Aucun appel solveur, aucune
 * re-vérification nécessaire — sûr et gratuit, comme le reste du nettoyage
 * Phase 2/3.
 */
function pruneUnusedMirrors(layout, rows, cols, solution) {
  const grid = buildGridWithLights(layout, rows, cols, solution);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!isMirrorToken(layout[r][c])) continue;
      const mc = grid.cellAt(r, c)._mirrorColor;
      const used = mc && (mc.r || mc.g || mc.b);
      if (!used) layout[r][c] = "X";
    }
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
/** Vrai si (r,c) partage sa ligne OU sa colonne avec au moins un miroir —
 * pendant de `alignedWithClueCandidate` côté sélection plutôt que placement.
 * Voir `orderCluesByMirrorAlignment`. */
function alignedWithMirror(layout, r, c, rows, cols) {
  for (let cc = 0; cc < cols; cc++) if (cc !== c && isMirrorToken(layout[r][cc])) return true;
  for (let rr = 0; rr < rows; rr++) if (rr !== r && isMirrorToken(layout[rr][c])) return true;
  return false;
}

/**
 * Réordonne `clueCells` en mettant en tête celles alignées avec un miroir
 * (même ligne/colonne — voir `placeAlignedMirrors`), chaque groupe mélangé
 * indépendamment pour garder de la variété entre tentatives. Utilisé par
 * `tryDiscriminatingColoring` quand le Miroir est demandé : un `.slice(0,
 * size)` qui pioche en priorité dans ce sous-ensemble maximise la chance
 * qu'une charge RETENUE pour le coloriage ait, une fois satisfaite, un
 * laser qui traverse réellement un miroir plutôt que de dépendre d'une
 * coïncidence purement aléatoire. Gratuit : pure réorganisation d'une liste
 * déjà en mémoire, aucun appel solveur.
 */
function orderCluesByMirrorAlignment(clueCells, layout, rows, cols, rand) {
  const aligned = [];
  const rest = [];
  for (const cell of clueCells) {
    (alignedWithMirror(layout, cell[0], cell[1], rows, cols) ? aligned : rest).push(cell);
  }
  shuffle(aligned, rand);
  shuffle(rest, rand);
  return [...aligned, ...rest];
}

function tryDiscriminatingColoring(layout, rows, cols, winner, alternates, rand, deadline, wantsMirror = false) {
  const clueCells = collectPlainClueCells(layout, rows, cols);
  if (clueCells.length === 0) return null;

  // TEMP TEST (Toma) : essayer `clueCells.length` en premier "gagne" presque
  // toujours dès que Garde-fou 2 est désactivé (voir plus bas) — ça rend le
  // multiplicateur inopérant puisque "colorier tout" écrase la cible visée.
  // Avec COLOR_SIZE_MULTIPLIER != 1, on vise donc une taille EXPLICITE (2 ×
  // médiane mesurée en 1x, elle-même ≈2) au lieu de la liste habituelle, avec
  // un repli décroissant seulement pour éviter un échec total.
  const sizes =
    COLOR_SIZE_MULTIPLIER === 1
      ? [...new Set([clueCells.length, 5, 3, 2, 1].filter((n) => n <= clueCells.length))]
      : (() => {
          const target = Math.min(clueCells.length, Math.max(2, Math.round(2 * COLOR_SIZE_MULTIPLIER)));
          const fallback = [];
          for (let n = target; n >= 1; n--) fallback.push(n);
          return fallback;
        })();

  for (const size of sizes) {
    for (let attempt = 0; attempt < MAX_COLOR_ATTEMPTS_PER_SIZE; attempt++) {
      if (Date.now() > deadline) return null;

      // Sans miroir demandé: comportement identique à avant (shuffle pur).
      // Avec miroir: biaise l'ordre de tirage (voir orderCluesByMirrorAlignment)
      // plutôt que de chercher activement un coloriage qui traverse un miroir
      // — ça reste "premier coloriage discriminant trouvé gagne", juste avec
      // un tirage qui favorise déjà les charges les plus prometteuses.
      const ordered = wantsMirror
        ? orderCluesByMirrorAlignment(clueCells, layout, rows, cols, rand)
        : shuffle([...clueCells], rand);
      const chosen = ordered.slice(0, size);
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
      //
      // TEMP TEST (Toma, voir COLOR_SIZE_MULTIPLIER) : ce nettoyage est ce
      // qui ramène systématiquement le nombre de charges coloriées survivantes
      // au strict minimum nécessaire, quelle que soit la taille initiale
      // essayée — désactivé quand COLOR_SIZE_MULTIPLIER > 1 pour que "plus de
      // lumières colorées demandées" se voie vraiment à l'écran (au prix
      // d'accepter des charges décoratives, normalement proscrites — voir
      // commentaire de tryColorizeForNecessity). À retirer avec le reste du
      // levier une fois le test terminé.
      for (let i = 0; i < chosen.length && COLOR_SIZE_MULTIPLIER === 1; i++) {
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
function tryColorizeForNecessity(layout, rows, cols, referenceSolution, rand, preset, stars, deadline, wantsMirror = false) {
  const removalPlan = COLOR_REMOVAL_PLAN_BY_STAR[stars] ?? [{ count: 1, candidates: 24 }];

  for (const { count: k, candidates: maxCandidates } of removalPlan) {
    const clueCells = collectPlainClueCells(layout, rows, cols);
    if (clueCells.length < k) continue; // pas assez de charges survivantes pour retirer k à la fois

    for (let attempt = 0; attempt < maxCandidates; attempt++) {
      if (Date.now() > deadline) return null;

      // Sans miroir demandé: shuffle pur, comportement inchangé. Avec
      // miroir: retire en PRIORITÉ les charges NON alignées avec un miroir
      // (ordre inversé par rapport à orderCluesByMirrorAlignment) pour
      // garder le plus possible de charges alignées disponibles pour le
      // coloriage juste après (tryDiscriminatingColoring, qui lui les
      // préfère) — pas de retrait forcé, juste un tirage moins susceptible
      // de gâcher les meilleurs candidats.
      const removalOrder = wantsMirror
        ? orderCluesByMirrorAlignment(clueCells, layout, rows, cols, rand).reverse()
        : shuffle([...clueCells], rand);
      const subset = removalOrder.slice(0, k);
      if (wouldCreateDeadIsolationForSet(layout, subset, rows, cols)) continue; // voir commentaire dédié, aucun appel solveur gaspillé
      const prevTokens = subset.map(([r, c]) => layout[r][c]);
      for (const [r, c] of subset) layout[r][c] = "X"; // retrait tentatif: réintroduit potentiellement une ambiguïté blanche contrôlée

      // EXPÉRIMENTAL (voir REGION_FILTER_THRESHOLD): écarte les candidats
      // qui ouvrent une zone clue-sparse trop large AVANT de payer le coût
      // du solveur dessus.
      if (REGION_FILTER_THRESHOLD > 0 && largestClueSparseRegionSize(layout, rows, cols) > REGION_FILTER_THRESHOLD) {
        subset.forEach(([r, c], i) => (layout[r][c] = prevTokens[i]));
        continue;
      }

      const level = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
      const { solutions, exhausted } = enumerateSolutions(level, COLOR_AMBIGUITY_CAP, COLOR_AMBIGUITY_NODE_BUDGET, {
        ignoreColor: true,
      });

      // On ne garde que les cas à ambiguïté CONTRÔLÉE (au moins
      // COLOR_MIN_SOLUTIONS_REQUIRED solutions blanches — 2 par défaut, voir
      // ce nom pour le test en cours — cap atteint et épuisé) — "trop" de
      // solutions (cap non épuisé) serait coûteux à discriminer entièrement
      // et signale une forme trop relâchée pour ce retrait précis.
      if (!exhausted || solutions.length < COLOR_MIN_SOLUTIONS_REQUIRED) {
        subset.forEach(([r, c], i) => (layout[r][c] = prevTokens[i]));
        continue;
      }

      const winnerIdx = findReferenceSolutionIndex(solutions, referenceSolution);
      const winner = solutions[winnerIdx];
      const alternates = solutions.filter((_, idx) => idx !== winnerIdx);

      const applied = tryDiscriminatingColoring(layout, rows, cols, winner, alternates, rand, deadline, wantsMirror);
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
/**
 * Dernière passe, juste avant de retourner le plateau final (après
 * `stripToTargetTier` ET la Phase Couleur) : neutralise toute case isolée
 * "morte" qui aurait malgré tout survécu. `wouldCreateDeadIsolation`/
 * `wouldCreateDeadIsolationForSet` sont des garde-fous PRÉVENTIFS mais pas
 * exhaustifs : `resolveAndDeriveClues` (rappelée à chaque itération de
 * `repairToUnique`) dérive elle-même chaque case-indice depuis un compte
 * réel de lumières et la convertit en VOID dès que ce compte tombe à 0 (si
 * les cases interdites ne sont pas activées) — ce qui peut priver un voisin
 * isolé de son seul voisin indice sans passer par les deux garde-fous
 * ci-dessus, potentiellement à répétition à chaque itération de réparation.
 * Converti en VOID ("X") plutôt que rouvert : contrairement à
 * `relaxIsolatedCells` (avant tout appel solveur), le plateau ici est déjà
 * confirmé unique — hors de question de rouvrir une case, ça changerait
 * l'espace des solutions et invaliderait la preuve d'unicité déjà obtenue.
 * Convertir en VOID, à l'inverse, est prouvé sûr SANS re-vérification
 * solveur : une case isolée morte n'a par définition aucun voisin indice
 * (rien ne dépend de sa lumière) et ne peut illuminer ni être illuminée par
 * aucune autre case (tous ses voisins sont opaques) — la retirer du plateau
 * ne change ni la validité ni l'unicité de la solution pour le reste de la
 * grille. Coût : une seule passe O(lignes×colonnes), aucun appel solveur.
 */
function neutralizeDeadIsolatedCells(layout, rows, cols) {
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (layout[r][c] !== ".") continue;
      if (!isIsolatedEmptyCell(layout, r, c, rows, cols)) continue;
      const hasClue = orthogonalNeighbors(r, c, rows, cols).some(([nr, nc]) => isClueToken(layout[nr][nc]));
      if (!hasClue) layout[r][c] = "X";
    }
}

function tryGenerate(seed, stars, enabledFeatureKeys, deadline) {
  const preset = DIFFICULTY_PRESETS[stars];
  const solverTarget = SOLVER_TIER_FOR_STARS[stars];
  const rand = seededRandom(seed);

  const rows = pickInt(rand, preset.rowsRange);
  const cols = pickInt(rand, preset.colsRange);
  const clueDensity = pickFloat(rand, preset.initialClueDensity);
  const cornerVoid = pickInt(rand, preset.cornerVoidRange);

  const featureSubset = pickFeatureSubset(rand, enabledFeatureKeys, preset.budget);
  const useForbidden = featureSubset.includes("forbidden");
  const wantsColor = featureSubset.includes("color");
  // `pickFeatureSubset` garantit déjà que "mirror" n'est retenu que si
  // "color" l'est AUSSI pour CET essai précis (voir son commentaire) — un
  // miroir sans aucune charge colorée ne dévierait jamais rien.
  const wantsMirror = featureSubset.includes("mirror");

  const layout = buildInitialLayout({
    rows,
    cols,
    clueDensity,
    cornerVoid,
    mirrorDensity: wantsMirror ? MIRROR_DENSITY : 0,
    rand,
  });
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
    const colorAnalysis = tryColorizeForNecessity(
      layout,
      rows,
      cols,
      analysis.solution,
      rand,
      preset,
      stars,
      deadline,
      wantsMirror
    );
    if (colorAnalysis) {
      finalAnalysis = colorAnalysis;
      colorApplied = true;
    }
  }

  // Phase 3 (Miroir dévieur) : aucune tentative supplémentaire à faire ici —
  // les miroirs sont déjà posés (buildInitialLayout) et déjà pris en compte
  // par la Phase 2 (recompute() les traite nativement). Reste seulement à
  // vérifier, en best-effort comme la couleur, qu'au moins un a VRAIMENT été
  // traversé par un laser dans la solution gagnante — sinon la feature n'est
  // pas honnêtement "obtenue" pour cet essai (voir mirrorGenuinelyUsed).
  const mirrorApplied = wantsMirror && colorApplied && mirrorGenuinelyUsed(layout, rows, cols, finalAnalysis.solution);

  // Retour utilisateur ("beaucoup de miroirs pour rien, c'est polluant") :
  // que `mirrorApplied` soit vrai ou faux, tout miroir posé mais jamais
  // traversé par un laser dans LA solution gagnante finale est retiré (voir
  // pruneUnusedMirrors) — sinon il reste sur le plateau comme pur décor,
  // jamais nettoyé par aucune passe précédente.
  if (wantsMirror) pruneUnusedMirrors(layout, rows, cols, finalAnalysis.solution);

  const actualFeatureSubset = featureSubset.filter((k) => {
    if (k === "color") return colorApplied;
    if (k === "mirror") return mirrorApplied;
    return true;
  });

  neutralizeDeadIsolatedCells(layout, rows, cols);

  return { rows, cols, cells: layoutToRows(layout), analysis: finalAnalysis, featureSubset: actualFeatureSubset };
}

/**
 * Compare deux candidats déjà générés et retourne le meilleur selon l'ordre
 * de préférence de la Phase F (section 4/10 du doc) : solution unique avant
 * tout, puis palier de difficulté mesuré aussi proche que possible du palier
 * demandé, puis — si `preferColor` (voir `generateLevel`, la couleur a été
 * cochée par le joueur) — la présence de couleur à palier égal, puis — si
 * `preferMirror` (même principe, voir Phase 3 Miroir) — la présence d'un
 * miroir RÉELLEMENT utilisé à palier ET couleur égaux, puis (à tout le reste
 * égal, imparfait) un `branchCount` qui pousse dans la direction demandée.
 */
export function isBetterCandidate(a, b, requestedTier, preferColor = false, preferMirror = false) {
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

  if (preferMirror) {
    const aMirror = a.featureSubset?.includes("mirror") ?? false;
    const bMirror = b.featureSubset?.includes("mirror") ?? false;
    if (aMirror !== bMirror) return bMirror;
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
  const mirrorRequested = Array.isArray(enabledFeatureKeys) && enabledFeatureKeys.includes("mirror");
  const defaultBudget = getGenerationBudget(stars);
  // Voir COLOR_BUDGET_MULTIPLIER: viser À LA FOIS le bon palier ET une
  // couleur nécessaire est un objectif combiné plus dur qu'un seul des deux
  // (voir le critère `isPerfect` ci-dessous, qui n'accepte plus l'un sans
  // l'autre quand la couleur est demandée) — élargi pour que ça reste rare
  // d'échouer sur la couleur plutôt que de réduire le budget effectif.
  // MIRROR_BUDGET_MULTIPLIER vaut 1 (aucun effet) par choix : voir son
  // commentaire — le miroir n'entre PAS dans `isPerfect`, la fréquence
  // visée passe par MIRROR_DENSITY plutôt que par un budget de temps élargi.
  const budgetMultiplier = (colorRequested ? COLOR_BUDGET_MULTIPLIER : 1) * (mirrorRequested ? MIRROR_BUDGET_MULTIPLIER : 1);
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
    // trouver mieux ou épuiser le budget. Le miroir, lui, N'entre PAS dans
    // ce critère (voir MIRROR_DENSITY/MIRROR_BUDGET_MULTIPLIER pour le
    // pourquoi) — il reste un bonus opportuniste, jamais un motif de
    // prolonger la recherche.
    const isPerfect = measuredTier === solverTarget && (!colorRequested || candidate.featureSubset.includes("color"));
    if (isPerfect) {
      best = candidate;
      break;
    }
    if (isBetterCandidate(best, candidate, solverTarget, colorRequested, mirrorRequested)) best = candidate;
  }

  if (!best) return null; // n'arrive que si même le fallback échoue à générer une forme jouable

  best.measuredTier = starsForSolverTier(best.measuredTier); // palier solveur -> étoiles affichées
  best.requestedTier = stars;
  best.level.starThresholds = [best.solution.length, Math.ceil(best.solution.length * 1.5)];
  best.attemptsUsed = attempts;
  best.timeMs = Date.now() - start;
  return best;
}
