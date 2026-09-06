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
  // Round 27 (retour utilisateur): "les éléments à charge sont des
  // neurones" — seul `label` (texte affiché sur la tuile du mode Infini)
  // est retouché ici, la clé `color`/le mot "charge" ailleurs dans ce
  // fichier restent des noms INTERNES inchangés (voir main.js:
  // MECHANIC_SCHEMAS pour le même principe côté texte de règles).
  color: { label: "Couleur (neurones + cibles)", weight: 3, implemented: true, pickProbability: 0.95 },
  // pickProbability élevée (comme color) : voir generateLevel/isPerfect — la
  // boucle s'arrête dès le premier essai qui atteint le bon palier ET la
  // couleur, SANS jamais comparer d'essais ultérieurs via isBetterCandidate
  // (qui ne s'exécute qu'en cas d'échec de isPerfect) — donc la seule vraie
  // façon d'augmenter la fréquence du miroir gratuitement (sans budget de
  // recherche dédié) est de maximiser la chance qu'il soit DÉJÀ tiré sur CET
  // essai précis, pas de compter sur une comparaison ultérieure qui
  // n'arrive presque jamais en pratique.
  mirror: { label: "Miroir dévieur", weight: 2, implemented: true, requires: "color", pickProbability: 0.92 },
  // "filter" (round 22, retour utilisateur: "supprime [...] la feature
  // filtre, on ne l'utilise pas") retiré ici — n'a jamais été implémenté
  // (implemented: false, aucun niveau seed/histoire ne s'en sert), sans
  // impact sur le solveur/générateur qui n'en avaient de toute façon aucune
  // logique réelle.
  // Câblé au générateur (placePrisms/prismGenuinelyUsed/pruneUnusedPrisms,
  // voir leurs commentaires) — même politique que Miroir/Pyra: `requires:
  // "color"` reste nécessaire car un prisme colore les lumières à sa portée
  // (voir grid.js) mais ça n'a d'effet observable QUE si une cible couleur
  // existe pour distinguer les solutions selon cette teinte — sans Couleur,
  // aucune cible n'existe jamais, un prisme resterait donc toujours
  // purement décoratif, exactement comme Miroir. `pickProbability` élevée
  // pour la même raison que Miroir/Pyra (voir leurs commentaires) :
  // maximiser la chance d'être piochée sur LE MÊME essai qui obtient déjà
  // Couleur, seule façon gratuite d'augmenter sa fréquence sans budget de
  // recherche dédié.
  prism: { label: "Prisme", weight: 3, implemented: true, requires: "color", pickProbability: 0.92 },
  // `requires: "color"` (retour utilisateur : "ce qu'on veut c'est un
  // dilemme de COULEUR sur le Pyra", pas juste un dilemme sur son propre
  // compte — voir `pruneUnnecessaryPyra`, dont le SEUL critère de survie
  // est désormais "son laser est-il nécessaire à une cible couleur ?").
  // Sans Couleur, aucune cible n'existe jamais pour dépendre de ce laser :
  // un "Y" y démote donc TOUJOURS en charge numérique normale, par
  // construction — cocher Pyra sans Couleur ne produirait jamais rien,
  // exactement comme Miroir/Filtre/Prisme. `pickProbability` élevée pour la
  // même raison que Miroir (voir son commentaire) : maximiser la chance
  // d'être piochée sur LE MÊME essai qui obtient déjà Couleur, seule façon
  // gratuite d'augmenter sa fréquence sans budget de recherche dédié.
  pyra: { label: "Pyra", weight: 3, implemented: true, requires: "color", pickProbability: 0.92 },
  // Câblé au générateur (placeMirrorNeurons/mirrorNeuronGenuinelyUsed/
  // pruneUnusedMirrorNeurons, voir leurs commentaires) — `implemented: true`
  // active désormais la feature en mode Infini, exactement comme Miroir/Pyra
  // avant elle (voir main.js: infiniteEnabledFeatures, déjà entièrement
  // câblé côté UI/tuto pour cette clé, aucun changement nécessaire là-bas).
  // Aucune dépendance à `color` (contrairement à Miroir/Pyra) : un neurone
  // miroir réagit à N'IMPORTE QUELLE lumière, jamais seulement aux lasers
  // colorés (voir grid.js) — il a donc un effet réel même seul. Le libellé
  // "[expérimental]" est volontairement CONSERVÉ pour l'instant: cette
  // intégration n'a pu être vérifiée que par lecture statique + scripts Node
  // autonomes (aucun navigateur disponible dans cet environnement pour un
  // vrai test de jeu, voir historique) — à retirer une fois confirmé solide
  // en conditions réelles.
  mirrorNeuron: { label: "Neurone miroir [expérimental]", weight: 5, implemented: true },
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
// Palier solveur maximum (voir solver.js `computeTier`, qui ne retourne
// jamais plus que 4) — utilisé par `stripToTargetTier` pour savoir quand il
// est sûr de continuer à minimiser AU-DELÀ du premier succès plutôt que de
// s'arrêter dès la cible atteinte (voir son commentaire : retour utilisateur
// "les niveaux 3★ sont pas assez difficiles").
const MAX_SOLVER_TIER = 4;

// Retour utilisateur: "je pense que notre façon d'implémenter [Prisme, Pyra,
// Neurone miroir] rend la grille plus facile que si elles n'y étaient pas,
// car ces mécaniques ajoutent en complexité mais aussi en indices
// possibles." Constat exact : `computeTier`/le palier solveur mesurent la
// difficulté de RECHERCHE d'un solveur qui ne fait AUCUNE différence entre
// une case indice ordinaire et l'une de ces trois mécaniques — mais pour un
// JOUEUR humain, chacune fonctionne comme un indice "gratuit" en plus de son
// obstacle: un Neurone miroir DUPLIQUE une lumière déjà déduite (l'humain
// lit l'écho au lieu de re-déduire), un Pyra RÉVÈLE une fourchette de compte
// (1-3) sans qu'aucune charge n'ait besoin d'être posée là pour l'obtenir,
// un Prisme RÉVÈLE une couleur qui, une fois vue, élimine d'un coup toutes
// les hypothèses de placement qui l'auraient rendue différente. Le palier
// mesuré (calibré sur des plateaux SANS ces mécaniques) ne capture donc pas
// cet allègement perçu.
//
// Compensation choisie: une fois qu'au moins une de ces trois features a
// survécu jusqu'au bout (mirrorNeuronApplied/prismApplied/pyraApplied
// CONFIRMÉS, après toute passe de nécessité — jamais avant), retirer des
// charges numériques SUPPLÉMENTAIRES pour viser UN CRAN de plus
// (ASSISTIVE_MECHANIC_TIER_BONUS) que le palier de base déjà atteint —
// PAS le maximum théorique (`MAX_SOLVER_TIER`) : l'idée est de compenser
// l'indice gratuit, pas de transformer systématiquement un "1★ avec Pyra"
// en un niveau aussi dur qu'un 3★ vanille (mesuré : viser directement
// MAX_SOLVER_TIER produisait des sauts de 1★ à 3★ selon la chance du
// plateau à se laisser dépouiller, bien au-delà du "cran de plus" voulu).
//
// PREMIÈRE tentative (abandonnée, gardée en note pour ne pas la retenter) :
// viser un palier solveur plus élevé DÈS `stripToTargetTier` (avant même
// repair/color/pruning) dès que la feature était PIOCHÉE pour cet essai.
// Mesuré cassé : `pickProbability` élevée (0.92, voir FEATURES) sur ces
// trois features fait qu'un essai les pioche très souvent, mais
// `pruneUnnecessaryPyra`/`pruneUnusedMirrorNeurons`/`pruneUnusedPrisms` en
// retirent une bonne partie comme décoratives APRÈS coup — le plateau final
// se retrouvait alors durci pour une mécanique qui n'y figurait même plus,
// y compris des essais totalement "vanille" (aucune des trois) qui n'ont
// jamais reçu la moindre part de la compensation. En agissant seulement
// APRÈS confirmation de survie, jamais de durcissement gaspillé ni mal
// attribué.
//
// Miroir dévieur et Couleur ne sont volontairement PAS concernés: ils ne
// révèlent jamais un état de la grille qu'il faudrait sinon déduire — un
// miroir ne fait que rediriger un laser déjà existant (aucune information
// nouvelle sur les LUMIÈRES elles-mêmes), et la couleur seule EST la
// difficulté ajoutée (voir tryColorizeForNecessity: toujours vérifiée
// nécessaire), pas un raccourci vers elle.
const ASSISTIVE_MECHANIC_KEYS = ["pyra", "mirrorNeuron", "prism"];
const ASSISTIVE_MECHANIC_TIER_BONUS = 1;

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
    // Retour utilisateur : +2 lignes (pas colonnes) pour un format plus
    // vertical/mobile — voir le paragraphe ci-dessus sur le plafond ~80
    // cellules, qu'un sweep empirique antérieur avait établi pour la
    // LATENCE (pas la forme). Ce plafond monte donc mécaniquement à ~96
    // cellules (12×8) pour ce palier — revalidé après coup (voir le
    // commit qui a introduit ce changement pour les temps mesurés).
    rowsRange: [11, 12],
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

// Phase Pyra (voir grid.js pour la mécanique complète: activé dès 1 lumière
// adjacente, jusqu'à 3 — surcharge à 4 comme une charge classique). À la
// différence du Miroir (case fixe posée AVANT tout appel solveur, jamais
// dérivée) et de la Couleur (recherche dédiée de solutions alternatives),
// Pyra se greffe directement dans `resolveAndDeriveClues` — la même passe
// qui dérive déjà le nombre de chaque charge classique depuis une solution
// gloutonne fraîche (voir `greedySolve`): parmi les cases candidates "W",
// un TOUT PETIT sous-ensemble est choisi une seule fois (voir
// `pickPyraCandidates`, juste après `buildInitialLayout`) comme "éligible
// Pyra" — mais chaque case éligible ne devient RÉELLEMENT "Y" QUE si son
// compte réel de lumières adjacentes, dans la solution gloutonne DE CET
// APPEL précis, tombe dans la plage valide [1,3] ; sinon elle retombe sur
// la dérivation normale (charge classique ou case interdite/void),
// exactement comme un candidat non-éligible. Un "Y" commité est donc
// TOUJOURS valide par construction pour la solution qui vient de le
// produire (jamais de surcharge/case morte figée par erreur) — et comme
// toute case candidate, elle reste "vivante" (re-dérivée, potentiellement
// re-testée pour l'éligibilité Pyra) à chaque nouvel appel de
// `resolveAndDeriveClues` (typiquement après qu'un nouveau mur soit posé
// par `repairToUnique`), SAUF si elle tombe un jour à 0 lumière adjacente:
// elle est alors voidée DÉFINITIVEMENT comme n'importe quelle charge
// classique (voir le commentaire de `resolveAndDeriveClues`, ce n'est pas
// spécifique à Pyra).
//
// Retour utilisateur explicite (après une première version qui en plaçait
// beaucoup trop, ET dont le nettoyage confondait "nécessaire comme simple
// obstacle" et "nécessaire comme mécanique Pyra" — voir le commentaire de
// `pruneUnnecessaryPyra` pour le détail): "je trouve toujours la plupart des
// pyra (voire tous) inutiles en tant que Pyra [...] ils sont utiles en tant
// que Neurone, mais ni en tant que Pyra (devoir faire un choix pour la
// couleur) ni en tant que couleur". Corrigé en deux volets :
//   1. Un nombre de candidats initialement borné (voir `PYRA_MAX_CANDIDATES`,
//      un compte fixe plutôt qu'une densité) — aucun risque de devoir
//      retirer après coup un Pyra qui se révélerait NÉCESSAIRE (voir point
//      2 : un retrait après coup casserait potentiellement l'unicité déjà
//      garantie).
//   2. Un nettoyage de NÉCESSITÉ (voir `pruneUnnecessaryPyra`, appelé en fin
//      de `tryGenerate` comme `pruneUnusedMirrors`) — REDÉFINI depuis (voir
//      son commentaire) pour ne garder QUE le rôle couleur : un "Y" qui
//      survit ce nettoyage est TOUJOURS nécessaire à UNE CIBLE COULEUR
//      précise, jamais juste "nécessaire" au sens générique du terme. Ce
//      critère strict est ce qui permet de relever `PYRA_MAX_CANDIDATES`
//      sans risque (voir son commentaire) : plus de candidats en jeu ne
//      peut jamais réintroduire de Pyra décoratif, seulement augmenter la
//      chance d'en trouver un ou plusieurs RÉELLEMENT nécessaires.
//
// Volontairement appliqué sur les candidats "W" au hasard (contrairement à
// `placeAlignedMirrors`, qui biaise vers l'alignement pour maximiser les
// chances qu'un laser coloré traverse effectivement le miroir): la richesse
// du dilemme de couleur repose entièrement sur `pruneUnnecessaryPyra` (le
// SEUL filtre qui compte désormais) et sur le biais de retrait
// `PYRA_PROXIMITY_RADIUS` ci-dessous (qui, lui, coordonne activement avec la
// Phase 2 Couleur) — le PLACEMENT initial n'a donc besoin d'aucune
// coordination géométrique propre.
// Retour utilisateur (mesuré : 36% des niveaux 3★+couleur+miroir+pyra
// avaient au moins un Pyra survivant, TOUJOURS exactement 1 — jamais 2 ni
// 3 — malgré ce plafond déjà à 3) : "pas assez de niveaux générés avec
// pyra... et pas assez de pyras". Relevé de 3 à 5 : chaque candidat a une
// chance INDÉPENDANTE d'être confirmé nécessaire par `pruneUnnecessaryPyra`
// (voir son commentaire, critère désormais strict — couleur uniquement),
// donc plus de candidats en jeu augmente mécaniquement (a) la probabilité
// qu'AU MOINS un survive et (b) la probabilité d'en avoir PLUSIEURS sur le
// même plateau.
const PYRA_MAX_CANDIDATES = 5;
// Rayon (distance de Manhattan) utilisé UNIQUEMENT par la Phase 2 (Couleur,
// voir `orderCluesForRemoval`) pour biaiser QUELLES charges retirer/rouvrir
// en priorité — ne contredit pas le paragraphe ci-dessus sur le PLACEMENT du
// Pyra (toujours au hasard pur, aucune coordination géométrique à la pose).
// But : `pruneUnnecessaryPyra` ne garde désormais un "Y" QUE si son laser
// est nécessaire à une cible couleur (voir son commentaire) — mais la
// Couleur choisit quoi retirer/coloriser sans savoir qu'un Pyra existe à
// proximité, donc cette dépendance n'apparaît souvent que par accident. En
// rouvrant en priorité les charges proches d'un Pyra, l'ambiguïté blanche
// rouverte a plus de chances de faire varier le compte de lumières
// adjacentes AU Pyra lui-même entre solutions candidates — condition
// nécessaire (pas suffisante) pour que `tryDiscriminatingColoring`, déjà
// générique sur la source du signal coloré, choisisse une cible qui dépend
// réellement de sa couleur. 2 cases : assez large pour couvrir les indices
// qui contraignent typiquement le compte de lumières d'un Pyra (voisins
// directs ET voisins-de-voisins), assez restreint pour rester un biais
// local plutôt qu'un retrait
// quasi-global.
const PYRA_PROXIMITY_RADIUS = 2;
// Retour utilisateur (capture d'écran d'un niveau généré) : "le Pyra en haut
// n'a qu'une case libre autour donc c'est évident". Un Pyra dont le nombre
// de lumières adjacentes possibles n'a que 2 issues (0 ou 1, s'il n'a qu'UN
// SEUL voisin orthogonal encore vide "." au moment du placement — voir
// `pickPyraCandidates`) réduit tout "dilemme couleur" à un choix binaire
// quasi gratuit, souvent déjà tranché par la géométrie locale (coin/bord de
// grille + voisins déjà pleins) avant même de raisonner sur le reste du
// plateau. Filtré dès la SÉLECTION des candidats plutôt qu'au nettoyage de
// nécessité (`pruneUnnecessaryPyra`) : ce dernier teste "y a-t-il vraiment
// ambiguïté ?", pas "l'espace des réponses possibles est-il assez riche
// pour que trancher demande un minimum de raisonnement ?" — deux questions
// différentes, qu'un seul mécanisme ne peut pas trancher correctement.
//
// Relevé de 2 à 3 (nouveau retour utilisateur : "le Pyra agit comme un
// simple neurone coloré, une seule possibilité lisible de poser les
// lumières") — mesuré : avec le seuil à 2, 62% des Pyra survivants (15/24,
// 17 niveaux échantillonnés) n'avaient QUE 2 voisins libres au plateau
// final, donc au mieux un choix binaire neutre/rouge — jamais vert ni bleu
// atteignable (2 voisins ⇒ compte adjacent ∈ {0,1,2}, la palette complète
// {0,1,2,3} exige 3 voisins simultanément allumables — aucun conflit
// "lumières qui se voient" entre eux, ce sont tous des voisins directs du
// Pyra, jamais entre eux). Passer à 3 rend donc la palette complète
// (neutre/rouge/vert/bleu) structurellement atteignable, pas juste binaire.
const PYRA_MIN_FREE_NEIGHBORS = 3;
// Volontairement 1 (aucun effet) : voir le commentaire ci-dessus — le
// miroir ne doit plus jamais coûter de recherche supplémentaire, sa
// fréquence repose entièrement sur le placement/la sélection biaisés, pas
// sur un budget de temps élargi. Gardé (plutôt que supprimé) pour rester
// symétrique avec COLOR_BUDGET_MULTIPLIER et réutilisable si jamais un futur
// réglage en avait de nouveau besoin.
const MIRROR_BUDGET_MULTIPLIER = 1;

