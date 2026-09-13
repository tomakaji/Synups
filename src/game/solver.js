// Solveur, réutilisé à la fois par les outils de génération/validation de
// niveaux (scripts/) et potentiellement plus tard par un système d'indices
// en jeu. S'appuie entièrement sur LightUpGrid (toggleLight, isWon) pour
// ne jamais diverger des règles réelles du jeu.
//
// Contrairement à un simple backtracking "case par case dans l'ordre de
// lecture", ce solveur alterne à chaque noeud:
//   1) une passe de PROPAGATION qui déduit les placements forcés (cases
//      qu'on peut affirmer allumées ou éteintes avec certitude, sans
//      deviner), avant de brancher sur quoi que ce soit;
//   2) un choix de branchement qui privilégie la case appartenant à
//      l'indice le plus "serré" (le moins de combinaisons possibles), pour
//      heurter une contradiction ou une nouvelle déduction le plus vite
//      possible plutôt que d'explorer une zone ouverte au hasard.
//
// La propagation a deux niveaux :
//   - Stage 1 (par indice individuel) : si le nombre de cases libres
//     restantes égale exactement le nombre de lumières encore nécessaires,
//     elles sont toutes forcées allumées ; si le besoin restant est nul,
//     elles sont toutes forcées éteintes (cases interdites: toujours dans
//     ce second cas puisqu'elles exigent 0 lumière adjacente).
//   - Stage 2 (paires d'indices en interaction) : deux indices peuvent
//     "se contraindre" mutuellement quand certaines de leurs cases libres
//     se voient l'une l'autre (même ligne/colonne, sans obstacle entre
//     elles) — dans ce cas, au plus une des deux peut être allumée. En
//     énumérant les combinaisons valides pour la paire (respectant les
//     deux comptes ET ces exclusions croisées), on peut parfois déduire
//     qu'une case est allumée (ou éteinte) dans TOUTES les combinaisons
//     valides, donc forcément vraie, même si aucun des deux indices n'est
//     déterminé isolément. C'est une généralisation du raisonnement
//     "les deux neurones de 3 qui se gênent" (voir levels.js "All the
//     images").
//
// Ces déductions sont des conséquences NÉCESSAIRES (pas des paris) : les
// encoder comme des placements immédiats plutôt que comme des branches
// ne change jamais le nombre de solutions trouvées, seulement la vitesse
// pour y arriver. Chaque appel de propagation annule proprement ses propres
// effets si elle découvre une contradiction, et le backtracking annule les
// siens en sortant de chaque noeud — donc à tout moment, l'état de `grid`
// correspond exactement au chemin actuellement exploré.
//
// Neurone miroir [expérimental] et solidité des déductions: `excluded`
// représente une HYPOTHÈSE DE BRANCHEMENT ("on essaie sans lumière ici"),
// PAS une certitude absolue — pour la plupart des cases c'est équivalent,
// mais pas pour une case qui se trouve sur la ligne/colonne d'un neurone
// miroir: elle peut très bien s'allumer plus tard MALGRÉ cette hypothèse,
// via un duplicata automatique déclenché par une lumière posée ailleurs
// (voir grid.js: `_computeMirrorDuplicates`, qui ignore la ligne de vue).
// Les déductions stage 1/2 qui s'appuient sur "cette case exclue restera
// forcément noire" pour en déduire que D'AUTRES cases libres du même
// indice doivent forcément être allumées (ou que le compte est
// impossible) seraient donc INCORRECTES pour un indice dont au moins un
// voisin exclu est sur la ligne/colonne d'un neurone miroir — voir
// `computeMirrorReachable` et son usage (paramètre `mirrorReachable`) dans
// `propagate`/`pairDeductions`. La direction inverse (compte déjà atteint
// ⇒ exclure les cases libres restantes) reste sûre dans tous les cas: si
// l'une d'elles s'allume quand même plus tard via un duplicata, la
// prochaine passe de `propagate` le détecte immédiatement (adjacentLights
// recalculé sur l'état réel de la grille) et remonte la contradiction.
//
// Neurone miroir [expérimental], second risque symétrique (bug retour
// utilisateur, niveau "Cauchemar IV" modifié — HISTORIQUE, voir plus bas
// pour la solution ACTUELLE): le paragraphe ci-dessus couvre les fausses
// certitudes issues d'une case EXCLUE mais atteignable. Il existe un risque
// symétrique côté FORÇAGE: quand Stage 1/1.5/2 conclut qu'une case doit
// forcément être allumée (dernier candidat restant pour un indice, seul
// candidat d'illumination, ou variable forcée dans une paire), et que CETTE
// case précise est elle-même sur la ligne/colonne d'un neurone miroir, la
// forcer comme pose RÉELLE (via `forceLit`/`toggleLight`) n'est pas neutre:
// elle pourrait tout aussi bien finir allumée comme DUPLICATA d'une lumière
// posée à l'AUTRE bout du même neurone. Or un duplicata hérite TOUJOURS de
// la couleur de son origine (jamais l'inverse) et bloque tout laser de
// charge colorée qui le toucherait directement (voir grid.js:
// `_mirrorLaserBlocked`) — la couleur effective de la paire dépend donc de
// LAQUELLE des deux cases devient l'origine. Un niveau réellement soluble à
// la main (solution fournie par l'utilisateur, vérifiée directement via
// `LightUpGrid.toggleLight`/`isWon`) a été rapporté à tort insoluble par ce
// bug : la case forcée par Stage 1 absorbait directement un laser coloré
// qu'elle aurait dû laisser passer en restant duplicata, corrompant la
// couleur reçue par une case-cible plus loin dans la chaîne.
//
// PREMIÈRE solution (livrée, puis REMPLACÉE — voir ci-dessous): Stage 1/1.5/
// Stage 2 vérifiaient `mirrorReachable` côté case candidate au forçage (pas
// seulement côté voisin exclu) et s'abstenaient — la case redevenait un
// candidat de branchement normal, les deux polarités étant alors essayées
// par le backtracking plutôt qu'imposées. Corrige bien le bug, MAIS cette
// abstention s'applique à CHAQUE NOEUD de tout l'arbre de recherche dès
// qu'une case atteignable par un neurone miroir existe quelque part — donc
// même pour des groupes qui n'auront jamais le moindre problème de couleur
// (la grande majorité en pratique, voir plus bas). Mesuré comme la cause
// principale d'un ralentissement significatif de la génération dès qu'une
// grille combine couleur ET neurone miroir (jusqu'à ~1.6x plus lent sur
// certains niveaux malgré le bypass déjà en place pour les plateaux SANS
// couleur — voir `computeMirrorReachableIfNeeded`).
//
// Solution ACTUELLE (remplace la précédente): Stage 1/1.5/2 ne lisent
// JAMAIS `_colorMatch`/`_litColor` (uniquement `hasLight`/`_illuminated`/
// `_state`, tous origine-invariants — un duplicata compte exactement comme
// une pose réelle pour ces trois lectures) — donc AUCUNE conclusion prise
// PENDANT la recherche ne peut être fausse à cause de la polarité, quelle
// qu'elle soit. Autrement dit: la question "cette case sera-t-elle
// allumée ?" a toujours une réponse sûre et rapide (le forçage normal
// suffit, comme avant le bug), seule la question "qui, du groupe, est
// l'origine (donc capte les lasers colorés au lieu de les bloquer) ?" reste
// ambiguë — et elle n'a besoin d'être tranchée QUE là où elle a un impact
// observable: `isWon()` (via `_colorMatch`, jamais lu ailleurs). On force
// donc à nouveau normalement partout PENDANT la recherche (aucune
// abstention côté forçage — les 3 points Stage 1/1.5/2 ci-dessous ne
// consultent plus `mirrorReachable` du tout), et on reporte la résolution
// de l'ambiguïté au moment d'une FEUILLE (plateau entièrement décidé) qui
// échoue à cause de la couleur: on y réessaie alors, localement, les autres
// origines possibles de chaque groupe de neurone miroir actuellement actif
// (voir `resolveLeafOutcomes`/`resolveLeafWin`/`collectActiveMirrorGroups`
// plus bas), avant de conclure à un échec pour cette branche. Le coût de
// cette ré-résolution (quelques `toggleLight`+`recompute()` ciblés) n'est
// payé qu'aux feuilles qui en ont réellement besoin — rare en pratique
// (measuré: la polarité ne discrimine jamais entre candidats sur la grande
// majorité des niveaux testés, voir l'historique de cette investigation) —
// jamais à chaque noeud de l'arbre comme la solution précédente. Mesuré:
// ~8x plus rapide sur le niveau qui avait motivé cette recherche
// ("Cauchemar VI", 41.2s → 5.0s), ~6x sur un plateau couleur+neurone de
// bench (7.4s → 1.2s), aucune régression de correction (suite complète de
// 42 niveaux + 6 plateaux fixes, résultats identiques à la version
// précédente).

import { LightUpGrid, CellType } from "./grid.js";

const DIRECTIONS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

class NodeBudgetExceeded extends Error {}

function anyClueError(grid) {
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cellAt(r, c);
      if (cell.type === CellType.CLUE && cell._state === "error") return true;
    }
  }
  return false;
}

function keyOf(r, c) {
  return `${r},${c}`;
}