// Neurone miroir [expérimental] : nombre de neurones posés PAR ESSAI quand la
// feature est piochée (voir FEATURES.mirrorNeuron) — volontairement un
// COMPTE fixe, comme PYRA_MAX_CANDIDATES, pas une densité par case comme
// MIRROR_DENSITY: un neurone contraint TOUTE sa ligne ET TOUTE sa colonne
// (aucune ligne de vue requise, voir grid.js), donc en poser plusieurs
// multiplie vite les réactions en chaîne et le risque qu'une case cible de
// duplication tombe hors-grille/illégale (voir placeMirrorNeurons) — ce qui
// ne casse jamais la CORRECTION de la génération (resolveAndDeriveClues/
// repairToUnique échouent proprement sur une forme dégénérée et l'essai est
// simplement retenté avec un nouveau seed, voir generateLevel) mais fait
// grimper le taux d'essais gâchés. Fixé à 1 comme point de départ prudent
// (poids déjà le plus élevé de FEATURES, voir son commentaire) — à ajuster
// plus tard si mesuré trop rare une fois du recul pris sur des parties
// réelles, comme MIRROR_DENSITY/PYRA_MAX_CANDIDATES avant lui.
const MIRROR_NEURON_COUNT = 1;

// Prisme : nombre de prismes posés PAR ESSAI quand la feature est piochée
// (voir FEATURES.prism) — même compte fixe prudent que MIRROR_NEURON_COUNT
// plutôt qu'une densité par case: un prisme scanne dans ses 4 directions
// fixes jusqu'au premier obstacle (voir grid.js `_scanRangeForLight`), donc
// en poser plusieurs multiplie le risque qu'une portée tombe hors-grille ou
// dégénère la forme sans rien gagner en pratique (repairToUnique/
// stripToTargetTier retentent de toute façon proprement avec un nouveau
// seed sur toute forme dégénérée, voir generateLevel) — juste un facteur de
// taux d'essais gâchés, pas de correction. À ajuster plus tard une fois du
// recul pris sur des parties réelles, comme MIRROR_NEURON_COUNT avant lui.
const PRISM_COUNT = 1;

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
 *
 * `mirrorNeuronCount` (0 si la feature Neurone miroir n'est pas demandée
 * pour cet essai) : nombre de neurones miroirs (voir `placeMirrorNeurons`)
 * posés sur des cases vides biaisées vers le centre du plateau. Contrairement
 * au Miroir dévieur, aucune dépendance à la couleur — un neurone réagit à
 * N'IMPORTE QUELLE lumière (voir grid.js) — donc rien à coordonner avec la
 * Phase 2 ici ; la légitimité ("au moins un neurone réellement traversé
 * lors de la résolution") est elle aussi vérifiée a posteriori dans
 * `tryGenerate` (voir `mirrorNeuronGenuinelyUsed`).
 */
function buildInitialLayout({ rows, cols, clueDensity, cornerVoid, mirrorDensity, mirrorNeuronCount, prismCount, rand }) {
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
  // Voir placeMirrorNeurons : posé APRÈS le Miroir dévieur (les deux ne
  // touchent que des cases encore "." donc l'ordre entre eux n'a pas
  // d'importance en soi) mais AVANT relaxIsolatedCells/mergeSmallIslands,
  // pour que ces deux passes traitent déjà les neurones comme des obstacles
  // fixes (voir isFixedObstacleToken) au moment de choisir quoi rouvrir.
  if (mirrorNeuronCount > 0) placeMirrorNeurons(layout, rows, cols, mirrorNeuronCount, rand);
  // Voir placePrisms : posé après Miroir/Neurone miroir (aucun des trois ne
  // touche que des cases encore "." donc l'ordre entre eux n'a pas
  // d'importance en soi) mais AVANT relaxIsolatedCells/mergeSmallIslands,
  // pour la même raison que le Neurone miroir juste au-dessus — ces deux
  // passes doivent déjà traiter les prismes comme des obstacles fixes (voir
  // isFixedObstacleToken) au moment de choisir quoi rouvrir.
  if (prismCount > 0) placePrisms(layout, rows, cols, prismCount, rand);
  // Voir relaxIsolatedCells : le remplissage ci-dessus tire chaque case
  // indépendamment, ce qui peut par pur hasard entourer une case vide sur
  // ses 4 côtés — cette passe répare les cas vraiment inutiles et plafonne
  // les autres, AVANT tout appel solveur (donc sans risque pour l'unicité
  // et sans coût de recalcul).
  relaxIsolatedCells(layout, rows, cols, rand);
  // Voir mergeSmallIslands : relaxIsolatedCells ne traite QUE les cases
  // isolées à UN SEUL élément — un remplissage indépendant par case
  // ("." avec probabilité 1-clueDensity, ~58-68%) est mathématiquement en
  // dessous du seuil de percolation d'un maillage carré (~59.3%), donc les
  // cases vides forment presque toujours une "poussière" de PLUSIEURS
  // petites poches déconnectées, pas juste des cellules isolées uniques.
  mergeSmallIslands(layout, rows, cols, rand, ISLAND_MERGE_THRESHOLD);
  // Voir reopenDoomedWalls : dernière passe avant de rendre la main, une
  // fois la forme définitivement fixée par tout ce qui précède (miroirs/
  // neurones/prismes posés, îlots fusionnés) — repère les "W" voués au VOID
  // dès leur toute première dérivation et les rouvre pendant qu'il est
  // encore gratuit de le faire (aucun appel solveur n'a encore eu lieu).
  reopenDoomedWalls(layout, rows, cols, rand);
  return layout;
}

/**
 * Repère les cases "W" du remplissage qui, une fois la grille résolue,
 * n'ont AUCUNE lumière adjacente — donc vouées à devenir un VOID pur dès
 * leur toute première dérivation (voir resolveAndDeriveClues: count===0 ->
 * "X", sauf `useForbidden` qui donne "0" à la place) — et les rouvre
 * directement en "." AVANT que quoi que ce soit d'autre (repairToUnique,
 * stripToTargetTier) ne s'appuie sur ce layout. Un mur qui ne comptera
 * jamais rien n'a aucune utilité comme mur : mieux vaut ne jamais le poser
 * que le laisser devenir un trou plus tard.
 *
 * Retour utilisateur ("il y a un peu trop de void dans les grilles
 * générées") : la cause principale est ici — un remplissage "W" tiré
 * indépendamment case par case (voir la boucle ci-dessus) place forcément,
 * par pur hasard, des murs trop loin de toute lumière. Trois pistes ont été
 * comparées empiriquement (12 seeds/palier, sans mécanique) avant de
 * choisir celle-ci : une répartition "bruit bleu" du remplissage initial
 * réduit le void mais moins bien (~15% au lieu de ~10-12% ici) et coûte
 * plus cher en temps ; un tie-break anti-void au moment de choisir le
 * meilleur essai (`isBetterCandidate`) s'est révélé inefficace dès 2★ —
 * `generateLevel` s'arrête presque toujours au tout premier essai qui
 * atteint le palier visé, donc il n'existe quasiment jamais plusieurs
 * candidats "également bons" entre lesquels départager sur le void. Cette
 * réparation préventive, elle, agit avant même qu'un palier soit en jeu :
 * void moyen mesuré 1★ 13.2%→5.8%, 2★ 20.6%→9.6%, 3★ 21.9%→12.4%, sans
 * perte de difficulté (branchCount inchangé ou même supérieur en 3★:
 * 182→216) et pour un coût quasi nul (un seul solve glouton
 * supplémentaire, pas un appel solveur complet — voir greedySolve).
 *
 * Ne touche qu'aux "W" (jamais aux miroirs/neurones miroirs/prismes, déjà
 * posés comme obstacles fixes à ce stade — voir isFixedObstacleToken — ni
 * au cornerVoid "X", déjà un vide assumé). Repasse relaxIsolatedCells/
 * mergeSmallIslands si au moins une case a été rouverte, pour rattraper
 * toute case qui se retrouverait isolée suite à ces réouvertures — exactement
 * la même politique de nettoyage que le reste de buildInitialLayout.
 */
function reopenDoomedWalls(layout, rows, cols, rand) {
  const { grid } = greedySolve(layoutToRows(layout), rows, cols);
  const toOpen = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (layout[r][c] !== "W") continue;
      let count = 0;
      for (const [dr, dc] of DIRECTIONS) {
        const nCell = grid.cellAt(r + dr, c + dc);
        if (nCell && nCell.type === CellType.EMPTY && grid.hasLight(r + dr, c + dc)) count++;
      }
      if (count === 0) toOpen.push([r, c]);
    }
  }
  if (toOpen.length === 0) return;
  for (const [r, c] of toOpen) layout[r][c] = ".";
  relaxIsolatedCells(layout, rows, cols, rand);
  mergeSmallIslands(layout, rows, cols, rand, ISLAND_MERGE_THRESHOLD);
}

// Retour utilisateur ("il y a toujours un peu trop d'îlots (ilot = une
// sous-zone détachée du puzzle par les voids, très facile a résoudre et
// qui n'apporte pas grand chose voire rien)") — mesuré avant ce correctif :
// en moyenne 6.15 composantes connexes de cases vides PAR NIVEAU généré
// (20 niveaux 1-3★, color+mirror+pyra+forbidden), la plupart minuscules
// (80 composantes de taille <=4 sur seulement 20 niveaux). Seuil de taille
// (pas juste "existe-t-il plusieurs composantes ?") : une petite poche de
// 1 à 5 cases est presque toujours triviale à déduire isolément (peu ou
// pas d'ambiguïté possible sur si peu de cases) et n'ajoute donc rien au
// défi d'ensemble — une composante secondaire plus grande (10+ cases avec
// ses propres indices) reste, elle, un sous-puzzle légitime, pas fusionnée.
const ISLAND_MERGE_THRESHOLD = 6;

/** Toutes les composantes connexes (4-adjacence) de cases "." du plateau —
 * simple flood-fill, voir `mergeSmallIslands`. Chaque composante est la
 * liste de ses coordonnées `[[r,c], ...]`. */
function findConnectedEmptyComponents(layout, rows, cols) {
  const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const components = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (seen[r][c] || layout[r][c] !== ".") continue;
      const stack = [[r, c]];
      seen[r][c] = true;
      const cells = [];
      while (stack.length) {
        const [cr, cc] = stack.pop();
        cells.push([cr, cc]);
        for (const [nr, nc] of orthogonalNeighbors(cr, cc, rows, cols)) {
          if (layout[nr][nc] === "." && !seen[nr][nc]) {
            seen[nr][nc] = true;
            stack.push([nr, nc]);
          }
        }
      }
      components.push(cells);
    }
  return components;
}

/**
 * Fusionne EN PLACE les composantes connexes de cases vides plus petites que
 * `threshold` avec un voisin — voir `ISLAND_MERGE_THRESHOLD` pour le retour
 * utilisateur qui motive cette passe. Même logique de reconnexion que
 * `relaxIsolatedCells` (rouvre un voisin opaque de la composante, JAMAIS un
 * miroir — placé intentionnellement, voir son commentaire — avec préférence
 * pour un "W" plutôt qu'un "X" de coin pour préserver le découpage
 * `cornerVoid` autant que possible), généralisée à une composante entière
 * plutôt qu'une seule case.
 *
 * Tourne jusqu'à POINT FIXE : recalcule les composantes après CHAQUE fusion
 * (une fusion peut faire grandir une composante jusqu'à dépasser le seuil,
 * ou au contraire n'en fusionner que deux petites entre elles — encore trop
 * petites toutes les deux, à retenter au tour suivant) plutôt qu'une seule
 * passe sur un instantané figé. Termine forcément : chaque fusion réduit
 * strictement le nombre de composantes (ou la boucle s'arrête faute de
 * frontière réparable, ex. composante entourée uniquement de miroirs) ;
 * `rows*cols` reste une borne large mais sûre sur le nombre d'itérations.
 * Coût : flood-fill pur (comme `relaxIsolatedCells`), appelé au même
 * moment (avant tout appel solveur) — aucun risque pour une unicité qui
 * n'existe pas encore à ce stade.
 */
function mergeSmallIslands(layout, rows, cols, rand, threshold) {
  const maxIter = rows * cols;
  for (let iter = 0; iter < maxIter; iter++) {
    const components = findConnectedEmptyComponents(layout, rows, cols);
    let merged = false;
    for (const comp of components) {
      if (comp.length >= threshold) continue;
      const boundary = [];
      for (const [r, c] of comp) {
        for (const [nr, nc] of orthogonalNeighbors(r, c, rows, cols)) {
          if (layout[nr][nc] !== "." && !isFixedObstacleToken(layout[nr][nc])) boundary.push([nr, nc]);
        }
      }
      if (boundary.length === 0) continue; // rien à faire pour celle-ci (ex: cernée de miroirs): essaie la suivante
      const wBoundary = boundary.filter(([r, c]) => layout[r][c] === "W");
      const pool = wBoundary.length > 0 ? wBoundary : boundary;
      const [nr, nc] = pool[Math.floor(rand() * pool.length)];
      layout[nr][nc] = ".";
      merged = true;
      break; // composantes changées: on repart d'un flood-fill frais au tour suivant
    }
    if (!merged) return; // plus aucune petite composante réparable
  }
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

/** Distance (Manhattan, par axe) de (r,c) au bord le plus proche du plateau
 * — voir `placeMirrorNeurons` : un neurone miroir duplique une lumière en
 * symétrie centrale PAR RAPPORT À LUI-MÊME (même distance, direction
 * opposée, voir grid.js `_computeMirrorDuplicates`), donc plus une case est
 * proche d'un bord, moins elle a de place de l'autre côté pour que cette
 * duplication reste légale — une case posée en plein bord rejetterait quasi
 * systématiquement toute lumière de sa ligne/colonne (case cible hors
 * grille), ce qui revient à interdire toute lumière sur toute cette
 * ligne/colonne. Score, pas simple filtre : préfère les cases centrales
 * sans les exiger absolument (utile sur les petits plateaux 1★, où peu de
 * cases atteindraient une marge confortable en valeur absolue). */
function centralityScore(r, c, rows, cols) {
  return Math.min(r, rows - 1 - r) + Math.min(c, cols - 1 - c);
}

/**
 * Pose au plus `count` neurones miroirs sur des cases "." (jamais "W",
 * comme `placeAlignedMirrors` — laisse les candidats indice disponibles),
 * biaisées vers le centre du plateau (voir `centralityScore`) plutôt qu'un
 * tirage uniforme. Contrairement au Miroir dévieur (aligné avec un
 * candidat indice pour maximiser les chances d'être traversé par un
 * laser COLORÉ), l'alignement avec un futur indice n'est PAS ce qui compte
 * ici : un neurone réagit à N'IMPORTE QUELLE lumière de sa ligne/colonne,
 * sans ligne de vue ni dépendance à la couleur (voir grid.js) — ce qui
 * compte est la place disponible DE PART ET D'AUTRE DE SA PROPRE POSITION
 * pour que ses futures duplications aient une réelle chance d'être légales.
 *
 * Tirés parmi le tiers le plus central des cases éligibles (mélangé, pour
 * ne pas toujours retomber pile au centre géométrique d'un essai à
 * l'autre) plutôt que les `count` cases strictement les plus centrales :
 * garde un peu de variété de placement entre essais/seeds. Une pose qui se
 * révèle malgré tout trop contraignante une fois les indices dérivés (case
 * cible de duplication systématiquement illégale) n'est PAS un problème de
 * correction — voir `resolveAndDeriveClues`/`repairToUnique`, qui échouent
 * déjà proprement (retour `false`/`null`, retry avec un nouveau seed dans
 * `generateLevel`) sur toute forme dégénérée — seulement un facteur de
 * fréquence de succès, ce que ce biais central cherche justement à
 * améliorer.
 */
function placeMirrorNeurons(layout, rows, cols, count, rand) {
  if (count <= 0) return;
  const candidates = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (layout[r][c] !== ".") continue;
      candidates.push([r, c, centralityScore(r, c, rows, cols)]);
    }
  if (candidates.length === 0) return;
  candidates.sort((a, b) => b[2] - a[2]);
  const poolSize = Math.max(count, Math.ceil(candidates.length / 3));
  const pool = candidates.slice(0, poolSize);
  shuffle(pool, rand);
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const [r, c] = pool[i];
    layout[r][c] = "M";
  }
}

/**
 * Pose au plus `count` prismes sur des cases "." (jamais "W", même
 * exclusion que `placeMirrorNeurons` — laisse les candidats indice
 * disponibles), biaisées vers le centre du plateau (même `centralityScore`
 * que le Neurone miroir). Contrairement au Neurone miroir (qui contraint
 * TOUTE sa ligne/colonne, sans ligne de vue), un prisme ne colore que la
 * PREMIÈRE lumière "à portée de laser" dans chacune de ses 4 directions
 * fixes (transparent au VOID, arrêté par tout autre obstacle — voir grid.js
 * `_scanRangeForLight`) : la centralité reste malgré tout le meilleur biais
 * disponible à ce stade (avant tout appel solveur, donc avant de savoir où
 * les lumières finiront réellement) — elle maximise la place ouverte dans
 * les 4 directions, donc la chance qu'au moins une n'atteigne pas
 * immédiatement un mur/une charge/un autre obstacle. La légitimité ("au
 * moins un prisme réellement traversé par une lumière ET dont la couleur
 * appliquée compte vraiment") est vérifiée a posteriori dans `tryGenerate`
 * (voir `prismGenuinelyUsed`), pas ici.
 */
function placePrisms(layout, rows, cols, count, rand) {
  if (count <= 0) return;
  const candidates = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (layout[r][c] !== ".") continue;
      candidates.push([r, c, centralityScore(r, c, rows, cols)]);
    }
  if (candidates.length === 0) return;
  candidates.sort((a, b) => b[2] - a[2]);
  const poolSize = Math.max(count, Math.ceil(candidates.length / 3));
  const pool = candidates.slice(0, poolSize);
  shuffle(pool, rand);
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const [r, c] = pool[i];
    // Token "P" seul: `firstColor` par défaut "r" côté grid.js
    // (parseCellToken) — la couleur de départ n'a aucune importance propre
    // (simple décalage de la rotation, voir PRISM_COLOR_SEQUENCE), aucune
    // raison de la tirer au hasard ici.
    layout[r][c] = "P";
  }
}

/**
 * Choisit, parmi les cases "W" (candidates indice) du layout déjà stabilisé
 * (après `buildInitialLayout`, donc après `relaxIsolatedCells` — pas avant,
 * pour ne pas piocher un candidat qui serait ensuite rouvert en case vide),
 * un TOUT PETIT sous-ensemble éligible Pyra — au plus `maxCount` (voir
 * `PYRA_MAX_CANDIDATES`), tirés au hasard SANS remise (`shuffle` puis les N
 * premiers) plutôt qu'une densité indépendante par case : retour
 * utilisateur explicite ("on ne veut pas beaucoup de pyras") — un compte
 * fixe plafonne le nombre de candidats quelle que soit la taille de la
 * grille, là où une densité en aurait fait proliférer sur les grandes
 * grilles 3★. Une promesse de CANDIDATURE, pas une garantie de survie (voir
 * `resolveAndDeriveClues` pour la validité, `pruneUnnecessaryPyra` pour la
 * nécessité). Retourne un `Set` de clés `"r,c"`, consulté par
 * `resolveAndDeriveClues`. Appelé une seule fois par tentative de
 * génération — la composition du sous-ensemble ne change plus ensuite,
 * seule sa dérivation effective est refaite à chaque passe.
 *
 * Exclut aussi les cases avec moins de `PYRA_MIN_FREE_NEIGHBORS` voisins
 * orthogonaux "." (vides) À CE STADE — voir son commentaire. Une case "."
 * ne change jamais plus de type après ce point (seules les "W" se résolvent
 * en indice/Pyra/void plus tard), donc ce compte prédit exactement le
 * nombre de voisins potentiellement lumineux dans le plateau final.
 */
function pickPyraCandidates(layout, rows, cols, maxCount, rand) {
  const set = new Set();
  if (maxCount <= 0) return set;
  const wCells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (layout[r][c] !== "W") continue;
      const freeNeighbors = orthogonalNeighbors(r, c, rows, cols).filter(([nr, nc]) => layout[nr][nc] === ".").length;
      if (freeNeighbors < PYRA_MIN_FREE_NEIGHBORS) continue;
      wCells.push(`${r},${c}`);
    }
  shuffle(wCells, rand);
  for (let i = 0; i < Math.min(maxCount, wCells.length); i++) set.add(wCells[i]);
  return set;
}

/** Vrai si au moins une case Pyra ("Y") survit dans le layout final — voir
 * `tryGenerate`, pendant de `mirrorGenuinelyUsed` pour le Miroir. */
function layoutHasPyra(layout) {
  return layout.some((row) => row.includes("Y"));
}

/** Nombre de voisins orthogonaux de (r,c) allumés dans `solution` (un
 * remplissage — voir `symmetricDifferenceCells`, même format `[[r,c], ...]`
 * de coordonnées allumées). */
function adjacentLightCount(solution, r, c, rows, cols) {
  const lit = new Set(solution.map(([sr, sc]) => `${sr},${sc}`));
  return orthogonalNeighbors(r, c, rows, cols).filter(([nr, nc]) => lit.has(`${nr},${nc}`)).length;
}

const PYRA_RICHNESS_CAP = 6;
const PYRA_RICHNESS_NODE_BUDGET = 60_000;

/**
 * Retour utilisateur ("pas assez difficile avec les Pyra... je veux que la
 * complexité vienne DE la mécanique de couleur ambiguë du Pyra" ; puis
 * "c'est pas possible de s'assurer plus tôt que les dilemmes soient plus
 * forts ?") : compte, parmi les Pyra ("Y") encore présents dans `cells`
 * (déjà passés par `pruneUnnecessaryPyra` — donc chacun garanti nécessaire
 * à l'unicité), combien offrent un VRAI dilemme — au moins 2 comptes de
 * lumières adjacentes distincts parmi les solutions blanches (couleur
 * ignorée) encore possibles sur ce plateau — plutôt qu'une couleur qui ne
 * fait que confirmer un placement déjà entièrement pinné par la déduction
 * ordinaire.
 *
 * Essayé D'ABORD en aval, dans `pruneUnnecessaryPyra` : démoter un Pyra
 * "nécessaire mais pas riche" en charge numérique casse l'unicité PAR
 * DÉFINITION de "nécessaire" (mesuré : 5/25 niveaux rendus totalement
 * insolubles). Essayé ensuite en amont, dans `tryColorizeForNecessity` (au
 * choix du retrait/coloriage) : mesuré sans effet réel (27% avant → 29-30%
 * après sur plusieurs centaines de niveaux) car la richesse finale d'un
 * Pyra dépend de l'ÉTAT COMPLET du plateau après TOUTE la Phase 2, pas
 * seulement du retrait local en cours d'évaluation.
 *
 * Utilisé ICI à la place : comme simple SIGNAL DE QUALITÉ ajouté au
 * candidat déjà généré par `tryGenerate` (voir `generateLevel`), sans
 * jamais rien démoter ni rejeter en place — `generateLevel` retente déjà
 * naturellement plusieurs seeds dans son budget existant (voir
 * `attemptsBudget`/`timeBudgetMs`) ; on se contente de préférer, à palier
 * et couleur égaux, le candidat dont les Pyra sont réellement riches
 * (`isBetterCandidate`) — aucun risque de casser l'unicité (candidat déjà
 * confirmé unique par construction) ni de bloquer la génération (le budget
 * existant borne déjà le nombre de tentatives, best-effort comme le reste).
 */