/** Index numérique (r*cols+c) pour `excluded`/`mirrorReachable` — voir leur
 * usage plus bas : ce sont les deux ensembles consultés au chemin le plus
 * chaud du solveur (à chaque case candidate, à chaque nœud), donc les seuls
 * pour lesquels remplacer les clés chaîne "r,c" (une allocation par appel)
 * par un entier (aucune allocation, juste une multiplication) vaut la peine.
 * `pairDeductions`/`varIndex` reste en clés chaîne : structure locale et
 * bornée (n≤12 cases), pas dans le chemin chaud de la même façon. */
function idxOf(grid, r, c) {
  return r * grid.cols + c;
}

/** Voisins EMPTY d'une case (r,c) déjà porteurs d'une lumière (décidés "allumés"). */
function litNeighborCount(grid, r, c) {
  let n = 0;
  for (const [dr, dc] of DIRECTIONS) {
    const nc = grid.cellAt(r + dr, c + dc);
    if (nc && nc.type === CellType.EMPTY && grid.hasLight(r + dr, c + dc)) n++;
  }
  return n;
}

/** Voisins EMPTY d'une case (r,c) ni allumés, ni exclus (encore "libres"). */
function freeUndecidedNeighbors(grid, r, c, excluded) {
  const result = [];
  for (const [dr, dc] of DIRECTIONS) {
    const nr = r + dr;
    const nc = c + dc;
    const cell = grid.cellAt(nr, nc);
    if (!cell || cell.type !== CellType.EMPTY) continue;
    if (grid.hasLight(nr, nc)) continue;
    if (excluded.has(idxOf(grid, nr, nc))) continue;
    result.push([nr, nc]);
  }
  return result;
}

/**
 * Candidats restants capables d'illuminer la case vide (r,c) elle-même
 * non illuminée: (r,c) elle-même (si pas exclue) plus chaque case EMPTY
 * libre (ni allumée, ni exclue) sur ses 4 directions jusqu'au premier
 * obstacle — même balayage que `_computeIlluminationOnly` dans grid.js,
 * mais côté solveur (ne modifie rien). Voir Stage 1.5 dans `propagate`.
 *
 * Retourne `null` (abstention) si un candidat écarté par `excluded` est
 * atteignable par un neurone miroir [expérimental] (`mirrorReachable`):
 * cette exclusion n'est alors pas une certitude (voir commentaire en tête
 * de fichier — même prudence que `hasRiskyExcludedNeighbor`), donc aucune
 * conclusion ne doit s'appuyer sur "ce candidat restera noir" pour CETTE
 * case, ni pour forcer l'unique survivant, ni pour déclarer une
 * contradiction s'il n'en reste aucun.
 */
function illuminationCandidates(grid, r, c, excluded, mirrorReachable) {
  const candidates = [];
  let risky = false;
  const selfIdx = idxOf(grid, r, c);
  if (excluded.has(selfIdx)) {
    if (mirrorReachable && mirrorReachable.has(selfIdx)) risky = true;
  } else {
    candidates.push([r, c]);
  }
  for (const [dr, dc] of DIRECTIONS) {
    let nr = r + dr;
    let nc = c + dc;
    while (true) {
      const cell = grid.cellAt(nr, nc);
      if (!cell || cell.type !== CellType.EMPTY) break;
      const idx = idxOf(grid, nr, nc);
      if (excluded.has(idx)) {
        if (mirrorReachable && mirrorReachable.has(idx)) risky = true;
      } else {
        candidates.push([nr, nc]);
      }
      nr += dr;
      nc += dc;
    }
  }
  return risky ? null : candidates;
}

/**
 * Vrai si (r,c) a au moins un voisin EMPTY non allumé, EXCLU par le
 * backtracking (hypothèse "pas de lumière ici"), ET atteignable par un
 * neurone miroir [expérimental] (`mirrorReachable`) — dans ce cas cette
 * exclusion n'est pas une certitude (voir commentaire en tête de fichier),
 * donc aucune déduction ne doit s'appuyer sur "ce voisin restera noir".
 */
function hasRiskyExcludedNeighbor(grid, r, c, excluded, mirrorReachable) {
  if (!mirrorReachable || mirrorReachable.size === 0) return false;
  for (const [dr, dc] of DIRECTIONS) {
    const nr = r + dr;
    const nc = c + dc;
    const cell = grid.cellAt(nr, nc);
    if (!cell || cell.type !== CellType.EMPTY) continue;
    if (grid.hasLight(nr, nc)) continue;
    const idx = idxOf(grid, nr, nc);
    if (excluded.has(idx) && mirrorReachable.has(idx)) return true;
  }
  return false;
}

/**
 * Cases EMPTY "atteignables" par au moins un neurone miroir [expérimental]:
 * situées sur la même ligne OU colonne qu'une case MIRROR_NEURON — donc
 * susceptibles de recevoir une lumière via duplicata automatique, MÊME si
 * le backtracking les a provisoirement "exclues" (voir commentaire en tête
 * de fichier). Calculé une seule fois par résolution (la géométrie de la
 * grille ne change pas), passé ensuite à `propagate`/`pairDeductions`.
 */
function computeMirrorReachable(grid) {
  const reachable = new Set();
  const neuronRows = new Set();
  const neuronCols = new Set();
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.cellAt(r, c).type === CellType.MIRROR_NEURON) {
        neuronRows.add(r);
        neuronCols.add(c);
      }
    }
  }
  if (neuronRows.size === 0 && neuronCols.size === 0) return reachable;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.cellAt(r, c).type !== CellType.EMPTY) continue;
      if (neuronRows.has(r) || neuronCols.has(c)) reachable.add(idxOf(grid, r, c));
    }
  }
  return reachable;
}

/**
 * PERF (round mobile) : vrai si au moins une case du plateau porte une
 * cible de couleur (`cell.target`, voir grid.js parseCellToken) — calculé
 * une seule fois par résolution (statique, comme `computeMirrorReachable`)
 * pour éviter un `recompute()` complet (traçage de laser + diffusion de
 * couleur, la partie la plus chère de `recompute()`) à chaque feuille de
 * l'arbre de recherche sur un plateau qui n'a de toute façon AUCUNE cible à
 * vérifier.
 *
 * `isWon()` (voir grid.js) ne lit `cell._colorMatch` QUE pour une case
 * `cell.target` truthy — sur un plateau sans aucune cible, cette branche
 * n'est donc jamais empruntée, et tout ce qu'`isWon()` lit réellement
 * (`_illuminated`, `_state` des indices/interdictions/Pyra) est déjà tenu à
 * jour par le chemin "léger" (`_computeClueStates()` +
 * `_computeIlluminationOnly()`, voir `toggleLight({full:false})`) — aucun
 * recompute supplémentaire n'est donc nécessaire du tout à la feuille dans
 * ce cas, pas même la version allégée : rien n'a changé depuis le dernier
 * toggle. Un plateau AVEC au moins une cible garde le `recompute()` complet
 * (seul chemin qui calcule `_litColor`/`_colorMatch`), inchangé.
 */
function boardHasColorTargets(grid) {
  return grid.cells.some((row) => row.some((cell) => !!cell.target));
}

/**
 * PERF (round mobile, neurone miroir): calcule `mirrorReachable` (voir
 * `computeMirrorReachable`) SEULEMENT si le plateau a au moins une cible de
 * couleur — sinon renvoie un Set vide.
 *
 * HISTORIQUE — jusqu'à la "Solution ACTUELLE" décrite en tête de fichier,
 * ce Set vide désactivait silencieusement DEUX familles de précautions dans
 * `propagate`/`pairDeductions`: la garde n°1 (voisin EXCLU mais atteignable
 * par un neurone miroir, voir `hasRiskyExcludedNeighbor`/
 * `illuminationCandidates` — antérieure au fix de polarité, ne cause AUCUNE
 * explosion de branchement, reste en place inchangée aujourd'hui) et la
 * garde n°2 (case candidate au FORÇAGE elle-même atteignable — le fix de
 * polarité "second risque symétrique", qui abstenait explicitement plutôt
 * que de forcer). La garde n°2 a depuis été SUPPRIMÉE (plus de code du tout,
 * plus seulement neutralisée ici) au profit d'une résolution de la polarité
 * différée à la feuille (voir `resolveLeafOutcomes`/`resolveLeafWin`) — ce
 * Set ne gate donc plus QUE la garde n°1 désormais, mais le raisonnement de
 * sûreté reste identique et vaut la peine d'être répété : le bug visé par
 * la garde n°2 concernait EXCLUSIVEMENT la couleur — un duplicata de
 * neurone miroir hérite TOUJOURS la couleur de son origine et bloque un
 * laser coloré qui le toucherait directement (voir grid.js
 * `_mirrorLaserBlocked`/`_litColor`) — donc sans aucune cible de couleur
 * sur le plateau, `isWon()` ne lit jamais `_colorMatch` (voir grid.js,
 * uniquement pour `cell.target` truthy) : la polarité origine/duplicata est
 * rigoureusement invisible pour toute condition de victoire ou tout
 * `_state` d'indice (qui ne regardent que `hasLight(r,c)`, jamais qui est
 * "origine"). Garder la garde n°1 active (même sans couleur) reste
 * nécessaire pour une raison différente et toujours valable: un voisin
 * "exclu" par hypothèse de branchement peut malgré tout s'allumer plus tard
 * via un duplicata, ce qui n'a rien à voir avec la couleur — voir le
 * commentaire en tête de fichier.
 */
function computeMirrorReachableIfNeeded(grid, hasColorTargets) {
  if (!hasColorTargets) return new Set();
  return computeMirrorReachable(grid);
}

/**
 * Signature du plateau final à une feuille GAGNANTE — sert à dédupliquer
 * les solutions comptées par `countSolutions`/`enumerateSolutions`/
 * `analyzeAndCount` (voir leur usage de `seenSignatures`).
 *
 * Neurone miroir [expérimental], nécessaire depuis le fix ci-dessus
 * (voir le commentaire en tête de fichier, "second risque symétrique") :
 * quand une paire origine/duplicata n'a AUCUNE contrainte qui départage
 * laquelle des deux doit être l'origine (aucun laser coloré ne touche
 * spécifiquement l'une des deux cases différemment de l'autre), les DEUX
 * polarités sont maintenant explorées par le backtracking (au lieu d'une
 * seule imposée à tort comme avant le fix) — et aboutissent à un plateau
 * final RIGOUREUSEMENT IDENTIQUE (mêmes cases allumées, mêmes couleurs),
 * seule la case techniquement enregistrée comme "posée par le joueur" (par
 * opposition à "duplicata") diffère dans `getPlacedLights()`. Sans
 * déduplication, ces deux chemins de recherche distincts seraient comptés
 * comme deux solutions différentes, cassant à tort l'unicité de niveaux qui
 * n'ont pourtant qu'un seul plateau final possible — un simple changement
 * de polarité sans conséquence visuelle ou fonctionnelle n'est pas une
 * "autre solution".
 *
 * La signature capture donc l'ensemble des cases allumées (réelles ET
 * duplicatas confondus, voir `grid.lights`) et, seulement si le plateau a
 * au moins une cible de couleur (`hasColorTargets`, voir
 * `boardHasColorTargets` — sinon `_lit` n'est pas forcément frais, un
 * `grid.recompute()` complet n'étant déclenché que dans ce cas, voir
 * `resolveLeafOutcomes`/`resolveLeafWin`), la couleur effective de chacune : deux plateaux
 * avec les mêmes cases allumées dans les mêmes couleurs sont le MÊME
 * plateau du point de vue du joueur, quelle que soit la case qui a
 * techniquement "déclenché" quel duplicata.
 */
function boardSignature(grid, hasColorTargets) {
  const litKeys = Array.from(grid.lights).sort();
  if (!hasColorTargets) return litKeys.join(",");
  let colorSig = "";
  for (const k of litKeys) {
    const [r, c] = k.split(",").map(Number);
    const lit = grid.cellAt(r, c)._lit;
    colorSig += (lit.r ? "1" : "0") + (lit.g ? "1" : "0") + (lit.b ? "1" : "0");
  }
  return litKeys.join(",") + "|" + colorSig;
}

/**
 * Neurone miroir [expérimental] — résolution de polarité DIFFÉRÉE À LA
 * FEUILLE (voir le commentaire en tête de fichier, section "Solution
 * ACTUELLE"). Ce groupe de fonctions remplace `refreshForLeafCheck()` +
 * `grid.isWon()` à chaque point de feuille des cinq fonctions exportées.
 *
 * `collectActiveMirrorGroups`: à partir de `grid._mirrorDuplicateOf` (déjà
 * tenu à jour par `toggleLight`, voir grid.js), regroupe chaque origine
 * actuellement posée avec la liste de ses duplicatas — un groupe par
 * origine RÉELLEMENT active (donc jamais de taille 1: une entrée dans
 * `_mirrorDuplicateOf` implique au moins un duplicata). C'est exactement
 * l'ensemble des groupes dont la polarité (qui est l'origine) est encore
 * "arbitraire" au sens où Stage 1/1.5/2 l'ont fixée par un simple ordre de
 * balayage déterministe, jamais par nécessité — voir le raisonnement en
 * tête de fichier sur l'invariance de `hasLight`/`_illuminated`/`_state`.
 */
function collectActiveMirrorGroups(grid) {
  const byOrigin = new Map();
  for (const [dupKey, originKey] of grid._mirrorDuplicateOf.entries()) {
    if (!byOrigin.has(originKey)) byOrigin.set(originKey, []);
    byOrigin.get(originKey).push(dupKey);
  }
  const groups = [];
  for (const [originKey, dupKeys] of byOrigin.entries()) {
    groups.push({ origin: originKey, memberKeys: [originKey, ...dupKeys] });
  }
  return groups;
}

function keyToRC(key) {
  const [r, c] = key.split(",").map(Number);
  return [r, c];
}

/**
 * Retire le groupe actuellement posé en `fromOriginKey`, puis le repose
 * avec `toOriginKey` comme nouvelle origine (mêmes membres au final, sauf
 * échec — voir plus bas). Utilise volontairement `{full:false}` (voir
 * `toggleLight`): la position/l'illumination ne changent jamais entre deux
 * choix d'origine (voir le raisonnement en tête de fichier), seule la
 * couleur diffère, et elle sera recalculée par UN SEUL `grid.recompute()`
 * une fois toutes les origines d'une combinaison fixées (voir
 * `forEachOriginCombo`/`tryResolveOriginsForWin`) plutôt qu'à chaque
 * échange individuel.
 *
 * Retourne `true` si l'échange a réussi, `false` sinon (ex: `toOriginKey`
 * est illuminée par autre chose sur le plateau, ce qui est un cas légitime
 * de règle du jeu — voir grid.js `toggleLight` — pas un bug) ; dans ce cas
 * le groupe est restauré sur `fromOriginKey` avant de rendre la main, la
 * grille ressort donc TOUJOURS inchangée d'un appel qui retourne `false`.
 */
function trySwapGroupOrigin(grid, fromOriginKey, toOriginKey) {
  const [fr, fc] = keyToRC(fromOriginKey);
  const removed = grid.toggleLight(fr, fc, { full: false });
  if (removed !== "removed") return false; // ne devrait jamais arriver
  const [tr, tc] = keyToRC(toOriginKey);
  const placed = grid.toggleLight(tr, tc, { full: false });
  if (placed === "placed") return true;
  grid.toggleLight(fr, fc, { full: false }); // restaure l'origine de départ
  return false;
}

/**
 * Énumère (récursivement, un groupe à la fois) TOUTES les combinaisons
 * d'origines pour les groupes actifs `groups`, appelle `onCombo()` à chaque
 * combinaison atteignable une fois `grid.recompute()` fait (à l'appelant de
 * lire `grid.isWon(...)`), puis restaure systématiquement l'origine
 * d'origine de chaque groupe avant de revenir — la grille ressort donc
 * TOUJOURS identique à l'entrée, quel que soit le nombre de combinaisons
 * visitées. Utilisée par `resolveLeafOutcomes` (recherche exhaustive:
 * countSolutions/enumerateSolutions/analyzeAndCount ont besoin de
 * continuer à explorer d'autres branches après cette feuille).
 *
 * Suit l'origine COURANTE de chaque groupe dans une variable locale
 * mutable (`currentOrigin`), jamais `group.origin` figé: après un premier
 * échange réussi, l'origine d'origine devient elle-même un duplicata
 * (`toggleLight` refuse de la "retirer" directement, voir
 * `trySwapGroupOrigin`) — restaurer/enchaîner à partir d'une référence figée
 * bloquerait silencieusement tout échange suivant pour ce même groupe.
 */
function forEachOriginCombo(grid, groups, idx, onCombo) {
  if (idx === groups.length) {
    grid.recompute();
    onCombo();
    return;
  }
  const group = groups[idx];
  let currentOrigin = group.origin;
  for (const candidateKey of group.memberKeys) {
    if (candidateKey === currentOrigin) {
      forEachOriginCombo(grid, groups, idx + 1, onCombo);
    } else {
      const ok = trySwapGroupOrigin(grid, currentOrigin, candidateKey);
      if (!ok) continue;
      currentOrigin = candidateKey;
      forEachOriginCombo(grid, groups, idx + 1, onCombo);
      const restored = trySwapGroupOrigin(grid, currentOrigin, group.origin);
      if (restored) currentOrigin = group.origin;
    }
  }
}

/**
 * Variante "s'arrête au premier succès" de `forEachOriginCombo`, pour
 * `findSolution`/`analyzeSolve` (recherche qui s'arrête dès qu'une solution
 * existe: pas besoin d'énumérer toutes les combinaisons, et surtout on VEUT
 * laisser la grille dans l'état gagnant trouvé — `currentLights()` doit
 * refléter une combinaison d'origines réellement gagnante, pas revenir à
 * l'origine par défaut). Si elle retourne `true`, la grille reste dans CET
 * état gagnant (aucune restauration) ; si elle retourne `false`, la grille
 * est garantie identique à l'entrée (chaque échange raté est immédiatement
 * annulé avant d'essayer le candidat suivant).
 */
function tryResolveOriginsForWin(grid, groups, idx, options) {
  if (idx === groups.length) {
    grid.recompute();
    return grid.isWon(options);
  }
  const group = groups[idx];
  let currentOrigin = group.origin;
  for (const candidateKey of group.memberKeys) {
    if (candidateKey === currentOrigin) {
      if (tryResolveOriginsForWin(grid, groups, idx + 1, options)) return true;
    } else {
      const ok = trySwapGroupOrigin(grid, currentOrigin, candidateKey);
      if (!ok) continue;
      currentOrigin = candidateKey;
      if (tryResolveOriginsForWin(grid, groups, idx + 1, options)) return true;
      const restored = trySwapGroupOrigin(grid, currentOrigin, group.origin);
      if (restored) currentOrigin = group.origin;
    }
  }
  return false;
}