function countRichPyra(level, rows, cols, hint) {
  const pyraCells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (level.cells[r][c] === "Y") pyraCells.push([r, c]);
    }
  }
  if (pyraCells.length === 0) return { total: 0, rich: 0 };

  // Indice de solution (voir solver.js decideBranchOrder): `hint`, quand
  // fourni par l'appelant, est LA solution qu'on vient tout juste de
  // mesurer sur ce même plateau final (voir generateLevel) — biaise la
  // première solution retrouvée ici vers elle, sans rien changer au
  // résultat (toujours exhaustif jusqu'à PYRA_RICHNESS_CAP).
  const { solutions } = enumerateSolutions(level, PYRA_RICHNESS_CAP, PYRA_RICHNESS_NODE_BUDGET, {
    ignoreColor: true,
    hint,
  });
  let rich = 0;
  for (const [pr, pc] of pyraCells) {
    const counts = new Set(solutions.map((sol) => adjacentLightCount(sol, pr, pc, rows, cols)));
    if (counts.size >= 2) rich++;
  }
  return { total: pyraCells.length, rich };
}

/**
 * Nettoie EN PLACE les Pyra décoratifs — retour utilisateur explicite (voir
 * le commentaire de `PYRA_MAX_CANDIDATES`): "je trouve toujours la plupart
 * des pyra (voire tous) inutiles EN TANT QUE Pyra [...] ils sont utiles en
 * tant que Neurone [obstacle qui compte des lumières adjacentes, comme une
 * charge classique], mais ni en tant que Pyra (devoir faire un choix pour
 * avoir la couleur dont on a besoin) ni en tant que couleur".
 *
 * REDÉFINITION IMPORTANTE (retour utilisateur, après deux correctifs
 * précédents qui gardaient encore un critère "filtre") : "avoir un dilemme
 * SUR le Pyra c'est pas ce qu'on veut. Ce qu'on veut c'est avoir un dilemme
 * DE COULEUR sur le Pyra." Autrement dit, la seule chose qui compte est :
 * SON LASER (voir grid.js recompute(): `pyraReady`, exactement comme une
 * charge colorée satisfaite) est-il nécessaire pour qu'une cible couleur de
 * la Phase 2 soit atteinte avec la bonne teinte ? Tout le reste — y compris
 * "sa propre contrainte 1-3 lumières départage-t-elle l'unicité blanche ?"
 * (l'ancien critère "filtre", testé via `ignorePyra` dans une version
 * antérieure) — a été ABANDONNÉ comme critère de survie : Pyra accepte
 * indifféremment 1, 2 OU 3 lumières comme "succès" (voir grid.js
 * `_computeClueStates`, ce n'est PAS un compte exact comme une charge
 * numérique), donc un tel dilemme ne porte jamais sur "quelle couleur ?"
 * mais seulement sur "au moins 1 et au plus 3 ?" — une question qui n'a
 * rien à voir avec la couleur et qui a produit exactement le "Pyra qui ne
 * sert à rien" pointé du doigt sur une capture d'écran.
 *
 * Test : convertit hypothétiquement la case en charge NUMÉRIQUE NORMALE de
 * MÊME compte `n` (voir `adjacentLightCount` sur la solution actuelle,
 * déjà garantie unique à ce stade) — PAS en mur ("W"/WALL). Une charge de
 * compte `n` exige EXACTEMENT `n` lumières adjacentes, une contrainte au
 * moins aussi stricte que celle de Pyra (qui acceptait tout `n` ∈ [1,3]) :
 * ça préserve donc EXACTEMENT le même rôle de filtre, en ne retirant QUE le
 * laser. Si le plateau reste unique avec cette charge normale, le laser
 * n'était nécessaire à RIEN — décoratif, démotion commitée (le "Y" devient
 * simplement ce chiffre, pas une case void : le rôle filtre, lui, était
 * peut-être bien réel, juste sans rapport avec la couleur). Si l'unicité
 * casse, c'est la PREUVE que sa couleur exacte importait à une cible
 * quelque part — dilemme de couleur confirmé, "Y" reste intact.
 *
 * BUG CORRIGÉ (retour utilisateur, niveaux devenus insolubles après une
 * toute première version de ce nettoyage) : cette première version
 * remplaçait un "Y" décoratif par VOID ("X"). Or VOID est TRANSPARENT aux
 * lasers colorés (voir grid.js, en-tête) alors que Pyra — comme tout
 * obstacle plein — leur est OPAQUE : ce remplacement changeait donc
 * silencieusement la trajectoire d'AUTRES lasers qui passaient à côté sans
 * jamais toucher ce Pyra. La démotion en charge numérique normale (ci-
 * dessus) est opaque exactement comme Pyra l'était, donc ce problème ne se
 * pose plus.
 *
 * Tourne jusqu'à POINT FIXE (pas une seule passe) : avec plusieurs Pyra sur
 * le même plateau (voir `PYRA_MAX_CANDIDATES`), un "Y" peut sembler
 * nécessaire uniquement parce qu'un AUTRE "Y", pas encore retiré à ce
 * moment de la passe, maintenait artificiellement une ambiguïté — le
 * retirer PEUT donc révéler qu'un "Y" déjà "confirmé nécessaire" plus tôt
 * dans la même passe est en fait, lui aussi, décoratif une fois le premier
 * retiré. Une seule passe gauche-à-droite laisserait ce genre de cas
 * survivre par simple accident d'ordre de balayage. Une seule résolution
 * PAR PASSE (pas par candidat) suffit à connaître `n` pour tous les "Y"
 * encore présents : la solution gagnante ne change jamais tant qu'aucune
 * démotion n'a encore été commitée (une charge de compte `n` est une
 * contrainte au moins aussi stricte que ce que Pyra acceptait déjà).
 * Termine forcément (chaque itération ne peut que RETIRER des "Y", jamais
 * en rajouter) ; `deadline` reste le garde-fou wall-clock.
 */
function pruneUnnecessaryPyra(layout, rows, cols, nodeBudget, deadline) {
  let changed = true;
  // Indice de solution: chaque démotion commitée dans une passe préserve
  // EXACTEMENT `current.solution` (voir commentaire ci-dessus : `n` est
  // dérivé de cette même solution, donc elle continue de la satisfaire) —
  // reste donc valide comme point de départ pour la passe suivante, pas
  // seulement une approximation.
  let prevSolution = null;
  while (changed) {
    changed = false;
    if (Date.now() > deadline) return;

    const currentLevel = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
    const current = analyzeAndCount(currentLevel, 2, nodeBudget, { hint: prevSolution });
    if (!current || !current.exhausted || !current.solution) return; // résultat non concluant: on arrête, "Y" restants inchangés
    prevSolution = current.solution;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (layout[r][c] !== "Y") continue;
        if (Date.now() > deadline) return;

        const n = adjacentLightCount(current.solution, r, c, rows, cols);
        if (n < 1 || n > 3) continue; // garde-fou défensif: ne devrait jamais arriver (Y valide par construction)

        const prevToken = layout[r][c];
        layout[r][c] = String(n); // hypothèse: charge NORMALE de même compte, sans laser (voir commentaire)
        const finalLevel = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
        // Indice de solution: `current.solution` (mesurée juste au-dessus sur
        // le plateau AVANT cette démotion) reste presque toujours valide ici
        // — un seul "Y" a changé de type, tout le reste de la grille est
        // identique (voir solver.js decideBranchOrder).
        const verify = analyzeAndCount(finalLevel, 2, nodeBudget, { hint: current.solution });
        const stillUnique = verify && verify.exhausted && verify.count === 1;
        if (stillUnique) changed = true; // laser non nécessaire: démotion commitée, relance une passe complète
        else layout[r][c] = prevToken; // dilemme de couleur confirmé: "Y" reste tel quel
      }
    }
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

/** Vrai si `t` est un token de neurone miroir ("M") — voir grid.js: comme le
 * Miroir dévieur, une case FIXE du niveau posée dans `buildInitialLayout`
 * (jamais dérivée en indice, jamais rouverte) — mais avec une mécanique
 * différente (duplique TOUTE lumière de sa ligne/colonne, sans ligne de vue
 * ni dépendance à la couleur, voir `placeMirrorNeurons`), qui a ses propres
 * fonctions dédiées (`mirrorNeuronGenuinelyUsed`, `pruneUnusedMirrorNeurons`)
 * plutôt que de partager celles du Miroir dévieur (`mirrorGenuinelyUsed`,
 * `pruneUnusedMirrors`, `alignedWithMirror` — celles-ci lisent `_mirrorColor`,
 * une notion qui n'existe pas pour un neurone miroir). Voir
 * `isFixedObstacleToken` pour les usages GÉNÉRIQUES ("ne jamais toucher un
 * obstacle fixe") qui, eux, doivent couvrir les deux mécaniques à la fois. */
function isMirrorNeuronToken(t) {
  return t === "M";
}

/** Vrai si `t` est un token de prisme ("P", jamais suivi d'une lettre de
 * couleur ici — voir `placePrisms`: la couleur de départ par défaut de
 * grid.js/`parseCellToken` suffit toujours) — comme le Miroir dévieur et le
 * Neurone miroir, une case FIXE posée dans `buildInitialLayout`, jamais
 * dérivée ni rouverte ensuite, avec ses propres fonctions dédiées
 * (`prismGenuinelyUsed`, `pruneUnusedPrisms`). */
function isPrismToken(t) {
  return t === "P";
}

/** Réunion des trois types de case fixe du niveau (posées une fois pour
 * toutes dans `buildInitialLayout`, jamais dérivées ni rouvertes ensuite) —
 * voir `isMirrorToken`/`isMirrorNeuronToken`/`isPrismToken`. Utilisé aux
 * quelques endroits où la distinction entre les mécaniques n'a pas
 * d'importance (fusion d'îlots, réparation de case isolée, dérivation
 * d'indice) ; les usages SPÉCIFIQUES à une mécanique (nettoyage de
 * nécessité, biais de coloriage) continuent d'utiliser leur token dédié. */
function isFixedObstacleToken(t) {
  return isMirrorToken(t) || isMirrorNeuronToken(t) || isPrismToken(t);
}

/** Vrai si `t` est un token d'indice DÉJÀ dérivé (numéro "1"-"4" ou case
 * interdite "0") — c'est-à-dire ni vide, ni void, ni "W" (candidat pas
 * encore résolu), ni case fixe du niveau (`isFixedObstacleToken`: miroir
 * dévieur OU neurone miroir, aucun des deux n'est jamais un indice). Utilisé
 * après `resolveAndDeriveClues`, quand les cases indice ne portent plus "W"
 * mais leur vraie valeur — voir `wouldCreateDeadIsolation`, le pendant de
 * `hasClueNeighbor` pour cette phase-là. */