/**
 * Garde-fou partagé par `resolveLeafOutcomes`/`resolveLeafWin`: borne le
 * nombre total de combinaisons d'origines à essayer (produit des tailles de
 * chaque groupe actif) — même principe que le `n > 12` de `pairDeductions`.
 * Jamais atteint en pratique lors de la validation (42 niveaux + 6 plateaux
 * de bench, au plus 8 combinaisons observées), mais évite toute explosion
 * combinatoire pathologique sur un plateau futur avec de nombreux groupes
 * de neurone miroir simultanément actifs.
 */
const MAX_ORIGIN_COMBOS = 64;

function totalOriginCombos(groups) {
  let total = 1;
  for (const g of groups) total *= g.memberKeys.length;
  return total;
}

/**
 * Remplace `refreshForLeafCheck(grid, hasColorTargets); grid.isWon(options)`
 * pour les recherches EXHAUSTIVES (countSolutions/enumerateSolutions/
 * analyzeAndCount, qui continuent d'explorer d'autres branches après cette
 * feuille — la grille doit donc ressortir inchangée). Essaie d'abord la
 * combinaison d'origines telle quelle (chemin rapide, cas très majoritaire
 * — voir le commentaire en tête de fichier); si elle échoue ET que le
 * plateau a des cibles de couleur, réessaie les autres origines possibles
 * des groupes de neurone miroir ACTIFS avant de conclure à un échec.
 *
 * Retourne la liste des issues GAGNANTES distinctes trouvées à cette
 * feuille — `{ sig, lights }`, `sig` la signature dédupliquée (voir
 * `boardSignature`) et `lights` l'ensemble des cases RÉELLEMENT cliquées
 * pour CETTE issue précise (voir `getPlacedLights()` — capturé au moment
 * même où `isWon()` est vrai pour cette combinaison, avant toute
 * restauration, car l'origine d'un groupe fait partie de "qui a cliqué
 * quoi"). 0, 1, ou plusieurs entrées: plusieurs si différentes origines
 * produisent des couleurs finales différentes qui satisfont TOUTES
 * `isWon()` — ce sont alors de vraies solutions distinctes du point de vue
 * du joueur, voir `boardSignature`.
 */
function resolveLeafOutcomes(grid, hasColorTargets, options) {
  if (hasColorTargets) grid.recompute();
  if (grid.isWon(options)) {
    return [{ sig: boardSignature(grid, hasColorTargets), lights: grid.getPlacedLights() }];
  }
  if (!hasColorTargets) return [];

  const groups = collectActiveMirrorGroups(grid);
  if (groups.length === 0 || totalOriginCombos(groups) > MAX_ORIGIN_COMBOS) return [];

  const outcomes = [];
  const seenHere = new Set();
  forEachOriginCombo(grid, groups, 0, () => {
    if (grid.isWon(options)) {
      const sig = boardSignature(grid, hasColorTargets);
      if (!seenHere.has(sig)) {
        seenHere.add(sig);
        outcomes.push({ sig, lights: grid.getPlacedLights() });
      }
    }
  });
  // `forEachOriginCombo` restaure déjà les origines d'un point de vue
  // `grid.lights`/`_mirrorDuplicateOf`, mais `_lit`/`_colorMatch` datent du
  // dernier `recompute()` de la boucle (une combinaison alternative) — un
  // dernier `recompute()` remet `grid` dans un état cohérent avec
  // l'origine par défaut avant de rendre la main à l'appelant.
  if (groups.length > 0) grid.recompute();
  return outcomes;
}

/**
 * Remplace `refreshForLeafCheck(grid, hasColorTargets); grid.isWon(options)`
 * pour les recherches qui s'ARRÊTENT AU PREMIER SUCCÈS (findSolution/
 * analyzeSolve). Retourne `true`/`false` ; si `true`, la grille reste dans
 * l'état gagnant trouvé (une combinaison d'origines peut avoir été changée
 * — voir `tryResolveOriginsForWin` — c'est voulu: l'appelant lit
 * `getPlacedLights()` juste après) ; si `false`, la grille est garantie
 * identique à l'état d'entrée (aucun effet de bord sur un échec, cohérent
 * avec le reste de `propagate`/`search`).
 */
function resolveLeafWin(grid, hasColorTargets, options) {
  if (hasColorTargets) grid.recompute();
  if (grid.isWon(options)) return true;
  if (!hasColorTargets) return false;

  const groups = collectActiveMirrorGroups(grid);
  if (groups.length === 0 || totalOriginCombos(groups) > MAX_ORIGIN_COMBOS) return false;

  return tryResolveOriginsForWin(grid, groups, 0, options);
}

/** Toutes les cases EMPTY ni allumées, ni exclues: ce qui reste à décider. */
function getUndecided(grid, excluded) {
  const result = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cellAt(r, c);
      if (cell.type !== CellType.EMPTY) continue;
      if (grid.hasLight(r, c)) continue;
      if (excluded.has(idxOf(grid, r, c))) continue;
      result.push([r, c]);
    }
  }
  return result;
}

/**
 * Deux cases sont "mutuellement visibles" si elles sont sur la même
 * ligne/colonne sans aucun obstacle (case non-EMPTY) entre elles — dans ce
 * cas, au plus une des deux peut porter une lumière (une case déjà
 * éclairée ne peut pas en recevoir une autre). Propriété purement
 * structurelle: ne dépend pas des lumières actuellement posées.
 */
function mutuallyVisible(grid, [r1, c1], [r2, c2]) {
  if (r1 === r2) {
    const [lo, hi] = c1 < c2 ? [c1, c2] : [c2, c1];
    for (let c = lo + 1; c < hi; c++) {
      if (grid.cellAt(r1, c).type !== CellType.EMPTY) return false;
    }
    return true;
  }
  if (c1 === c2) {
    const [lo, hi] = r1 < r2 ? [r1, r2] : [r2, r1];
    for (let r = lo + 1; r < hi; r++) {
      if (grid.cellAt(r, c1).type !== CellType.EMPTY) return false;
    }
    return true;
  }
  return false;
}

/**
 * Déductions "stage 2" pour une paire d'indices (clues) en interaction.
 * Retourne `null` si la paire n'a rien à apporter (un des deux n'a plus de
 * case libre — déjà couvert par stage 1), `{ ok:false }` si aucune
 * combinaison jointe n'est possible (contradiction), ou
 * `{ ok:true, forcedLit, forcedDark }` avec les cases qui prennent la même
 * valeur dans TOUTES les combinaisons valides (donc certaines).
 *
 * PERF (round mobile, voir historique) : prend `infoA`/`infoB` déjà
 * calculés (`{ r, c, needed, free, risky }`, voir leur construction dans
 * `propagate`) plutôt que `[r, c, number]` brut — auparavant recalculés
 * (litNeighborCount/freeUndecidedNeighbors/hasRiskyExcludedNeighbor, 3
 * balayages de voisins chacun) à CHAQUE PAIRE (i,j), alors que ces valeurs
 * ne dépendent que d'un seul indice à la fois et sont donc identiques pour
 * les n-1 autres paires qui impliquent ce même indice, tant que rien n'a
 * changé sur la grille — précisément le cas pour toute la durée d'un même
 * balayage Stage 2 (voir le commentaire dans `propagate`: la boucle sort
 * dès qu'une paire force quelque chose, avant qu'aucune autre paire n'ait pu
 * lire un état périmé). Un profil CPU (--prof) sur une génération 2★ toutes
 * features a mesuré `litNeighborCount`+`freeUndecidedNeighbors` à eux seuls
 * ~19% du temps JS total — cette seule redondance en repartait pour une part
 * significative (n indices → jusqu'à n-1 recalculs identiques chacun).
 */
function pairDeductions(grid, infoA, infoB, mirrorReachable) {
  const { needed: neededA, free: freeA, risky: riskyA } = infoA;
  const { needed: neededB, free: freeB, risky: riskyB } = infoB;
  if (freeA.length === 0 || freeB.length === 0) return null;
  if (neededA < 0 || neededB < 0) return { ok: false };

  // Voir le commentaire en tête de fichier: si l'un des deux indices a un
  // voisin exclu par hypothèse de branchement mais atteignable par un
  // neurone miroir, on ne peut se fier ni à `freeA.length`/`freeB.length`
  // (une case "exclue" peut encore s'allumer plus tard), ni donc à aucune
  // déduction qui en dépend — on s'abstient plutôt que de risquer une
  // fausse certitude.
  if (riskyA || riskyB) return null;

  if (neededA > freeA.length || neededB > freeB.length) {
    return { ok: false };
  }

  // Variables combinées, dédupliquées si une case est adjacente aux DEUX indices.
  const varIndex = new Map();
  const vars = [];
  for (const cell of [...freeA, ...freeB]) {
    const k = keyOf(cell[0], cell[1]);
    if (!varIndex.has(k)) {
      varIndex.set(k, vars.length);
      vars.push(cell);
    }
  }
  const idxA = freeA.map(([r, c]) => varIndex.get(keyOf(r, c)));
  const idxB = freeB.map(([r, c]) => varIndex.get(keyOf(r, c)));

  const n = vars.length;
  if (n > 12) return null; // garde-fou: 2^12 reste trivial, au-delà on laisse le stage1/le branchement gérer

  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (mutuallyVisible(grid, vars[i], vars[j])) edges.push([i, j]);
    }
  }

  const validMasks = [];
  const total = 1 << n;
  for (let mask = 0; mask < total; mask++) {
    let countA = 0;
    for (const i of idxA) if ((mask >> i) & 1) countA++;
    if (countA !== neededA) continue;
    let countB = 0;
    for (const i of idxB) if ((mask >> i) & 1) countB++;
    if (countB !== neededB) continue;
    let edgesOk = true;
    for (const [i, j] of edges) {
      if ((mask >> i) & 1 && (mask >> j) & 1) {
        edgesOk = false;
        break;
      }
    }
    if (edgesOk) validMasks.push(mask);
  }

  if (validMasks.length === 0) return { ok: false };

  const forcedLit = [];
  const forcedDark = [];
  for (let i = 0; i < n; i++) {
    const allLit = validMasks.every((m) => (m >> i) & 1);
    const allDark = !allLit && validMasks.every((m) => !((m >> i) & 1));
    if (allLit) {
      // Neurone miroir [expérimental]: forçage toujours sûr, même
      // raisonnement que Stage 1/1.5 (voir le commentaire en tête de
      // fichier, section "Solution ACTUELLE") — la couleur est gérée à la
      // feuille, pas ici.
      forcedLit.push(vars[i]);
    } else if (allDark) forcedDark.push(vars[i]);
  }
  return { ok: true, forcedLit, forcedDark };
}

/**
 * Fait progresser toutes les déductions certaines jusqu'à point fixe.
 * Retourne `{ ok:false }` (déjà annulé en interne) en cas de contradiction,
 * ou `{ ok:true, litAdded, excludedAdded }` sinon — l'appelant doit annuler
 * `litAdded`/`excludedAdded` lui-même une fois le noeud terminé.
 */
function propagate(grid, excluded, mirrorReachable, stats) {
  const litAdded = [];
  const excludedAdded = [];

  function undo() {
    for (let i = litAdded.length - 1; i >= 0; i--) {
      grid.toggleLight(litAdded[i][0], litAdded[i][1], { full: false });
    }
    for (const k of excludedAdded) excluded.delete(k);
  }

  function forceLit(r, c) {
    if (grid.hasLight(r, c)) return true;
    const placed = grid.toggleLight(r, c, { full: false }) === "placed";
    if (placed) litAdded.push([r, c]);
    return placed;
  }

  function forceExcluded(r, c) {
    const idx = idxOf(grid, r, c);
    if (!excluded.has(idx)) {
      excluded.add(idx);
      excludedAdded.push(idx);
    }
  }

  // Candidat de branchement (voir pickBranchCell): repéré À LA VOLÉE
  // pendant CETTE même passe Stage 1 plutôt que par un rebalayage complet
  // séparé de la grille après coup (c'est exactement ce que faisait
  // l'appelant avant : `pickBranchCell` reparcourait toute la grille avec
  // la même logique de sélection). Réinitialisé à chaque itération de
  // `while(changed)` : si cette itération force quoi que ce soit
  // (`changed = true`), les valeurs needed/free ci-dessous seront
  // périmées à la prochaine itération donc sans intérêt ; seule la
  // TOUT dernière itération — celle où Stage 1 ET Stage 1.5 ET Stage 2 ne
  // trouvent plus rien à forcer, juste avant le `return { ok: true, ... }`
  // final — a des valeurs garanties à jour, car rien ne change plus la
  // grille entre le moment où elles sont mesurées et le retour de la
  // fonction. C'est cette dernière itération qui compte : les autres sont
  // écrasées avant d'être utilisées.
  let branchCell = null;
  let branchNeeded = 0;
  let branchFree = null;
  let branchScore = Infinity;
  let branchFreeLen = Infinity;

  let changed = true;
  while (changed) {
    changed = false;
    branchCell = null;
    branchNeeded = 0;
    branchFree = null;
    branchScore = Infinity;
    branchFreeLen = Infinity;

    // Stage 1: chaque indice/interdiction, isolément.
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cellAt(r, c);
        const isClue = cell.type === CellType.CLUE;
        const isForbidden = cell.type === CellType.FORBIDDEN;
        if (!isClue && !isForbidden) continue;

        const number = isForbidden ? 0 : cell.number;
        const needed = number - litNeighborCount(grid, r, c);
        const free = freeUndecidedNeighbors(grid, r, c, excluded);

        if (needed < 0) {
          undo();
          return { ok: false };
        }
        // Voir le commentaire en tête de fichier: un voisin exclu mais
        // atteignable par un neurone miroir peut encore s'allumer plus
        // tard — ni la contradiction "besoin > cases libres" ni la
        // déduction "besoin === cases libres ⇒ toutes allumées" ne sont
        // fiables dans ce cas, on s'abstient des deux pour cet indice. La
        // direction inverse (besoin déjà comblé ⇒ exclure le reste) reste
        // sûre dans tous les cas (auto-corrigée à la prochaine passe si un
        // duplicata prouve le contraire), donc jamais gardée.
        if (needed === 0 && free.length > 0) {
          for (const [fr, fc] of free) forceExcluded(fr, fc);
          changed = true;
          continue;
        }
        if (hasRiskyExcludedNeighbor(grid, r, c, excluded, mirrorReachable)) continue;
        if (needed > free.length) {
          undo();
          return { ok: false };
        }
        // Neurone miroir [expérimental]: forçage désormais toujours sûr ici
        // (voir le nouveau commentaire en tête de fichier, section "Solution
        // ACTUELLE") — `hasLight`/`_illuminated`/`_state` sont origine-
        // invariants, donc rien de ce que Stage 1 conclut à partir d'eux ne
        // peut être faussé par la polarité (origine vs duplicata) d'un
        // groupe de neurone miroir. La seule ambiguïté réelle (qui capte les
        // lasers colorés) est résolue plus tard, à la feuille, uniquement si
        // elle a un impact observable — voir `resolveLeafOutcomes`/
        // `resolveLeafWin`.
        if (needed > 0 && needed === free.length) {
          for (const [fr, fc] of free) {
            if (!forceLit(fr, fc)) {
              undo();
              return { ok: false };
            }
          }
          changed = true;
        } else if (isClue && needed > 0 && free.length > 0) {
          // Candidat de branchement potentiel — même critère que
          // pickBranchCell (le moins de combinaisons possibles restantes).
          const score = binom(free.length, needed);
          if (score < branchScore || (score === branchScore && free.length < branchFreeLen)) {
            branchScore = score;
            branchFreeLen = free.length;
            branchCell = free[0];
            branchNeeded = needed;
            branchFree = free;
          }
        }
      }
    }
    if (changed) continue; // relance stage 1 avant de tenter stage 2

    // Stage 1.5: chaque case vide sans lumière doit finir illuminée (voir
    // grid.js isWon: `else if (!cell._illuminated) return false`) — si elle
    // n'a plus qu'UN candidat restant capable de l'illuminer (elle-même, si
    // pas exclue, ou une case libre sur sa ligne/colonne jusqu'au premier
    // obstacle), ce candidat est forcé allumé ; s'il n'en reste aucun,
    // contradiction immédiate — détectée ici plutôt qu'à la feuille (voir
    // isWon), donc potentiellement bien plus tôt qu'aujourd'hui. `_illuminated`
    // est déjà tenu à jour à chaque case (voir toggleLight{full:false}),
    // donc coût O(1) pour écarter la grande majorité des cases déjà
    // couvertes avant de payer le balayage sur celles qui ne le sont pas.
    //
    // Même prudence que hasRiskyExcludedNeighbor pour le Neurone miroir
    // [expérimental]: si un candidat écarté par `excluded` est atteignable
    // par un neurone miroir (donc pas vraiment certain de rester noir), on
    // s'abstient de toute conclusion pour CETTE case plutôt que de risquer
    // une fausse certitude — voir `illuminationCandidates`.
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cellAt(r, c);
        if (cell.type !== CellType.EMPTY || cell._illuminated) continue;

        const candidates = illuminationCandidates(grid, r, c, excluded, mirrorReachable);
        if (!candidates) continue; // abstention (risque miroir)

        if (candidates.length === 0) {
          undo();
          return { ok: false };
        }
        if (candidates.length === 1) {
          const [fr, fc] = candidates[0];
          // Neurone miroir [expérimental]: forçage toujours sûr, même
          // raisonnement que Stage 1 ci-dessus (voir le commentaire en tête
          // de fichier, section "Solution ACTUELLE") — l'illumination est
          // origine-invariante, seule la couleur ne l'est pas, et elle est
          // gérée à la feuille, pas ici.
          if (!forceLit(fr, fc)) {
            undo();
            return { ok: false };
          }
          if (stats) {
            // Même rôle que `stats.stage2Used` (voir Stage 2 plus bas) : signale
            // qu'une déduction NON triviale (au-delà de Stage 1) a été nécessaire
            // ici. Stage 1.5 absorbe désormais une bonne partie de ce qui
            // nécessitait autrefois Stage 2 (voir computeTier) — sans ce
            // deuxième signal, computeTier perdrait la trace de cette difficulté
            // réelle et plafonnerait à tort au palier 1.
            stats.stage15Used = true;
          }
          changed = true;
        }
      }
    }
    if (changed) continue; // relance stage 1 avant de tenter stage 2

    // Stage 2: paires d'indices dont certaines cases libres s'excluent mutuellement.
    const clues = [];
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.cellAt(r, c);
        if (cell.type === CellType.CLUE) clues.push([r, c, cell.number]);
      }
    }
    // PERF (voir le commentaire de pairDeductions) : needed/free/risky ne
    // dépendent que d'UN SEUL indice (pas de la paire) et rien ne change la
    // grille/`excluded` tant qu'aucune paire n'a rien forcé dans CE balayage
    // — calculés une seule fois par indice ici plutôt qu'une fois par paire
    // (i,j) qui l'implique.
    const clueInfo = clues.map(([r, c, number]) => ({
      needed: number - litNeighborCount(grid, r, c),
      free: freeUndecidedNeighbors(grid, r, c, excluded),
      risky: hasRiskyExcludedNeighbor(grid, r, c, excluded, mirrorReachable),
    }));
    outer: for (let i = 0; i < clues.length; i++) {
      for (let j = i + 1; j < clues.length; j++) {
        const result = pairDeductions(grid, clueInfo[i], clueInfo[j], mirrorReachable);
        if (!result) continue;
        if (!result.ok) {
          undo();
          return { ok: false };
        }
        if (stats && (result.forcedLit.length > 0 || result.forcedDark.length > 0)) {
          // Voir analyzeSolve(): une déduction Stage 2 a été NÉCESSAIRE pour
          // avancer ici (Stage 1 seul ne suffisait plus) — signal utilisé
          // pour noter la difficulté réelle du niveau, indépendant de la
          // recherche de solution elle-même (stats est toujours `undefined`
          // pour countSolutions/enumerateSolutions/findSolution).
          stats.stage2Used = true;
          stats.stage2Count++;
        }
        for (const [fr, fc] of result.forcedLit) {
          if (!forceLit(fr, fc)) {
            undo();
            return { ok: false };
          }
          changed = true;
        }
        for (const [fr, fc] of result.forcedDark) {
          forceExcluded(fr, fc);
          changed = true;
        }
        if (changed) break outer; // repart de stage 1 avec les nouvelles infos
      }
    }
  }

  return {
    ok: true,
    litAdded,
    excludedAdded,
    // Cellule de branchement déjà identifiée pendant Stage 1 (voir plus
    // haut) — `null` si aucun indice actif n'en propose (zone ouverte,
    // repli sur `undecided[0]` côté appelant, comme pickBranchCell).
    branchCandidate: branchCell ? { cell: branchCell, needed: branchNeeded, free: branchFree } : null,
  };
}