function isClueToken(t) {
  return t !== "X" && t !== "." && t !== "W" && !isFixedObstacleToken(t);
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
    // Jamais une case fixe (miroir dévieur OU neurone miroir) dans le pool:
    // contrairement à "W"/"X" (candidats sans conséquence à rouvrir ici),
    // ces deux-là ont été posées intentionnellement (voir buildInitialLayout)
    // — les rouvrir les détruirait silencieusement.
    const opaque = orthogonalNeighbors(r, c, rows, cols).filter(
      ([nr, nc]) => layout[nr][nc] !== "." && !isFixedObstacleToken(layout[nr][nc])
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
 *
 * `pyraCandidates` (voir `pickPyraCandidates`/`PYRA_MAX_CANDIDATES`,
 * `null`/absent si la feature Pyra n'est pas demandée) : une case candidate
 * dont la clé `"r,c"` y figure devient "Y" au lieu d'une dérivation normale
 * SI ET SEULEMENT SI son compte réel de lumières adjacentes dans CETTE
 * solution tombe dans la plage valide [1,3] — sinon elle retombe sur la
 * dérivation normale (charge classique si le compte est 4, interdite/void
 * si le compte est 0), exactement comme un candidat non éligible. Comme un
 * token numérique, "Y" n'est PAS exclu de cette boucle (contrairement au
 * miroir, fixe) : il reste re-dérivé à chaque appel, potentiellement vers
 * un état différent si le compte réel change entre deux passes.
 */
function resolveAndDeriveClues(layout, rows, cols, useForbidden, pyraCandidates = null) {
  const { grid, lights } = greedySolve(layoutToRows(layout), rows, cols);
  if (lights.length === 0) return null;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const token = layout[r][c];
      // Case fixe (miroir dévieur OU neurone miroir): jamais dérivée en
      // indice (voir isFixedObstacleToken) — aucune des deux ne compte de
      // lumière adjacente, ce sont des cases fixes du niveau, pas des
      // charges. Sans cette exclusion, cette boucle écraserait
      // silencieusement chacune d'elles par un chiffre/VOID dérivé de son
      // compte de lumières, comme n'importe quelle charge classique.
      if (token === "X" || token === "." || isFixedObstacleToken(token)) continue;
      let count = 0;
      for (const [dr, dc] of DIRECTIONS) {
        const nCell = grid.cellAt(r + dr, c + dc);
        if (nCell && nCell.type === CellType.EMPTY && grid.hasLight(r + dr, c + dc)) count++;
      }
      if (pyraCandidates && pyraCandidates.has(`${r},${c}`) && count >= 1 && count <= 3) {
        layout[r][c] = "Y";
      } else {
        layout[r][c] = count === 0 ? (useForbidden ? "0" : "X") : String(count);
      }
    }
  }
  return lights;
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

/** Vrai si murer (convertir en "W") la case vide (r,c) ferait chuter le
 * nombre de voisins orthogonaux ENCORE "." d'un candidat Pyra voisin
 * sous PYRA_MIN_FREE_NEIGHBORS — voir le commentaire de `repairToUnique`
 * ci-dessous. `pyraCandidates` peut
 * contenir des clés de cases déjà dérivées en "Y" OU encore en attente
 * ("W", pas encore repassées par `resolveAndDeriveClues`) — les deux sont
 * protégées de la même façon, la case candidate ne change jamais de
 * position une fois choisie par `pickPyraCandidates`. */
function wouldStarvePyraNeighbor(layout, r, c, rows, cols, pyraCandidates) {
  if (!pyraCandidates || pyraCandidates.size === 0) return false;
  for (const [nr, nc] of orthogonalNeighbors(r, c, rows, cols)) {
    if (!pyraCandidates.has(`${nr},${nc}`)) continue;
    const remaining = orthogonalNeighbors(nr, nc, rows, cols).filter(
      ([rr, cc]) => !(rr === r && cc === c) && layout[rr][cc] === "."
    ).length;
    if (remaining < PYRA_MIN_FREE_NEIGHBORS) return true;
  }
  return false;
}

/** Vrai si murer (convertir en "W") la case vide (r,c) FRAGMENTERAIT sa
 * composante connexe de cases "." en au moins deux morceaux dont un est plus
 * petit que `threshold` — voir `mergeSmallIslands`, qui traite ce même
 * problème mais UNE SEULE FOIS, avant tout appel solveur (`buildInitialLayout`).
 * Ce garde-fou complète cette passe : `repairToUnique` mure des cases APRÈS
 * coup, sur un plateau déjà fusionné, et peut donc lui-même recréer de
 * nouveaux petits îlots que `mergeSmallIslands` n'a jamais vus. Simulation
 * légère (retire temporairement la case, flood-fill depuis chaque voisin "."
 * restant, restaure) — aucun appel solveur, coût borné par la taille de la
 * composante (au plus rows*cols). Si (r,c) n'a qu'au plus un voisin ".", la
 * murer ne peut PAS scinder quoi que ce soit en plusieurs morceaux (c'est déjà
 * une extrémité), donc retourne `false` immédiatement sans flood-fill. */
function wouldFragmentSmallIsland(layout, r, c, rows, cols, threshold) {
  const neighbors = orthogonalNeighbors(r, c, rows, cols).filter(([nr, nc]) => layout[nr][nc] === ".");
  if (neighbors.length <= 1) return false;
  layout[r][c] = "W";
  const seen = new Set();
  let fragments = 0;
  let hasSmallFragment = false;
  for (const [nr, nc] of neighbors) {
    const startKey = `${nr},${nc}`;
    if (seen.has(startKey)) continue;
    const stack = [[nr, nc]];
    seen.add(startKey);
    let size = 0;
    while (stack.length) {
      const [cr, cc] = stack.pop();
      size++;
      for (const [xr, xc] of orthogonalNeighbors(cr, cc, rows, cols)) {
        const key = `${xr},${xc}`;
        if (layout[xr][xc] === "." && !seen.has(key)) {
          seen.add(key);
          stack.push([xr, xc]);
        }
      }
    }
    fragments++;
    if (size < threshold) hasSmallFragment = true;
  }
  layout[r][c] = ".";
  return fragments > 1 && hasSmallFragment;
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
 *
 * BUG CORRIGÉ (retour utilisateur, capture d'écran d'un Pyra réduit à un
 * seul voisin libre) : cette boucle mure des cases au hasard parmi celles
 * où deux solutions divergent, SANS savoir qu'une case
 * peut être le DERNIER voisin "." encore libre d'un candidat Pyra — la
 * murer après coup réduit son espace de dilemme à un choix quasi-binaire
 * (0 ou 1 lumière) que `pickPyraCandidates` avait pourtant explicitement
 * essayé d'éviter en amont. `wouldStarvePyraNeighbor` écarte ces cases EN
 * PRIORITÉ (pour les deux sources de `target` ci-dessous : divergence ET
 * repli aléatoire), avec un repli sur l'ensemble complet si TOUTES les
 * options menaceraient un Pyra (rare — mieux vaut réparer l'unicité que
 * bloquer la convergence ; le résidu est de toute façon rattrapé, quand
 * c'est sûr, par `pruneUnnecessaryPyra` en fin de génération).
 *
 * DEUXIÈME GARDE-FOU (retour utilisateur : "il y a toujours un peu trop
 * d'îlots") : `mergeSmallIslands` ne tourne qu'une fois, dans
 * `buildInitialLayout`, avant tout mur ajouté ici — cette boucle peut donc
 * recréer de nouveaux petits îlots en murant une case qui était le seul pont
 * entre deux morceaux d'une même zone. `wouldFragmentSmallIsland` écarte ces
 * cases EN PRIORITÉ elle aussi (même politique de repli que pour Pyra :
 * préférer une case sûre, mais ne jamais bloquer la convergence si aucune ne
 * l'est).
 */
function repairToUnique(layout, rows, cols, useForbidden, rand, repairNodeBudget, deadline, pyraCandidates = null) {
  if (!resolveAndDeriveClues(layout, rows, cols, useForbidden, pyraCandidates)) return false;

  // Indice de solution: chaque itération ne mure qu'UNE case de plus (voir
  // plus bas) — la solution trouvée à l'itération précédente reste donc un
  // point de départ statistiquement pertinent pour la suivante, même si
  // `resolveAndDeriveClues` re-dérive tous les indices à chaque passage
  // (voir solver.js decideBranchOrder: un indice erroné ne coûte jamais
  // plus cher que l'ordre par défaut, il ne fait qu'aider ou ne rien
  // changer).
  let prevSolution = null;

  for (let iter = 0; iter < MAX_REPAIR_ITERATIONS; iter++) {
    if (Date.now() > deadline) return false; // budget de temps global dépassé: cet essai abandonne
    const level = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
    const { solutions, exhausted } = enumerateSolutions(level, 2, repairNodeBudget, { hint: prevSolution });
    prevSolution = solutions.length > 0 ? solutions[0] : null;

    if (exhausted && solutions.length === 1) return true; // confirmé unique
    if (solutions.length === 0) return false; // garde-fou défensif: ne devrait jamais arriver

    const isSafeTarget = ([r, c]) =>
      !wouldStarvePyraNeighbor(layout, r, c, rows, cols, pyraCandidates) &&
      !wouldFragmentSmallIsland(layout, r, c, rows, cols, ISLAND_MERGE_THRESHOLD);

    let target = null;
    if (solutions.length >= 2) {
      const diffCells = symmetricDifferenceCells(solutions[0], solutions[1]);
      const safeCells = diffCells.filter(isSafeTarget);
      const pool = safeCells.length > 0 ? safeCells : diffCells;
      if (pool.length > 0) target = pool[Math.floor(rand() * pool.length)];
    }
    if (!target) {
      const empties = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (layout[r][c] === ".") empties.push([r, c]);
      const safeEmpties = empties.filter(isSafeTarget);
      const pool = safeEmpties.length > 0 ? safeEmpties : empties;
      if (pool.length > 0) target = pool[Math.floor(rand() * pool.length)];
    }
    if (!target) return false; // plus aucune case vide disponible: abandon

    layout[target[0]][target[1]] = "W";
    if (!resolveAndDeriveClues(layout, rows, cols, useForbidden, pyraCandidates)) return false;
  }
  return false; // budget de réparation épuisé sans converger
}

/**
 * Phase de minimisation (voir commentaire d'en-tête) : retire des indices un
 * par un (ordre aléatoire, chaque retrait devient un VOID neutre — voir
 * resolveAndDeriveClues), ne gardant chaque retrait QUE s'il préserve
 * l'unicité ET que le palier mesuré ne dépasse pas le palier demandé.
 * S'arrête dès que le palier demandé est atteint (SAUF au palier MAXIMUM,
 * voir `MAX_SOLVER_TIER` ci-dessous) OU que `deadline` (même timestamp
 * partagé qu'ailleurs, voir `repairToUnique`) est dépassée — sans ce
 * garde-fou, un plateau qui approche du palier 3 peut enchaîner des
 * dizaines d'appels solveur de plus en plus coûteux (mesuré : jusqu'à ~30s
 * cumulés sur un essai malchanceux) alors que chaque appel individuel
 * respecte pourtant son propre `nodeBudget`. `layout` doit déjà être
 * confirmé unique (post-`repairToUnique`) — modifié EN PLACE. Retourne le
 * dernier résultat `analyzeAndCount` valide (toujours confirmé unique), ou
 * `null` seulement si l'état de départ n'était déjà pas mesurable (ne
 * devrait pas arriver après `repairToUnique`, garde-fou défensif).
 *
 * BUG CORRIGÉ (retour utilisateur : "les niveaux 3★ sont pas assez
 * difficiles") : "s'arrêter dès la cible atteinte" est correct pour un
 * palier < `MAX_SOLVER_TIER` — continuer retirerait le risque de dépasser
 * la cible (overshoot vers le palier suivant, non désiré : chaque étoile
 * doit rester dans SA fourchette). Mais pour `targetTier === MAX_SOLVER_TIER`
 * (3★ actuellement), il n'existe PAS de palier suivant à éviter de dépasser
 * — chaque retrait supplémentaire qui reste dans ce palier ne fait donc que
 * RENFORCER la difficulté (`branchCount` plus élevé), jamais la dépasser.
 * S'arrêter au tout premier succès y laissait donc systématiquement de la
 * difficulté sur la table (3★ tout juste au-dessus du seuil, pas
 * "profondément" dans le palier) — corrigé en continuant d'essayer TOUS les
 * candidats restants (toujours borné par `deadline`) dans ce cas précis,
 * chaque retrait accepté ne faisant qu'accumuler sur les précédents.
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
    // Indice de solution: `best.solution` (dernier retrait accepté, un seul
    // indice de plus a disparu depuis) reste presque toujours valide ici —
    // voir solver.js decideBranchOrder.
    const result = analyzeAndCount(level, 2, nodeBudget, { hint: best.solution });
    const stillUnique = result.exhausted && result.count === 1;

    if (stillUnique && result.tier != null && result.tier <= targetTier) {
      best = result;
      // Voir le commentaire ci-dessus: s'arrêter au premier succès est
      // correct pour éviter l'overshoot SAUF au palier maximum, où
      // continuer ne peut plus jamais dépasser la cible — seulement la
      // renforcer.
      if (result.tier === targetTier && targetTier < MAX_SOLVER_TIER) break;
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
 * Convertit chaque miroir non traversé PAR LE GAGNANT en VOID ("X") — MAIS,
 * contrairement à une version antérieure de ce commentaire, ceci N'EST PAS
 * automatiquement sûr et exige une re-vérification par miroir (bug trouvé
 * lors du travail sur le biais de retrait Pyra, voir seed reproductible
 * 800027/3★/[color,mirror,pyra] dans l'historique de commit) : un miroir
 * "non traversé par le gagnant" peut malgré tout être ce qui INVALIDE une
 * solution ALTERNATE — le laser coloré de CETTE alternative-là, lui,
 * traverse peut-être bien ce miroir précis, et sa déviation/son mélange de
 * couleur est ce qui la fait échouer une cible. Une fois converti en VOID
 * (transparent, ne dévie ni ne mélange rien), le laser de cette alternative
 * change de trajectoire/couleur et peut soudain satisfaire la cible — la
 * rendant valide, donc une 2e solution. `mirrorGenuinelyUsed`/le test
 * "traversé par le gagnant" ne regarde QUE la solution gagnante, jamais les
 * alternatives déjà écartées par la couleur — insuffisant pour garantir la
 * sûreté du retrait, exactement le même écueil déjà rencontré (et corrigé)
 * pour `pruneUnnecessaryPyra`. Corrigé ici avec le même remède : convertir,
 * re-vérifier par un solve complet (couleur incluse), et REVENIR au miroir
 * d'origine si l'unicité casse — un miroir par un miroir, jamais un lot
 * entier à la fois, pour qu'un retrait qui casse ne masque pas la sûreté
 * d'un autre retrait déjà appliqué avec succès.
 */
function pruneUnusedMirrors(layout, rows, cols, solution, nodeBudget, deadline) {
  const grid = buildGridWithLights(layout, rows, cols, solution);
  const candidates = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!isMirrorToken(layout[r][c])) continue;
      const mc = grid.cellAt(r, c)._mirrorColor;
      const used = mc && (mc.r || mc.g || mc.b);
      if (!used) candidates.push([r, c]);
    }
  for (const [r, c] of candidates) {
    if (deadline != null && Date.now() > deadline) return;
    const prevToken = layout[r][c];
    layout[r][c] = "X";
    const finalLevel = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
    // Indice de solution: `solution` (le paramètre reçu, mesuré une seule
    // fois avant cette boucle) — un seul miroir décoratif de moins à
    // chaque itération, le reste du plateau est inchangé.
    const verify = analyzeAndCount(finalLevel, 2, nodeBudget, { hint: solution });
    const stillUnique = verify && verify.exhausted && verify.count === 1;
    if (!stillUnique) layout[r][c] = prevToken; // nécessaire malgré tout: on le remet
  }
}

/**
 * Vrai si AU MOINS UN neurone miroir du plateau a réellement dupliqué une
 * lumière dans la solution gagnante `solution` — pendant de
 * `mirrorGenuinelyUsed` pour le Neurone miroir (même philosophie: la
 * feature ne doit jamais rester purement décorative). Contrairement au
 * Miroir dévieur (qui exige une simulation complète, `buildGridWithLights`,
 * pour lire `_mirrorColor`, une notion qui dépend de la couleur), un
 * neurone réagit à N'IMPORTE QUELLE lumière — une vérification purement
 * GÉOMÉTRIQUE suffit donc ici: `solution` (produite par le VRAI solveur via
 * `toggleLight`, voir `tryGenerate`/`stripToTargetTier`) contient déjà
 * TOUTES les lumières de la solution gagnante, origines ET duplicatas
 * confondus — un neurone partage la ligne ou la colonne d'au moins une
 * lumière du plateau si et seulement s'il a dupliqué quelque chose pour
 * produire CETTE solution précise : toute lumière posée sur sa ligne/colonne
 * DOIT avoir un duplicata légal, sans quoi le mouvement qui l'a posée aurait
 * été intégralement rejeté (voir grid.js `toggleLight`/
 * `_computeMirrorDuplicates`, "tout ou rien").
 */
function mirrorNeuronGenuinelyUsed(layout, rows, cols, solution) {
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!isMirrorNeuronToken(layout[r][c])) continue;
      if (solution.some(([lr, lc]) => lr === r || lc === c)) return true;
    }
  return false;
}

/**
 * Nettoie EN PLACE les neurones miroirs purement décoratifs (aucune lumière
 * de la solution gagnante sur leur ligne/colonne, voir
 * `mirrorNeuronGenuinelyUsed`) — même politique et même remède que
 * `pruneUnusedMirrors` (voir son commentaire pour le détail du raisonnement,
 * identique ici): convertir en VOID ("X"), re-vérifier par un solve complet,
 * et REVENIR au neurone d'origine si l'unicité casse — un neurone "non
 * traversé par le gagnant" peut malgré tout être ce qui invalide une
 * solution alternative (une lumière de CETTE alternative-là, elle, tombe
 * peut-être bien sur sa ligne/colonne), donc son retrait n'est jamais
 * automatiquement sûr. Un neurone à la fois, jamais un lot entier, pour
 * qu'un retrait qui casse ne masque pas la sûreté d'un autre déjà appliqué
 * avec succès.
 */
function pruneUnusedMirrorNeurons(layout, rows, cols, solution, nodeBudget, deadline) {
  const candidates = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!isMirrorNeuronToken(layout[r][c])) continue;
      const used = solution.some(([lr, lc]) => lr === r || lc === c);
      if (!used) candidates.push([r, c]);
    }
  for (const [r, c] of candidates) {
    if (deadline != null && Date.now() > deadline) return;
    const prevToken = layout[r][c];
    layout[r][c] = "X";
    const finalLevel = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
    const verify = analyzeAndCount(finalLevel, 2, nodeBudget, { hint: solution });
    const stillUnique = verify && verify.exhausted && verify.count === 1;
    if (!stillUnique) layout[r][c] = prevToken; // nécessaire malgré tout: on le remet
  }
}