/**
 * Palier de difficulté RÉEL (1 à 4) déduit des statistiques de résolution —
 * partagé par `analyzeSolve`/`analyzeAndCount`. Le palier 2+ exige qu'une
 * déduction non triviale (Stage 1.5 OU Stage 2, voir commentaire en tête de
 * fichier) ait été nécessaire : sans ça, aucune grille ne dépasse le palier
 * 1, même avec un `branchCount` élevé (grande zone ouverte, mais aucun "lieu
 * de doute" réel). Les seuils sont calibrés empiriquement (voir
 * docs/infinite-mode-design.md §10) et n'ont pas de signification physique —
 * seule leur ORDRE relatif compte.
 *
 * Recalibré après l'introduction de Stage 1.5 (déduction par illumination) :
 * ce stage absorbe une grande partie de ce qui nécessitait autrefois du
 * backtracking (voire Stage 2), donc (a) `stage2Used` seul n'est plus un
 * signal fiable de "déduction non triviale" — d'où `stage15Used` en renfort
 * ci-dessous — et (b) la distribution de `branchCount` atteignable s'est
 * effondrée d'un ordre de grandeur (sweep empirique 3★+couleur+miroir, 15
 * seeds : médiane ~130, max ~211, contre médiane ~450 avant Stage 1.5). Les
 * seuils sont donc resserrés en conséquence — à réajuster de nouveau si la
 * distribution bouge encore (générateur/mécaniques futurs).
 */
function computeTier(stage2Used, branchCount, stage15Used) {
  if (!stage2Used && !stage15Used) return branchCount <= 25 ? 1 : 2;
  if (branchCount <= 60) return 2;
  if (branchCount <= 130) return 3;
  return 4;
}

function binom(n, k) {
  if (k < 0 || k > n) return Infinity;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/**
 * Choisit la prochaine case sur laquelle brancher: celle qui appartient à
 * l'indice le plus "serré" (le moins de combinaisons possibles restantes,
 * ex: choisir entre 2 plutôt qu'entre 3) plutôt que la première case
 * trouvée. Sans indice encore actif à proximité (zone complètement
 * ouverte), on retombe sur la première case non décidée.
 */
function pickBranchCell(grid, undecided, excluded) {
  let bestCell = null;
  let bestScore = Infinity;
  let bestFreeLen = Infinity;

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const cell = grid.cellAt(r, c);
      if (cell.type !== CellType.CLUE) continue;
      const needed = cell.number - litNeighborCount(grid, r, c);
      if (needed <= 0) continue;
      const free = freeUndecidedNeighbors(grid, r, c, excluded);
      if (free.length === 0) continue;
      const score = binom(free.length, needed);
      if (score < bestScore || (score === bestScore && free.length < bestFreeLen)) {
        bestScore = score;
        bestFreeLen = free.length;
        bestCell = free[0];
      }
    }
  }

  return bestCell || undecided[0];
}

/**
 * Décide quelle branche essayer EN PREMIER pour une case de branchement
 * donnée ("exclue" ou "allumée") — les DEUX branches restent toujours
 * explorées ensuite (voir enumerateSolutions/analyzeAndCount: sémantique
 * "exhaustif jusqu'à cap", pas "premier trouvé" comme findSolution), donc
 * ceci ne fait qu'influencer l'ORDRE, jamais le résultat final.
 *
 * Priorité 1 (indice de solution) : si une solution précédente est connue
 * (`hintSet`, ensemble d'indices `idxOf` des cases allumées de cette
 * solution — voir generator.js, qui la reconstruit à chaque appel depuis
 * `analyzeAndCount`/`enumerateSolutions` précédent), on rejoue directement
 * son choix pour cette case : statistiquement, la grille n'a que peu
 * changé d'un appel à l'autre (un retrait/coloriage/nettoyage à la fois),
 * donc la solution précédente reste très probablement encore valide.
 *
 * Priorité 2 (sens du branchement), utilisée seulement en l'absence
 * d'indice : une charge à `needed === 1` est immédiatement satisfaite dès
 * qu'ON ALLUME un candidat (Stage 1 exclut alors le reste au prochain
 * passage) — essayer "allumée" en premier colle donc à la déduction la
 * plus rapide. Symétriquement, `needed === free.length - 1` est
 * immédiatement satisfaite en EXCLUANT un candidat (le reste devient
 * needed === free.length, donc tous forcés allumés) — c'est déjà l'ordre
 * par défaut ci-dessous. Aucun signal fort dans les autres cas : on garde
 * "exclue d'abord", cohérent avec le comportement historique.
 */
function decideBranchOrder(hintSet, idx, needed) {
  if (hintSet) return hintSet.has(idx) ? "lit" : "excluded";
  if (needed === 1) return "lit";
  return "excluded";
}

/**
 * Retourne le nombre de solutions valides, plafonné à `cap` (par défaut 2 :
 * juste assez pour distinguer "aucune", "unique" et "plusieurs").
 *
 * `maxNodes` limite l'exploration pour éviter un blocage sur une grille peu
 * contrainte : au-delà, on renvoie `{ count, exhausted: false }` (résultat
 * partiel, non concluant) plutôt que de tourner indéfiniment.
 */
export function countSolutions(level, cap = 2, maxNodes = 2_000_000, options = {}) {
  const grid = new LightUpGrid(level);
  const excluded = new Set();
  const hasColorTargets = boardHasColorTargets(grid);
  const mirrorReachable = computeMirrorReachableIfNeeded(grid, hasColorTargets);
  let count = 0;
  let nodes = 0;
  // Voir boardSignature: dédoublonne les feuilles gagnantes qui ne
  // diffèrent que par la polarité (origine/duplicata) d'une paire de
  // neurone miroir sans conséquence visuelle — sinon comptées à tort comme
  // deux solutions distinctes depuis que les deux polarités sont explorées
  // (voir le fix "second risque symétrique" en tête de fichier).
  const seenSignatures = new Set();

  function search() {
    if (count >= cap) return;
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded, mirrorReachable);
    if (!prop.ok) return;

    const undecided = getUndecided(grid, excluded);

    if (undecided.length === 0) {
      for (const { sig } of resolveLeafOutcomes(grid, hasColorTargets, options)) {
        if (count >= cap) break;
        if (!seenSignatures.has(sig)) {
          seenSignatures.add(sig);
          count++;
        }
      }
    } else {
      const [r, c] = pickBranchCell(grid, undecided, excluded);
      const idx = idxOf(grid, r, c);

      excluded.add(idx);
      search();
      excluded.delete(idx);

      if (count < cap) {
        const result = grid.toggleLight(r, c, { full: false });
        if (result === "placed") {
          if (!anyClueError(grid)) search();
          grid.toggleLight(r, c, { full: false });
        }
      }
    }

    for (let i = prop.litAdded.length - 1; i >= 0; i--) {
      grid.toggleLight(prop.litAdded[i][0], prop.litAdded[i][1], { full: false });
    }
    for (const k of prop.excludedAdded) excluded.delete(k);
  }

  try {
    search();
    return { count, exhausted: true };
  } catch (e) {
    if (e instanceof NodeBudgetExceeded) return { count, exhausted: false };
    throw e;
  }
}

/**
 * Retourne jusqu'à `cap` solutions distinctes (chacune une liste de
 * coordonnées de lumières), utile pour comparer deux solutions et trouver
 * les cases où elles diffèrent (voir scripts/diff-solutions.mjs).
 */
export function enumerateSolutions(level, cap = 5, maxNodes = 3_000_000, options = {}) {
  const grid = new LightUpGrid(level);
  const excluded = new Set();
  const hasColorTargets = boardHasColorTargets(grid);
  const mirrorReachable = computeMirrorReachableIfNeeded(grid, hasColorTargets);
  const found = [];
  let nodes = 0;
  // Voir boardSignature / countSolutions: même déduplication, pour ne pas
  // renvoyer deux entrées de `found` qui ne représentent qu'une seule et
  // même solution visuelle (polarité miroir sans conséquence).
  const seenSignatures = new Set();

  // Priorité 1 (indice de solution) : `options.hint`, si fourni, est une
  // solution déjà connue (même format que ce que retourne cette fonction :
  // liste de coordonnées [r, c]) — typiquement la solution de l'appel
  // précédent sur une grille très voisine (un retrait/coloriage/nettoyage
  // de plus). Convertie une fois ici en Set d'indices `idxOf` pour un
  // lookup O(1) à chaque case de branchement (voir decideBranchOrder).
  const { hint, ...winOptions } = options;
  const hintSet = hint ? new Set(hint.map(([r, c]) => idxOf(grid, r, c))) : null;

  // Exclut les duplicatas de neurone miroir [expérimental]: ils
  // apparaissent automatiquement dès qu'on pose leur origine (voir
  // grid.js: toggleLight), une solution ne doit donc lister que les coups
  // réellement joués par le joueur — cohérent avec getPlacedLightCount().
  function currentLights() {
    return grid.getPlacedLights();
  }

  function search() {
    if (found.length >= cap) return;
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded, mirrorReachable);
    if (!prop.ok) return;

    const undecided = getUndecided(grid, excluded);

    if (undecided.length === 0) {
      for (const { sig, lights } of resolveLeafOutcomes(grid, hasColorTargets, winOptions)) {
        if (found.length >= cap) break;
        if (!seenSignatures.has(sig)) {
          seenSignatures.add(sig);
          found.push(lights);
        }
      }
    } else {
      // pickBranchCell incrémental: la cellule de branchement a déjà été
      // repérée par propagate() pendant sa dernière passe Stage 1 (voir
      // commentaire dans propagate) — on ne relance un rebalayage complet
      // que dans le cas rare où aucun indice actif n'en propose (zone
      // ouverte).
      let r, c, needed;
      if (prop.branchCandidate) {
        [r, c] = prop.branchCandidate.cell;
        needed = prop.branchCandidate.needed;
      } else {
        [r, c] = pickBranchCell(grid, undecided, excluded);
      }
      const idx = idxOf(grid, r, c);

      // Ordre exhaustif préservé dans les deux cas (voir decideBranchOrder):
      // les DEUX branches sont toujours essayées, seul l'ORDRE change.
      const order = decideBranchOrder(hintSet, idx, needed);
      const tryExcludedFirst = () => {
        excluded.add(idx);
        search();
        excluded.delete(idx);
      };
      const tryLitSecond = () => {
        if (found.length < cap) {
          const result = grid.toggleLight(r, c, { full: false });
          if (result === "placed") {
            if (!anyClueError(grid)) search();
            grid.toggleLight(r, c, { full: false });
          }
        }
      };
      const tryLitFirst = () => {
        const result = grid.toggleLight(r, c, { full: false });
        if (result === "placed") {
          if (!anyClueError(grid)) search();
          grid.toggleLight(r, c, { full: false });
        }
      };
      const tryExcludedSecond = () => {
        if (found.length < cap) {
          excluded.add(idx);
          search();
          excluded.delete(idx);
        }
      };

      if (order === "lit") {
        tryLitFirst();
        tryExcludedSecond();
      } else {
        tryExcludedFirst();
        tryLitSecond();
      }
    }

    for (let i = prop.litAdded.length - 1; i >= 0; i--) {
      grid.toggleLight(prop.litAdded[i][0], prop.litAdded[i][1], { full: false });
    }
    for (const k of prop.excludedAdded) excluded.delete(k);
  }

  try {
    search();
    return { solutions: found, exhausted: true };
  } catch (e) {
    if (e instanceof NodeBudgetExceeded) return { solutions: found, exhausted: false };
    throw e;
  }
}

/** Trouve une solution (liste de coordonnées) si elle existe, sinon null. */
export function findSolution(level, maxNodes = 2_000_000) {
  const grid = new LightUpGrid(level);
  const excluded = new Set();
  const hasColorTargets = boardHasColorTargets(grid);
  const mirrorReachable = computeMirrorReachableIfNeeded(grid, hasColorTargets);
  let nodes = 0;
  let solution = null;

  // Exclut les duplicatas de neurone miroir [expérimental]: ils
  // apparaissent automatiquement dès qu'on pose leur origine (voir
  // grid.js: toggleLight), une solution ne doit donc lister que les coups
  // réellement joués par le joueur — cohérent avec getPlacedLightCount().
  function currentLights() {
    return grid.getPlacedLights();
  }

  function search() {
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded, mirrorReachable);
    let found = false;

    if (prop.ok) {
      const undecided = getUndecided(grid, excluded);

      if (undecided.length === 0) {
        if (resolveLeafWin(grid, hasColorTargets, {})) {
          solution = currentLights();
          found = true;
        }
      } else {
        const [r, c] = pickBranchCell(grid, undecided, excluded);
        const idx = idxOf(grid, r, c);

        excluded.add(idx);
        found = search();
        excluded.delete(idx);

        if (!found) {
          const result = grid.toggleLight(r, c, { full: false });
          if (result === "placed") {
            if (!anyClueError(grid)) found = search();
            if (!found) grid.toggleLight(r, c, { full: false });
          }
        }
      }

      if (!found) {
        for (let i = prop.litAdded.length - 1; i >= 0; i--) {
          grid.toggleLight(prop.litAdded[i][0], prop.litAdded[i][1], { full: false });
        }
        for (const k of prop.excludedAdded) excluded.delete(k);
      }
    }

    return found;
  }

  try {
    const solved = search();
    return solved ? solution : null;
  } catch (e) {
    if (e instanceof NodeBudgetExceeded) return null;
    throw e;
  }
}

/**
 * Comme `findSolution`, mais mesure AUSSI quelles techniques de résolution
 * ont été nécessaires — utilisé par le mode Infini (voir docs/
 * infinite-mode-design.md, section 6) pour noter la difficulté RÉELLE d'un
 * niveau généré plutôt que de deviner à partir de sa taille/densité, même
 * principe que les notations de difficulté Sudoku ("quelle est la technique
 * la plus avancée nécessaire, pas juste combien de chiffres manquent").
 *
 * Duplique volontairement la recherche de `findSolution` plutôt que de la
 * réutiliser: `propagate`/`search` sont déjà minces, et éviter de complexifier
 * les trois fonctions déjà en prod (countSolutions/enumerateSolutions/
 * findSolution) avec un paramètre `stats` qu'elles n'utilisent jamais réduit
 * le risque de régression. Une fusion des quatre en un seul coeur de
 * recherche partagé reste une amélioration future raisonnable (voir le doc),
 * pas nécessaire pour une première version.
 *
 * Retourne `null` si aucune solution n'est trouvée dans `maxNodes`, sinon
 * `{ solution, moves, stage2Used, stage2Count, branchCount, tier }`:
 * - `stage2Used` / `stage2Count`: au moins une déduction Stage 2 (paire
 *   d'indices) a servi, et combien de fois. C'est le signal de "lieu de
 *   doute" : une case où la logique indice-par-indice (Stage 1) ne suffit
 *   plus et où il faut croiser deux indices pour trancher.
 * - `branchCount`: nombre de fois où propagate seul n'a pas suffi et où il a
 *   fallu émettre une hypothèse de branchement (compté sur tout l'arbre de
 *   recherche exploré, pas seulement le chemin gagnant — un niveau mal
 *   contraint qui force beaucoup de tâtonnement, même sur des impasses,
 *   n'est pas un niveau "évident").
 * - `tier`: voir `computeTier` — la taille de grille seule ne fait PAS la
 *   difficulté, c'est `stage2Used`/`branchCount` qui décident (4 paliers:
 *   1 = Stage 1 seul, 2 = Stage 2 modéré, 3 = Stage 2 + branchement >250,
 *   4 = Stage 2 + branchement >400 — voir generator.js pour le mapping
 *   palier solveur ↔ étoiles affichées, ils ne sont PAS égaux 1:1).
 *   Seuils calibrés empiriquement sur des plateaux 5x5 à 9x9 (voir
 *   docs/infinite-mode-design.md, section 10) — pas des lois figées, à
 *   réajuster à l'usage.
 */