/**
 * Vrai si AU MOINS UN prisme du plateau a réellement coloré une lumière
 * d'une teinte NON blanche (voir grid.js recompute(), bloc "2b) Prismes")
 * dans la solution gagnante `solution` — pendant de `mirrorGenuinelyUsed`
 * pour le Prisme (même philosophie: la feature ne doit jamais rester
 * purement décorative). Lit `_prismAppliedColors` (voir grid.js —
 * uniquement posé pour cet usage de génération) plutôt que de recalculer le
 * scan/la rotation ici : chaque entrée vaut soit `null` (aucune lumière en
 * portée sur cette direction), soit la lettre de couleur RÉELLEMENT
 * appliquée ("r"/"g"/"b"/"w"). "w" (blanc) ne compte PAS comme une couleur
 * réelle — voir TARGET_CODES dans grid.js: "w" vaut r+g+b tous vrais, donc
 * fonctionnellement identique à l'absence de coloration, seul un canal
 * unique (r, g ou b) restreint réellement la teinte reçue par la lumière et
 * peut donc faire la différence pour une cible couleur. Si aucune charge
 * n'a de couleur (Couleur pas obtenue pour cet essai), aucune cible couleur
 * n'existe jamais pour en dépendre — mais la fonction reste correcte dans
 * ce cas: un prisme peut très bien avoir coloré une lumière (indépendant de
 * toute charge, voir grid.js) sans que ça compte pour autant, c'est
 * pourquoi l'appelant (`tryGenerate`) exige EN PLUS `colorApplied`, comme
 * pour le Miroir.
 */
function prismGenuinelyUsed(layout, rows, cols, solution) {
  const grid = buildGridWithLights(layout, rows, cols, solution);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!isPrismToken(layout[r][c])) continue;
      const applied = grid.cellAt(r, c)._prismAppliedColors;
      if (applied?.some((letter) => letter && letter !== "w")) return true;
    }
  return false;
}

/**
 * Nettoie EN PLACE les prismes purement décoratifs (aucune lumière colorée
 * d'une teinte non blanche dans la solution gagnante, voir
 * `prismGenuinelyUsed`) — même politique et même remède que
 * `pruneUnusedMirrors`/`pruneUnusedMirrorNeurons` (voir leurs commentaires
 * pour le détail du raisonnement, identique ici): convertir en VOID ("X"),
 * re-vérifier par un solve complet, et REVENIR au prisme d'origine si
 * l'unicité casse — un prisme "non coloré utilement" par le gagnant peut
 * malgré tout être ce qui invalide une solution alternative (une lumière de
 * CETTE alternative-là, elle, tombe peut-être bien dans sa portée avec une
 * couleur qui compte), donc son retrait n'est jamais automatiquement sûr.
 * Un prisme à la fois, jamais un lot entier, pour la même raison que les
 * deux fonctions sœurs.
 */