export function analyzeSolve(level, maxNodes = 2_000_000) {
  const grid = new LightUpGrid(level);
  const excluded = new Set();
  const hasColorTargets = boardHasColorTargets(grid);
  const mirrorReachable = computeMirrorReachableIfNeeded(grid, hasColorTargets);
  const stats = { stage2Used: false, stage2Count: 0, branchCount: 0, stage15Used: false };
  let nodes = 0;
  let solution = null;

  function currentLights() {
    return grid.getPlacedLights();
  }

  function search() {
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded, mirrorReachable, stats);
    let found = false;

    if (prop.ok) {
      const undecided = getUndecided(grid, excluded);

      if (undecided.length === 0) {
        if (resolveLeafWin(grid, hasColorTargets, {})) {
          solution = currentLights();
          found = true;
        }
      } else {
        stats.branchCount++;
        const [r, c] = pickBranchCell(grid, undecided, excluded);
        const idx = idxOf(grid, r, c);

        excluded.add(idx);
        found = search();
        excluded.delete(idx);

        if (!found) {
          const result = grid.toggleLight(r, c, { full: false });
          if (result === "placed") {
            if (!anyClueError(grid)) found = search();
            if (!found) grid.toggleLight(r, c, { full: false });
          }
        }
      }

      if (!found) {
        for (let i = prop.litAdded.length - 1; i >= 0; i--) {
          grid.toggleLight(prop.litAdded[i][0], prop.litAdded[i][1], { full: false });
        }
        for (const k of prop.excludedAdded) excluded.delete(k);
      }
    }

    return found;
  }

  let solved;
  try {
    solved = search();
  } catch (e) {
    if (e instanceof NodeBudgetExceeded) return null;
    throw e;
  }
  if (!solved) return null;

  const tier = computeTier(stats.stage2Used, stats.branchCount, stats.stage15Used);
  return {
    solution,
    moves: solution.length,
    stage2Used: stats.stage2Used,
    stage2Count: stats.stage2Count,
    branchCount: stats.branchCount,
    stage15Used: stats.stage15Used,
    tier,
  };
}

/**
 * Fusion de `countSolutions` et `analyzeSolve` en UNE seule recherche —
 * ajoutée pour le mode Infini (generator.js), qui pour chaque candidat
 * accepté payait deux arbres de recherche complets sur le même plateau :
 * un pour prouver l'unicité, un second (relancé de zéro) juste pour
 * mesurer la difficulté. Sur les plateaux 3★ (peu denses, arbre large),
 * c'était la moitié du temps de génération perdue en travail redondant.
 *
 * Le tour de passe-passe qui rend ça sûr : `stage2Used`/`stage2Count`/
 * `branchCount` ne doivent refléter QUE le chemin nécessaire pour *trouver*
 * une solution (pas l'exploration supplémentaire nécessaire pour *prouver*
 * qu'il n'y en a pas d'autre) — sinon les seuils de tier calibrés contre
 * l'ancien `analyzeSolve` (qui s'arrêtait à la première solution trouvée)
 * ne voudraient plus rien dire. Cette recherche explore exactement dans le
 * même ordre que `countSolutions`/`findSolution` (branche "exclue" toujours
 * tentée avant "posée", même heuristique de branchement) — donc la séquence
 * de noeuds visités jusqu'à la PREMIÈRE solution trouvée est rigoureusement
 * identique à ce que ferait `analyzeSolve` seul. On "gèle" donc les stats
 * dès cette première solution (on arrête de les incrémenter, sans arrêter
 * la recherche elle-même) : tout ce qui est visité ENSUITE pour vérifier
 * l'absence d'une 2e solution ne pollue plus les stats — le résultat est
 * numériquement identique à l'ancien `countSolutions(...)` +
 * `analyzeSolve(...)` séparés, pour un seul arbre parcouru au lieu de deux.
 *
 * Retourne `{ count, exhausted, solution, moves, stage2Used, stage2Count,
 * branchCount, tier }` — `solution`/`stage2*`/`branchCount`/`tier` valent
 * `null` si aucune solution n'a été trouvée du tout (mêmes conditions que
 * `countSolutions`/`analyzeSolve` pris séparément).
 */
export function analyzeAndCount(level, cap = 2, maxNodes = 2_000_000, options = {}) {
  const grid = new LightUpGrid(level);
  const excluded = new Set();
  const hasColorTargets = boardHasColorTargets(grid);
  const mirrorReachable = computeMirrorReachableIfNeeded(grid, hasColorTargets);
  const stats = { stage2Used: false, stage2Count: 0, branchCount: 0, stage15Used: false };
  let frozen = false; // true dès qu'une 1re solution a été trouvée: stats figées
  let firstSolution = null;
  let count = 0;
  let nodes = 0;
  // Voir boardSignature / countSolutions: même déduplication.
  const seenSignatures = new Set();

  // Priorité 1, cf. enumerateSolutions. IMPORTANT (voir decideSearchOrder
  // ci-dessous) : contrairement à enumerateSolutions, cette réorganisation
  // n'est appliquée ici QU'APRÈS le gel des stats (`frozen`) — tant que la
  // 1re solution n'est pas trouvée, `stats.branchCount` alimente
  // `computeTier` (calibré empiriquement sur l'ordre historique "exclue
  // d'abord" — voir doc en tête de computeTier) ; changer l'ordre AVANT le
  // gel changerait le nombre de retours-arrière nécessaires pour trouver
  // cette 1re solution donc le palier mesuré, ce qui fausserait la
  // difficulté réelle du niveau plutôt que juste sa vitesse de génération.
  // Après le gel en revanche, ce qui reste à faire est soit confirmer
  // l'unicité (explorer tout le reste sans rien compter), soit trouver vite
  // une 2e solution pour plafonner à `cap` — l'ordre n'y change JAMAIS les
  // stats, seulement la vitesse : sans risque, donc appliqué pleinement.
  const { hint, ...winOptions } = options;
  const hintSet = hint ? new Set(hint.map(([r, c]) => idxOf(grid, r, c))) : null;

  function currentLights() {
    return grid.getPlacedLights();
  }

  function search() {
    if (count >= cap) return;
    if (++nodes > maxNodes) throw new NodeBudgetExceeded();

    const prop = propagate(grid, excluded, mirrorReachable, frozen ? undefined : stats);
    if (!prop.ok) return;

    const undecided = getUndecided(grid, excluded);

    if (undecided.length === 0) {
      for (const { sig, lights } of resolveLeafOutcomes(grid, hasColorTargets, winOptions)) {
        if (count >= cap) break;
        if (!seenSignatures.has(sig)) {
          seenSignatures.add(sig);
          count++;
          if (!frozen) {
            firstSolution = lights;
            frozen = true;
          }
        }
      }
    } else {
      if (!frozen) stats.branchCount++;

      // pickBranchCell incrémental (voir enumerateSolutions) : la cellule
      // de branchement vient déjà de propagate() dans le cas commun.
      let r, c, needed;
      if (prop.branchCandidate) {
        [r, c] = prop.branchCandidate.cell;
        needed = prop.branchCandidate.needed;
      } else {
        [r, c] = pickBranchCell(grid, undecided, excluded);
      }
      const idx = idxOf(grid, r, c);

      // Voir commentaire plus haut: réordonnancement (indice/priorité 2)
      // seulement une fois les stats gelées — avant, ordre historique figé.
      const order = frozen ? decideBranchOrder(hintSet, idx, needed) : "excluded";

      if (order === "lit") {
        const result = grid.toggleLight(r, c, { full: false });
        if (result === "placed") {
          if (!anyClueError(grid)) search();
          grid.toggleLight(r, c, { full: false });
        }
        if (count < cap) {
          excluded.add(idx);
          search();
          excluded.delete(idx);
        }
      } else {
        excluded.add(idx);
        search();
        excluded.delete(idx);

        if (count < cap) {
          const result = grid.toggleLight(r, c, { full: false });
          if (result === "placed") {
            if (!anyClueError(grid)) search();
            grid.toggleLight(r, c, { full: false });
          }
        }
      }
    }

    for (let i = prop.litAdded.length - 1; i >= 0; i--) {
      grid.toggleLight(prop.litAdded[i][0], prop.litAdded[i][1], { full: false });
    }
    for (const k of prop.excludedAdded) excluded.delete(k);
  }

  let exhausted;
  try {
    search();
    exhausted = true;
  } catch (e) {
    if (e instanceof NodeBudgetExceeded) exhausted = false;
    else throw e;
  }

  const tier = firstSolution ? computeTier(stats.stage2Used, stats.branchCount, stats.stage15Used) : null;

  return {
    count,
    exhausted,
    solution: firstSolution,
    moves: firstSolution ? firstSolution.length : null,
    stage2Used: firstSolution ? stats.stage2Used : null,
    stage2Count: firstSolution ? stats.stage2Count : null,
    branchCount: firstSolution ? stats.branchCount : null,
    stage15Used: firstSolution ? stats.stage15Used : null,
    tier,
  };
}