function pruneUnusedPrisms(layout, rows, cols, solution, nodeBudget, deadline) {
  const grid = buildGridWithLights(layout, rows, cols, solution);
  const candidates = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!isPrismToken(layout[r][c])) continue;
      const applied = grid.cellAt(r, c)._prismAppliedColors;
      const used = applied?.some((letter) => letter && letter !== "w");
      if (!used) candidates.push([r, c]);
    }
  for (const [r, c] of candidates) {
    if (deadline != null && Date.now() > deadline) return;
    const prevToken = layout[r][c];
    layout[r][c] = "X";
    const finalLevel = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
    const verify = analyzeAndCount(finalLevel, 2, nodeBudget, { hint: solution });
    const stillUnique = verify && verify.exhausted && verify.count === 1;
    if (!stillUnique) layout[r][c] = prevToken; // nécessaire malgré tout: on le remet
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

/** Toutes les cases "Y" (Pyra) actuellement posées dans `layout` — calculé une
 * fois par tentative de coloriage (voir `tryColorizeForNecessity`), jamais
 * recalculé pendant les essais de retrait/coloriage qui suivent puisque
 * aucun d'eux n'ajoute ni ne retire de Pyra (voir `PYRA_PROXIMITY_RADIUS`). */
function collectPyraCells(layout, rows, cols) {
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (layout[r][c] === "Y") cells.push([r, c]);
  return cells;
}

function manhattan(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

/** Vrai si (r,c) est à distance de Manhattan <= PYRA_PROXIMITY_RADIUS d'au
 * moins un Pyra — voir `orderCluesForRemoval`. */
function isNearPyra(r, c, pyraCells) {
  return pyraCells.some(([pr, pc]) => manhattan(r, c, pr, pc) <= PYRA_PROXIMITY_RADIUS);
}

/**
 * Réordonne `clueCells` pour le RETRAIT (étape 1 de `tryColorizeForNecessity`)
 * en combinant deux biais indépendants, chacun no-op si sa feature associée
 * n'est pas demandée pour cet essai :
 *   - Pyra (voir `PYRA_PROXIMITY_RADIUS`) : retirer EN PRIORITÉ les charges
 *     proches d'un Pyra, pour que l'ambiguïté blanche rouverte ait plus de
 *     chances de rejaillir sur SON compte de lumières adjacentes.
 *   - Miroir (voir `orderCluesByMirrorAlignment`) : retirer EN DERNIER les
 *     charges alignées avec un miroir, pour les garder disponibles au
 *     coloriage qui suit (`tryDiscriminatingColoring`, qui lui les préfère).
 * Les deux peuvent être actifs simultanément (ex: Couleur + Miroir + Pyra
 * tous cochés) : 4 groupes, chacun mélangé indépendamment pour garder de la
 * variété entre tentatives, dans l'ordre de priorité (proche Pyra, non
 * aligné) > (proche Pyra, aligné) > (loin, non aligné) > (loin, aligné). Se
 * réduit exactement à `shuffle` pur si ni Pyra ni Miroir ne sont demandés
 * (`pyraCells` vide et `wantsMirror` faux ⇒ tout retombe dans le 3e groupe),
 * et à l'équivalent en distribution de l'ancien
 * `orderCluesByMirrorAlignment(...).reverse()` si seul Miroir est demandé.
 */
function orderCluesForRemoval(clueCells, layout, rows, cols, rand, wantsMirror, pyraCells) {
  const buckets = [[], [], [], []]; // [prochePyra&&!aligné, prochePyra&&aligné, loin&&!aligné, loin&&aligné]
  for (const cell of clueCells) {
    const [r, c] = cell;
    const near = pyraCells.length > 0 && isNearPyra(r, c, pyraCells);
    const aligned = wantsMirror && alignedWithMirror(layout, r, c, rows, cols);
    const idx = (near ? 0 : 2) + (aligned ? 1 : 0);
    buckets[idx].push(cell);
  }
  for (const bucket of buckets) shuffle(bucket, rand);
  return [...buckets[0], ...buckets[1], ...buckets[2], ...buckets[3]];
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
 *
 * `wantsPyra` (voir `PYRA_PROXIMITY_RADIUS`/`orderCluesForRemoval`) : biaise
 * SEULEMENT quelles charges sont retirées en priorité, jamais le résultat
 * — un Pyra qui finit par dépendre réellement d'une cible colorée reste
 * entièrement découvert et confirmé par `pruneUnnecessaryPyra` en aval
 * (aucun lien direct entre cette fonction et la nécessité finale d'un Pyra
 * donné), c'est un simple coup de pouce statistique côté sélection.
 */
function tryColorizeForNecessity(
  layout,
  rows,
  cols,
  referenceSolution,
  rand,
  preset,
  stars,
  deadline,
  wantsMirror = false,
  wantsPyra = false
) {
  const removalPlan = COLOR_REMOVAL_PLAN_BY_STAR[stars] ?? [{ count: 1, candidates: 24 }];
  // Calculé une seule fois (voir `collectPyraCells`) : aucun essai de
  // retrait/coloriage ci-dessous n'ajoute ni ne retire de "Y".
  const pyraCells = wantsPyra ? collectPyraCells(layout, rows, cols) : [];

  for (const { count: k, candidates: maxCandidates } of removalPlan) {
    const clueCells = collectPlainClueCells(layout, rows, cols);
    if (clueCells.length < k) continue; // pas assez de charges survivantes pour retirer k à la fois

    for (let attempt = 0; attempt < maxCandidates; attempt++) {
      if (Date.now() > deadline) return null;

      // Voir `orderCluesForRemoval` : combine le biais Pyra (retirer en
      // priorité près d'un Pyra) et le biais Miroir (retirer en dernier les
      // charges alignées, pour les garder disponibles au coloriage) — pas de
      // retrait forcé dans les deux cas, juste un tirage moins susceptible
      // de gâcher les meilleurs candidats pour chaque feature active.
      const removalOrder = orderCluesForRemoval(clueCells, layout, rows, cols, rand, wantsMirror, pyraCells);
      const subset = removalOrder.slice(0, k);
      if (wouldCreateDeadIsolationForSet(layout, subset, rows, cols)) continue; // voir commentaire dédié, aucun appel solveur gaspillé
      const prevTokens = subset.map(([r, c]) => layout[r][c]);
      for (const [r, c] of subset) layout[r][c] = "X"; // retrait tentatif: réintroduit potentiellement une ambiguïté blanche contrôlée

      const level = { name: "Infini", rows, cols, cells: layoutToRows(layout) };
      // Indice de solution: `referenceSolution` reste GARANTIE valide ici
      // (retirer une charge ne peut qu'affaiblir les contraintes, jamais
      // invalider une solution qui les satisfaisait déjà) — pas juste une
      // approximation statistique comme les autres sites d'appel.
      const { solutions, exhausted } = enumerateSolutions(level, COLOR_AMBIGUITY_CAP, COLOR_AMBIGUITY_NODE_BUDGET, {
        ignoreColor: true,
        hint: referenceSolution,
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
        // Indice de solution: `winner` reste GARANTIE valide dans les deux
        // appels ci-dessous — c'est exactement la solution que le coloriage
        // vient de rendre gagnante (voir tryDiscriminatingColoring), rien de
        // probabiliste ici.
        const verify = analyzeAndCount(finalLevel, 2, preset.nodeBudget, { hint: winner });
        const whiteCheck = enumerateSolutions(finalLevel, 2, preset.repairNodeBudget, { ignoreColor: true, hint: winner });

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

// Défi Quotidien (retour utilisateur: "générer une très grande grille
// (difficulté 3 mais en plus grand) chaque jour", puis renforcé par un
// second retour: "j'aimerais que la difficulté soit particulièrement forte
// (plus que trois étoiles) [et] qu'on augmente la taille considérablement,
// il faut que ce soit un niveau assez long") — décalage additif appliqué
// aux BORNES de rowsRange/colsRange du palier 3★ UNIQUEMENT pour cet appel
// précis (voir generateLevel/tryGenerate ci-dessous), jamais une
// modification de DIFFICULTY_PRESETS lui-même: les paliers 1-3★ normaux
// (mode Infini) restent EXACTEMENT ceux mesurés/calibrés empiriquement (voir
// le commentaire au-dessus de DIFFICULTY_PRESETS sur le plafond ~96 cellules
// pour la latence solveur — un plafond pensé pour le thread PRINCIPAL,
// jamais applicable ici : voir dailyChallenge.js, cette génération tourne
// exclusivement en Worker d'arrière-plan). +6 lignes/+4 colonnes ~= +125%
// de cellules par rapport au preset 3★ de base (11-12x7-8 -> 17-18x11-12,
// ~187-216 cases) — mesuré empiriquement (scripts/bench-daily2.mjs, 20
// seeds) : temps par tentative 0.9-9.6s (médiane ~1.9s), largement dans le
// budget MAX_TIME_MS du Défi Quotidien (45s, voir dailyChallenge.js) même
// en tenant compte des tentatives supplémentaires exigées par
// DAILY_CHALLENGE_MIN_BRANCH_COUNT ci-dessous. Une taille encore plus
// généreuse a été essayée (+9/+6, ~294 cases) mais rejetée : une tentative
// isolée a mesuré 84s, très au-delà du budget — la variance du temps de
// résolution explose près de ce plafond, pas seulement sa moyenne.
export const DAILY_CHALLENGE_SIZE_BOOST = { rows: 6, cols: 4 };

// Second levier de difficulté, complémentaire à la taille ci-dessus : viser
// le palier solveur 4 (`SOLVER_TIER_FOR_STARS[3]`, déjà le cas pour un 3★
// normal) ne suffit PAS à lui seul à garantir "plus dur qu'un 3★ normal",
// car ce palier couvre en réalité une plage TRÈS large de `branchCount`
// (tout ce qui dépasse 130, voir solver.js: computeTier) — sans exigence
// supplémentaire, `generateLevel` s'arrête dès son isPerfect (mesuré=cible)
// et peut donc renvoyer un plateau à peine au-dessus de ce seuil (observé
// empiriquement : branchCount aussi bas que 240 pour ce format de grille,
// à peine plus dur qu'un 3★ ordinaire). En exigeant en plus un
// `branchCount` minimum (voir son usage dans generateLevel/isBetterCandidate
// ci-dessous), la recherche continue activement dans le MÊME budget tant
// que ce plancher n'est pas atteint, au lieu de s'arrêter sur le premier
// palier 4 venu. Valeur calibrée empiriquement (scripts/bench-daily2.mjs,
// 20 seeds, format 17-18x11-12) : médiane observée ~754, p25 ~541 — 800 vise
// donc légèrement au-dessus de la médiane "chance pure" (environ la moitié
// des tirages l'atteignent dès le premier essai, l'autre moitié doit
// activement chercher mieux dans le budget existant) sans réclamer un
// niveau extrême (p75~1300, max~7000) qui risquerait de ne jamais converger
// pour certaines formes de plateau. Jamais un motif d'échec (`generateLevel`
// retourne toujours son MEILLEUR candidat trouvé même si ce plancher n'est
// finalement pas atteint dans le budget, voir isBetterCandidate) — un plancher
// souhaité, pas une garantie dure.
export const DAILY_CHALLENGE_MIN_BRANCH_COUNT = 800;

function tryGenerate(seed, stars, enabledFeatureKeys, deadline, sizeBoost) {
  const preset = DIFFICULTY_PRESETS[stars];
  const solverTarget = SOLVER_TIER_FOR_STARS[stars];
  const rand = seededRandom(seed);

  const rowsRange = sizeBoost
    ? [preset.rowsRange[0] + sizeBoost.rows, preset.rowsRange[1] + sizeBoost.rows]
    : preset.rowsRange;
  const colsRange = sizeBoost
    ? [preset.colsRange[0] + sizeBoost.cols, preset.colsRange[1] + sizeBoost.cols]
    : preset.colsRange;
  const rows = pickInt(rand, rowsRange);
  const cols = pickInt(rand, colsRange);
  const clueDensity = pickFloat(rand, preset.initialClueDensity);
  const cornerVoid = pickInt(rand, preset.cornerVoidRange);

  const featureSubset = pickFeatureSubset(rand, enabledFeatureKeys, preset.budget);
  const useForbidden = featureSubset.includes("forbidden");
  const wantsColor = featureSubset.includes("color");
  // `pickFeatureSubset` garantit déjà que "mirror" n'est retenu que si
  // "color" l'est AUSSI pour CET essai précis (voir son commentaire) — un
  // miroir sans aucune charge colorée ne dévierait jamais rien.
  const wantsMirror = featureSubset.includes("mirror");
  const wantsPyra = featureSubset.includes("pyra");
  const wantsMirrorNeuron = featureSubset.includes("mirrorNeuron");
  // `pickFeatureSubset` garantit déjà que "prism" n'est retenu que si
  // "color" l'est AUSSI pour CET essai précis (même raisonnement que
  // "mirror" ci-dessus) — un prisme sans aucune cible couleur ne
  // distinguerait jamais rien.
  const wantsPrism = featureSubset.includes("prism");

  const layout = buildInitialLayout({
    rows,
    cols,
    clueDensity,
    cornerVoid,
    mirrorDensity: wantsMirror ? MIRROR_DENSITY : 0,
    mirrorNeuronCount: wantsMirrorNeuron ? MIRROR_NEURON_COUNT : 0,
    prismCount: wantsPrism ? PRISM_COUNT : 0,
    rand,
  });
  // Voir PYRA_MAX_CANDIDATES: choisi une seule fois ici, APRÈS
  // buildInitialLayout (donc après relaxIsolatedCells) pour ne piocher que
  // parmi des candidats "W" qui resteront bien des candidats — passé
  // ensuite tel quel à travers repairToUnique (qui seul rappelle
  // resolveAndDeriveClues), jamais recalculé.
  const pyraCandidates = wantsPyra ? pickPyraCandidates(layout, rows, cols, PYRA_MAX_CANDIDATES, rand) : null;
  if (!repairToUnique(layout, rows, cols, useForbidden, rand, preset.repairNodeBudget, deadline, pyraCandidates))
    return null;

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
      wantsMirror,
      wantsPyra
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
  if (wantsMirror) pruneUnusedMirrors(layout, rows, cols, finalAnalysis.solution, preset.nodeBudget, deadline);

  // Phase Neurone miroir [expérimental] : même politique que le Miroir
  // dévieur ci-dessus — déjà posé dans buildInitialLayout, déjà pleinement
  // simulé par repairToUnique/stripToTargetTier (toggleLight applique la
  // duplication INCONDITIONNELLEMENT, voir grid.js — contrairement au
  // Miroir dévieur, aucune dépendance à `colorApplied` ici: un neurone
  // réagit à n'importe quelle lumière, pas seulement à un laser coloré).
  // Utilise `finalAnalysis.solution` (APRÈS Couleur, si obtenue) plutôt que
  // `analysis.solution`: le retrait/coloriage de charges de la Phase 2 peut
  // déplacer la solution gagnante retenue, exactement comme pour
  // `mirrorApplied` ci-dessus.
  const mirrorNeuronApplied =
    wantsMirrorNeuron && mirrorNeuronGenuinelyUsed(layout, rows, cols, finalAnalysis.solution);
  if (wantsMirrorNeuron)
    pruneUnusedMirrorNeurons(layout, rows, cols, finalAnalysis.solution, preset.nodeBudget, deadline);

  // Phase Prisme : même politique que le Miroir dévieur (voir son
  // commentaire ci-dessus) — dépend de `colorApplied`, contrairement au
  // Neurone miroir: un prisme ne colore utilement une lumière (au sens où
  // ça peut compter pour une cible) que si une cible couleur existe pour en
  // dépendre, exactement comme un miroir n'a d'effet que sur un laser déjà
  // coloré. Utilise `finalAnalysis.solution` (APRÈS Couleur, si obtenue)
  // pour la même raison que `mirrorApplied`/`mirrorNeuronApplied` ci-dessus.
  const prismApplied = wantsPrism && colorApplied && prismGenuinelyUsed(layout, rows, cols, finalAnalysis.solution);
  if (wantsPrism) pruneUnusedPrisms(layout, rows, cols, finalAnalysis.solution, preset.nodeBudget, deadline);

  // Phase Pyra : chaque "Y" déjà présent dans `layout` a été validé au
  // moment même de sa dérivation (voir `resolveAndDeriveClues`), donc
  // contrairement au Miroir, aucune vérification a posteriori contre
  // `finalAnalysis.solution` n'est nécessaire pour sa VALIDITÉ. Ce qui reste
  // à faire, c'est le nettoyage de NÉCESSITÉ (retour utilisateur — voir
  // `pruneUnnecessaryPyra`) : retire tout "Y" dont le retrait ne changerait
  // rien à l'unicité (donc jamais un vrai dilemme pour le joueur), APRÈS la
  // Couleur/le Miroir pour que la vérification tienne compte de toute
  // interaction déjà en place (ex: une cible qui dépendrait du laser d'un
  // Pyra précis). `pyraApplied` ne peut donc être constaté qu'APRÈS ce
  // nettoyage, pas avant.
  if (wantsPyra) pruneUnnecessaryPyra(layout, rows, cols, preset.nodeBudget, deadline);
  const pyraApplied = wantsPyra && layoutHasPyra(layout);

  const actualFeatureSubset = featureSubset.filter((k) => {
    if (k === "color") return colorApplied;
    if (k === "mirror") return mirrorApplied;
    if (k === "mirrorNeuron") return mirrorNeuronApplied;
    if (k === "prism") return prismApplied;
    if (k === "pyra") return pyraApplied;
    return true;
  });

  // Voir ASSISTIVE_MECHANIC_KEYS/ASSISTIVE_MECHANIC_TIER_BONUS (commentaire
  // d'en-tête) : une fois qu'au moins une de Pyra/Neurone miroir/Prisme a
  // RÉELLEMENT survécu jusqu'ici (jamais avant — voir ce commentaire pour
  // la première approche essayée et abandonnée), retire des charges
  // numériques SUPPLÉMENTAIRES pour viser un cran de plus que le palier de
  // base déjà atteint, en réutilisant `stripToTargetTier` — mais sur le
  // plateau DÉJÀ colorié cette fois (donc chaque retrait est revérifié
  // couleur comprise, via `boardHasColorTargets`/`refreshForLeafCheck` dans
  // solver.js, contrairement au tout premier appel plus haut qui travaille
  // encore en blanc). Plafonné à `MAX_SOLVER_TIER`, jamais un échec si le
  // plateau ne s'y prête pas (best-effort, comme `stripToTargetTier`
  // lui-même) — `finalAnalysis` n'est mis à jour QUE si cette passe a
  // effectivement amélioré quelque chose (son propre premier test interne,
  // `best.tier >= targetTier`, retourne tel quel sans rien retirer si c'est
  // déjà le cas, typiquement au palier 3★ qui vise déjà MAX_SOLVER_TIER dès
  // le premier appel de `stripToTargetTier` plus haut).
  if (mirrorNeuronApplied || prismApplied || pyraApplied) {
    const tightenTarget = Math.min(MAX_SOLVER_TIER, solverTarget + ASSISTIVE_MECHANIC_TIER_BONUS);
    const tightened = stripToTargetTier(layout, rows, cols, tightenTarget, preset.nodeBudget, rand, deadline);
    if (tightened) finalAnalysis = tightened;
  }

  neutralizeDeadIsolatedCells(layout, rows, cols);

  // Vérification finale d'intégrité — chacune des passes de nettoyage de
  // nécessité ci-dessus (pruneUnusedMirrors/pruneUnusedMirrorNeurons/
  // pruneUnusedPrisms/pruneUnnecessaryPyra) se re-vérifie déjà
  // individuellement via `analyzeAndCount` avant de commiter une mutation
  // (`count===1` sinon la mutation est annulée) — mais AUCUNE ne met à jour
  // `finalAnalysis.solution` en retour. Bug trouvé lors de l'intégration du
  // Prisme (voir commit) : sur un plateau ayant À LA FOIS un Prisme et un
  // Pyra, la démotion d'un "Y" par `pruneUnnecessaryPyra` (qui tourne APRÈS
  // le nettoyage du Prisme) peut légitimement re-confirmer `count===1` —
  // l'unicité globale n'est jamais cassée — mais sur une solution DE
  // LUMIÈRES DIFFÉRENTE de celle mémorisée dans `finalAnalysis.solution`
  // (dérivée d'un état antérieur du plateau, où le Prisme — sensible à la
  // géométrie de TOUT obstacle sur sa ligne/colonne, y compris un "Y" pas
  // encore démoté — donnait une rotation de couleur différente) : le niveau
  // livré n'était alors PAS gagnable par la solution qu'on s'apprêtait à
  // renvoyer, bien qu'il reste parfaitement unique par ailleurs. Une
  // dernière passe ICI, sur le plateau VRAIMENT final, sans aucune
  // confiance dans les analyses précédentes, est le seul moyen de garantir
  // que `analysis.solution` gagne RÉELLEMENT le plateau qu'on renvoie —
  // sinon on jette cet essai (`null`, `generateLevel` retente naturellement
  // avec un nouveau seed) plutôt que de livrer un niveau cassé.
  const finalCells = layoutToRows(layout);
  const finalVerify = analyzeAndCount(
    { name: "Infini", rows, cols, cells: finalCells },
    2,
    preset.nodeBudget,
    { hint: finalAnalysis.solution }
  );
  if (!finalVerify || !finalVerify.exhausted || finalVerify.count !== 1) return null;
  finalAnalysis = { tier: finalVerify.tier, branchCount: finalVerify.branchCount, solution: finalVerify.solution };

  // `requestedSolverTier`: le VRAI palier visé pour CET essai — peut
  // dépasser `SOLVER_TIER_FOR_STARS[stars]` quand une mécanique assistive a
  // RÉELLEMENT survécu (voir ASSISTIVE_MECHANIC_KEYS/le durcissement
  // ci-dessus), auquel cas on le fixe au palier VRAIMENT atteint après
  // durcissement (jamais en-dessous de `solverTarget`) : `measuredTier` ne
  // doit alors jamais être vu comme "trop dur" par rapport à ce qu'on a
  // délibérément visé. Lu par `generateLevel` pour comparer `measuredTier`
  // à SA PROPRE cible (voir isBetterCandidate) plutôt qu'à la cible de base
  // partagée par tous les essais — sinon un essai avec Neurone miroir, dont
  // le palier mesuré dépasse la cible de base par construction, semblerait
  // "trop dur" par rapport à un essai sans mécanique tombé pile dessus, ce
  // qui annulerait la compensation en la faisant systématiquement perdre au
  // départage.
  const survivedAssistiveMechanic = ASSISTIVE_MECHANIC_KEYS.some((k) => actualFeatureSubset.includes(k));
  const requestedSolverTier = survivedAssistiveMechanic
    ? Math.max(solverTarget, finalAnalysis.tier ?? solverTarget)
    : solverTarget;

  return {
    rows,
    cols,
    cells: finalCells,
    analysis: finalAnalysis,
    featureSubset: actualFeatureSubset,
    requestedSolverTier,
  };
}

/**
 * Compare deux candidats déjà générés et retourne le meilleur selon l'ordre
 * de préférence de la Phase F (section 4/10 du doc) : solution unique avant
 * tout, puis palier de difficulté mesuré aussi proche que possible du palier
 * demandé, puis — si `preferColor` (voir `generateLevel`, la couleur a été
 * cochée par le joueur) — la présence de couleur à palier égal, puis — si
 * `preferMirror` (même principe, voir Phase 3 Miroir) — la présence d'un
 * miroir RÉELLEMENT utilisé à palier ET couleur égaux, puis `preferPyra`
 * (même principe, voir Phase Pyra) — la présence d'au moins une case Pyra
 * survivante à palier/couleur/miroir égaux, puis `preferMirrorNeuron`
 * (même principe, voir Phase Neurone miroir) — la présence d'un neurone
 * miroir RÉELLEMENT utilisé, puis `preferPrism` (même principe, voir Phase
 * Prisme) — la présence d'un prisme RÉELLEMENT utilisé à tout le reste
 * égal, puis (à tout le reste égal, imparfait) un `branchCount` qui pousse
 * dans la direction demandée.
 *
 * `minBranchCount` (voir DAILY_CHALLENGE_MIN_BRANCH_COUNT) : optionnel,
 * `undefined` pour tout appelant existant (aucun changement de
 * comportement). Quand fourni ET que les deux candidats sont DÉJÀ pile sur
 * leur palier cible (cas normalement "équivalent", `return false` plus bas
 * — le seul cas que cette addition modifie), départage par le plus haut
 * `branchCount` tant que `a` n'a pas encore atteint ce plancher : sans ça,
 * `generateLevel` garderait aveuglément le PREMIER essai qui atteint le
 * palier demandé, même si un essai suivant, tout aussi valide, était
 * nettement plus dur — empêchant tout progrès vers `minBranchCount` une
 * fois le palier atteint une première fois.
 */
export function isBetterCandidate(
  a,
  b,
  requestedTier,
  preferColor = false,
  preferMirror = false,
  preferPyra = false,
  preferMirrorNeuron = false,
  preferPrism = false,
  minBranchCount
) {
  if (!a) return true;
  const aUnique = a.solutionCount === 1;
  const bUnique = b.solutionCount === 1;
  if (aUnique !== bUnique) return bUnique;

  // Chaque candidat compare son palier mesuré à SA PROPRE cible
  // (`a.requestedTier`/`b.requestedTier`, posée par `generateLevel` — voir
  // ASSISTIVE_MECHANIC_KEYS/tryGenerate) plutôt qu'au `requestedTier`
  // partagé reçu en paramètre (gardé en repli pour un appelant qui ne
  // poserait pas ce champ, voir infiniteClient.js) : un essai avec Pyra/
  // Neurone miroir/Prisme vise DÉLIBÉRÉMENT un cran de plus pour compenser
  // l'indice gratuit qu'il donne au joueur — le comparer à la cible de base
  // le ferait paraître "trop dur" et perdant systématiquement le départage
  // contre un essai sans mécanique tombé pile sur cette cible de base,
  // annulant la compensation.
  const aTarget = a.requestedTier ?? requestedTier;
  const bTarget = b.requestedTier ?? requestedTier;
  const aDist = a.measuredTier == null ? Infinity : Math.abs(a.measuredTier - aTarget);
  const bDist = b.measuredTier == null ? Infinity : Math.abs(b.measuredTier - bTarget);
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

  if (preferPyra) {
    const aPyra = a.featureSubset?.includes("pyra") ?? false;
    const bPyra = b.featureSubset?.includes("pyra") ?? false;
    if (aPyra !== bPyra) return bPyra;

    // Retour utilisateur ("s'assurer plus tôt que les dilemmes soient plus
    // forts") : à présence de Pyra égale, préfère le candidat dont les Pyra
    // sont de VRAIS dilemmes de couleur (voir `countRichPyra`) plutôt qu'un
    // simple constat après coup. `pyraRich`/`pyraTotal` ne sont posés sur le
    // candidat QUE quand `aPyra`/`bPyra` sont vrais (voir `generateLevel`).
    if (aPyra && bPyra) {
      const aRich = a.pyraTotal ? a.pyraRich / a.pyraTotal : 0;
      const bRich = b.pyraTotal ? b.pyraRich / b.pyraTotal : 0;
      if (aRich !== bRich) return bRich > aRich;
    }
  }

  if (preferMirrorNeuron) {
    const aMirrorNeuron = a.featureSubset?.includes("mirrorNeuron") ?? false;
    const bMirrorNeuron = b.featureSubset?.includes("mirrorNeuron") ?? false;
    if (aMirrorNeuron !== bMirrorNeuron) return bMirrorNeuron;
  }

  if (preferPrism) {
    const aPrism = a.featureSubset?.includes("prism") ?? false;
    const bPrism = b.featureSubset?.includes("prism") ?? false;
    if (aPrism !== bPrism) return bPrism;
  }

  if (a.measuredTier != null && b.measuredTier != null && a.measuredTier === b.measuredTier) {
    const aBranch = a.branchCount ?? 0;
    const bBranch = b.branchCount ?? 0;
    // `aTarget` (déjà calculé ci-dessus): les deux candidats ont ici le
    // même `measuredTier`, donc `aDist === bDist` implique `aTarget ===
    // bTarget` dans l'immense majorité des cas — `aTarget` seul suffit.
    if (a.measuredTier < aTarget) return bBranch > aBranch;
    if (a.measuredTier > aTarget) return bBranch < aBranch;
    // Voir commentaire de `minBranchCount` ci-dessus : seul cas nouveau,
    // les deux candidats sont pile sur `aTarget` (sinon déjà traité par les
    // deux `if` au-dessus) mais `a` n'a pas encore atteint le plancher
    // demandé — continue à pousser vers un `branchCount` plus élevé.
    if (minBranchCount != null && aBranch < minBranchCount) return bBranch > aBranch;
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
  // Défi Quotidien uniquement (voir DAILY_CHALLENGE_SIZE_BOOST) — undefined
  // pour tout appel existant (mode Infini), donc AUCUN changement de
  // comportement pour eux (voir tryGenerate: sizeBoost falsy -> ranges
  // inchangées).
  sizeBoost,
  // Défi Quotidien uniquement (voir DAILY_CHALLENGE_MIN_BRANCH_COUNT) —
  // undefined pour tout appel existant, donc AUCUN changement de
  // comportement pour eux (voir isPerfect/isBetterCandidate plus bas :
  // `minBranchCount == null` désactive toute la logique qui en dépend).
  minBranchCount,
} = {}) {
  const stars = clampTier(difficulty);
  const solverTarget = SOLVER_TIER_FOR_STARS[stars]; // voir SOLVER_TIER_FOR_STARS: 1★→2, 2★→3, 3★→4
  const colorRequested = Array.isArray(enabledFeatureKeys) && enabledFeatureKeys.includes("color");
  const mirrorRequested = Array.isArray(enabledFeatureKeys) && enabledFeatureKeys.includes("mirror");
  const pyraRequested = Array.isArray(enabledFeatureKeys) && enabledFeatureKeys.includes("pyra");
  const mirrorNeuronRequested = Array.isArray(enabledFeatureKeys) && enabledFeatureKeys.includes("mirrorNeuron");
  const prismRequested = Array.isArray(enabledFeatureKeys) && enabledFeatureKeys.includes("prism");
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
    const raw = tryGenerate(candidateSeed, stars, enabledFeatureKeys, deadline, sizeBoost);
    if (!raw) continue; // forme dégénérée ou réparation non convergée: on retente ailleurs

    const level = { name: "Infini", rows: raw.rows, cols: raw.cols, cells: raw.cells };
    const { tier: measuredTier, branchCount, solution } = raw.analysis;
    // Voir ASSISTIVE_MECHANIC_KEYS/tryGenerate: `raw.requestedSolverTier`
    // est la cible RÉELLE de CET essai (peut dépasser `solverTarget` de
    // base si Pyra/Neurone miroir/Prisme a RÉELLEMENT survécu jusqu'au
    // durcissement final) — c'est CETTE valeur, pas `solverTarget`, qu'il
    // faut comparer à `measuredTier`
    // (isPerfect ci-dessous, isBetterCandidate plus bas) pour ne pas
    // pénaliser un essai délibérément visé plus dur.
    const ownSolverTarget = raw.requestedSolverTier ?? solverTarget;

    const candidate = {
      level,
      solution,
      solutionCount: 1, // garanti unique par construction (repair+strip ne commitent jamais un état ambigu)
      confirmedUnique: true,
      measuredTier, // palier SOLVEUR (1-4) à ce stade
      branchCount,
      requestedTier: ownSolverTarget,
      featureSubset: raw.featureSubset,
      attempts,
    };

    // Voir `countRichPyra` : mesure best-effort, seulement quand ce candidat
    // a effectivement un Pyra survivant (`pruneUnnecessaryPyra` a déjà
    // écarté ceux qui ne l'étaient pas) — sert de départage dans
    // `isBetterCandidate` (`preferPyra`), jamais de motif de rejet.
    if (pyraRequested && candidate.featureSubset.includes("pyra")) {
      const { total, rich } = countRichPyra(level, level.rows, level.cols, candidate.solution);
      candidate.pyraTotal = total;
      candidate.pyraRich = rich;
    }

    // "Parfait" (arrêt immédiat) exige désormais AUSSI la couleur quand elle
    // a été demandée par le joueur (voir commentaire ci-dessus) — un
    // candidat au bon palier mais sans couleur reste un excellent filet de
    // sécurité (via isBetterCandidate juste en dessous), mais ne coupe plus
    // la boucle : on continue à retenter, dans le budget élargi, jusqu'à
    // trouver mieux ou épuiser le budget. Le miroir, lui, N'entre PAS dans
    // ce critère (voir MIRROR_DENSITY/MIRROR_BUDGET_MULTIPLIER pour le
    // pourquoi) — il reste un bonus opportuniste, jamais un motif de
    // prolonger la recherche.
    // Retour utilisateur ("s'assurer plus tôt que les dilemmes soient plus
    // forts") : quand CE candidat a effectivement un Pyra, "parfait" exige
    // maintenant AUSSI que tous ses Pyra soient riches (voir
    // `countRichPyra`) — sinon on continue à retenter dans le budget
    // existant plutôt que de s'arrêter sur un Pyra purement décoratif. Un
    // candidat SANS Pyra n'est jamais bloqué par ce critère (comme le
    // Miroir : la fréquence de Pyra elle-même reste un bonus opportuniste
    // départagé par `preferPyra`, pas une exigence dure).
    const hasPyraThisCandidate = candidate.featureSubset.includes("pyra");
    const pyraRichEnough = !hasPyraThisCandidate || (candidate.pyraTotal > 0 && candidate.pyraRich === candidate.pyraTotal);
    // Défi Quotidien uniquement (voir DAILY_CHALLENGE_MIN_BRANCH_COUNT) :
    // `minBranchCount == null` pour tout appel existant -> `branchEnough`
    // toujours vrai, `isPerfect` inchangé. Sinon, un palier pile atteint
    // mais avec un `branchCount` trop bas (voir son commentaire — le palier
    // 4 couvre une plage large) ne compte plus comme "parfait" : la boucle
    // continue à chercher mieux dans le même budget.
    const branchEnough = minBranchCount == null || branchCount >= minBranchCount;
    const isPerfect =
      measuredTier === ownSolverTarget &&
      (!colorRequested || candidate.featureSubset.includes("color")) &&
      pyraRichEnough &&
      branchEnough;
    if (isPerfect) {
      best = candidate;
      break;
    }
    if (
      isBetterCandidate(
        best,
        candidate,
        solverTarget,
        colorRequested,
        mirrorRequested,
        pyraRequested,
        mirrorNeuronRequested,
        prismRequested,
        minBranchCount
      )
    )
      best = candidate;
  }

  if (!best) return null; // n'arrive que si même le fallback échoue à générer une forme jouable

  best.measuredTier = starsForSolverTier(best.measuredTier); // palier solveur -> étoiles affichées
  best.requestedTier = stars;
  best.level.starThresholds = [best.solution.length, Math.ceil(best.solution.length * 1.5)];
  best.attemptsUsed = attempts;
  best.timeMs = Date.now() - start;
  return best;
}
