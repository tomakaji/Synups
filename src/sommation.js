// Mode bonus "Sommation" — PREMIER JET / PROTOTYPE DE TEST. Plateau 5x5,
// dont les 2 dernières lignes démarrent VERROUILLÉES (débloquées une par une,
// GAUCHE À DROITE, en glissant une lumière de chaque couleur à la fois sur
// les réceptacles de la case active — voir doDropOnLock) ; un objectif
// intégré directement à la grille (case 2x2, requêtes précises PAR couleur
// ET par rang plutôt qu'une jauge générique — retour utilisateur: "sinon
// pourquoi fusionner", voir doDropOnObjective) ; des générateurs (design
// "neurone") qui coûtent de VRAIS points à actionner — le solde PARTAGÉ avec
// le mode Infini (voir pointsApi/genCost, fourni par main.js) — et qui sont
// eux-mêmes UNIQUEMENT obtenus via des morceaux lootés (jamais achetés, voir
// spawnFromSelected/doFragmentCombine) ; et des actions en glisser-déposer:
//   - déposer sur une case VIDE -> déplacer librement (réorganiser le
//     plateau, retour utilisateur)
//   - lumière + lumière même couleur/même rang -> rang supérieur
//   - lumière + lumière couleurs différentes -> couleur mélangée (système
//     de canaux r/g/b déjà utilisé par le jeu principal, voir colors.js)
//   - générateur + générateur MÊME couleur -> précision supérieure (jamais
//     de fusion inter-couleur, décision explicite) — le résultat reste
//     TOUJOURS à l'emplacement de la CIBLE (case sur laquelle on dépose),
//     jamais à la source, pour un comportement prévisible cohérent avec
//     les autres fusions (voir doGeneratorMerge)
//   - morceau de générateur + lumière assez forte ET d'une couleur "franche"
//     (rouge/verte/bleue/BLANCHE — pas un mélange comme jaune/cyan/magenta)
//     -> nouveau générateur niveau 1 de cette couleur, toujours à
//     l'emplacement du MORCEAU (qui "devient" le générateur), quel que soit
//     le sens du glisser
//   - dépôt sur une case occupée sans fusion possible (couleurs différentes,
//     rangs différents, etc.) -> les deux cases échangent leur position
//     plutôt que de rejeter le geste (retour utilisateur: "ça permet de
//     réorganiser") — voir la fin de handleDrop()
// Le glisser-déposer est implémenté via Pointer Events (pas le drag-drop
// HTML5 natif, qui ne fonctionne pas au doigt) — un seul mécanisme gère
// souris ET tactile, cohérent avec le reste du projet, pensé mobile-first.
// Pendant un glisser, la case survolée affiche un aperçu textuel + une
// bordure verte/rouge (valide/invalide) — voir predictDrop(), qui rejoue en
// lecture seule exactement la même logique que handleDrop().
// Un tap SANS déplacement sur un générateur le sélectionne pour le bouton
// "Générer" (qui affiche aussi la répartition de chances de spawn) — un
// SECOND tap sur ce même générateur déjà sélectionné déclenche directement
// l'action, pour spammer facilement (retour utilisateur). Tout le reste
// est un vrai geste de glisser, y compris nourrir une case verrouillée
// active (plus de tap-déblocage, voir doDropOnLock).
import { hexFor } from "./game/colors.js";
// Sons: un son NEUF, court et étouffé, dédié à la génération (spammable via
// le bouton "Générer" — voir spawnFromSelected) ; les autres actions
// réutilisent des sons déjà existants du jeu principal, de façon symbolique
// (retour utilisateur: "reprendre des sons du jeu... pour rappeler le jeu
// de base") — voir game/sound.js pour le détail de chaque timbre.
import {
  playGenerate,
  playChargeFull,
  playSynapseRestore,
  playRemove,
  playTargetSuccess,
  playTargetLost,
  playChargeEmptied,
  playWin,
} from "./game/sound.js";

const SIZE = 5;
// Zone réservée à l'objectif: 2x2 en haut à gauche de la grille — ces cases
// ne sont jamais des emplacements de jeu normaux (voir isReserved()).
const OBJ_R0 = 0;
const OBJ_C0 = 0;

const DRAG_THRESHOLD = 6; // px avant qu'un pointerdown devienne un vrai glisser plutôt qu'un tap

const COLOR_CH = {
  r: { r: true, g: false, b: false },
  g: { r: false, g: true, b: false },
  b: { r: false, g: false, b: true },
  y: { r: true, g: true, b: false },
  c: { r: false, g: true, b: true },
  m: { r: true, g: false, b: true },
  w: { r: true, g: true, b: true },
};

const COLOR_NAMES = { r: "Rouge", g: "Vert", b: "Bleu", y: "Jaune", c: "Cyan", m: "Magenta", w: "Blanc" };

const MAX_LIGHT_TIER = 10;
const MIN_LIGHT_TIER_FOR_FRAGMENT = 2;
// Plafond de niveau des générateurs — mêmes bornes que les lumières (10),
// utilisé pour interpoler toutes les formules de probabilité ci-dessous.
const MAX_GEN_LEVEL = 10;

// Coût en points d'une génération — affiché sur le bouton "Générer" (retour
// utilisateur: "indiquer le prix en points"). Simple et progressif: plus le
// générateur est de haut niveau (donc plus rentable), plus il coûte cher à
// actionner.
function genCost(level) {
  return 5 * level;
}

// Récompense de la modale "regarder une pub" — retour utilisateur: "si on
// essaye de générer alors qu'on n'a plus assez de points, on ouvre une
// modale qui propose de regarder une pub... afin de regagner des points".
// Placeholder gratuit, même principe que hint-modal (voir main.js) — pas de
// vraie intégration publicitaire. Valeur choisie pour rester proportionnée
// à l'échelle des coûts (genCost va de 5 à 50 selon le niveau).
const AD_WATCH_REWARD = 200;

// Séquence scriptée d'objectifs précis (premier jet: on boucle une fois le
// dernier atteint — bac à sable de test, pas une progression finie). Chaque
// objectif liste des exigences EXACTES couleur+rang (retour utilisateur:
// "l'objectif est multiple et précis, ex: 1 blanche de niveau 3 et une
// rouge de niveau 1") — `fulfilled` est ajouté à l'instanciation
// (cloneObjective), jamais stocké ici pour que chaque cycle reparte à zéro.
// `name`: sert de badge (voir META_KEY/badges plus bas) — premier choix de
// l'utilisateur pour "faire progresser quelque chose de plus global".
const OBJECTIVE_SCRIPT = [
  { name: "Premier éclat", requirements: [{ color: "w", tier: 1, qty: 1 }] },
  { name: "Éclat affiné", requirements: [{ color: "w", tier: 2, qty: 1 }] },
  { name: "Duo naissant", requirements: [{ color: "r", tier: 1, qty: 1 }, { color: "w", tier: 1, qty: 1 }] },
  { name: "Noyau et étincelle", requirements: [{ color: "w", tier: 3, qty: 1 }, { color: "r", tier: 1, qty: 1 }] },
  { name: "Onde jumelle", requirements: [{ color: "g", tier: 2, qty: 1 }, { color: "b", tier: 2, qty: 1 }] },
  { name: "Écho doré", requirements: [{ color: "y", tier: 1, qty: 2 }] },
  { name: "Spectre complet", requirements: [{ color: "m", tier: 2, qty: 1 }, { color: "c", tier: 1, qty: 1 }] },
];

// Progression globale minimale, PERSISTÉE à part (clé dédiée, hors
// storage.js/KEYS — même raisonnement que le profil communautaire: ce n'est
// pas la vraie progression du jeu). `badges`: index dans OBJECTIVE_SCRIPT de
// chaque objectif complété au moins une fois — la séquence boucle, mais un
// badge ne se débloque qu'à la première réussite (voir doDropOnObjective).
const META_KEY = "lightup-sommation-meta";

function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      objectivesCompleted: Number(parsed?.objectivesCompleted) || 0,
      badges: Array.isArray(parsed?.badges) ? parsed.badges.filter((n) => Number.isInteger(n)) : [],
    };
  } catch {
    return { objectivesCompleted: 0, badges: [] };
  }
}

function saveMeta(meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // voir storage.js: stockage indisponible, on reste correct en mémoire
  }
}

function sameChannels(a, b) {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

function mixChannels(a, b) {
  return { r: a.r || b.r, g: a.g || b.g, b: a.b || b.b };
}

// "Franche" = rouge/verte/bleue OU blanche (les 4 couleurs de générateur
// existantes) — PAS un mélange à 2 canaux (jaune/cyan/magenta), qui n'a pas
// de générateur correspondant dans ce premier jet. Retour utilisateur: "je
// veux pouvoir créer des générateurs blancs aussi" (via un morceau, en plus
// de l'achat) — d'où l'inclusion du blanc (3 canaux) à côté des couleurs
// pures (1 canal), en excluant seulement les mélanges à 2 canaux.
function isGeneratableColor(ch) {
  const n = (ch.r ? 1 : 0) + (ch.g ? 1 : 0) + (ch.b ? 1 : 0);
  return n === 1 || n === 3;
}

function generatableLetterFor(ch) {
  if (ch.r && ch.g && ch.b) return "w";
  if (ch.r) return "r";
  if (ch.g) return "g";
  if (ch.b) return "b";
  return null;
}

function isReserved(r, c) {
  return r >= OBJ_R0 && r < OBJ_R0 + 2 && c >= OBJ_C0 && c < OBJ_C0 + 2;
}

function cloneObjective(def) {
  return { requirements: def.requirements.map((r) => ({ ...r, fulfilled: 0 })) };
}

function neuronSvg(color, size = 22) {
  const hex = hexFor(COLOR_CH[color]) || "#fbfcff";
  return `<svg class="som-gen-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${hex}" stroke-width="1.6">
    <circle cx="12" cy="12" r="4" fill="${hex}" stroke="none"/>
    <line x1="12" y1="8" x2="12" y2="2"/><line x1="12" y1="16" x2="12" y2="22"/>
    <line x1="8" y1="12" x2="2" y2="12"/><line x1="16" y1="12" x2="22" y2="12"/>
  </svg>`;
}

function fragmentSvg(size = 22) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#7b869c" stroke-width="1.6" stroke-dasharray="2 2">
    <circle cx="12" cy="12" r="4"/>
    <line x1="12" y1="8" x2="12" y2="3"/><line x1="8" y1="12" x2="3" y2="12"/>
  </svg>`;
}

function lockedCellSvg(size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#7b869c" stroke-width="1.6">
    <rect x="5" y="11" width="14" height="9" rx="2"/>
    <path d="M8 11V8a4 4 0 0 1 8 0v3"/>
  </svg>`;
}

/** Rendu "flagrant" d'une lumière — retour utilisateur: "difficile de bien
 * les comparer visuellement avec seulement le changement de taille". Un
 * cercle central + un pip satellite PAR RANG, disposés en cercle autour du
 * centre: le RANG SE COMPTE d'un coup d'œil (comme des pips de dé), plutôt
 * que de devoir comparer des tailles proches. Halo (drop-shadow) statique
 * qui grandit avec le rang en complément. */
function lightSvg(ch, tier, size = 26) {
  const hex = hexFor(ch) || "#fbfcff";
  const cx = 12;
  const cy = 12;
  const coreR = 3 + Math.min(tier, 5) * 0.5;
  const orbitR = 6.5 + Math.min(tier, MAX_LIGHT_TIER) * 0.25;
  const pipR = 1 + tier * 0.12;
  let pips = "";
  for (let i = 0; i < tier; i++) {
    const angle = (i / tier) * Math.PI * 2 - Math.PI / 2;
    const x = (cx + orbitR * Math.cos(angle)).toFixed(2);
    const y = (cy + orbitR * Math.sin(angle)).toFixed(2);
    pips += `<circle cx="${x}" cy="${y}" r="${pipR.toFixed(2)}" fill="${hex}"/>`;
  }
  const glow = (2 + tier * 1.3).toFixed(1);
  return `<svg class="som-light-svg" width="${size}" height="${size}" viewBox="0 0 24 24" style="filter:drop-shadow(0 0 ${glow}px ${hex})">
    <circle cx="${cx}" cy="${cy}" r="${coreR.toFixed(2)}" fill="${hex}"/>
    ${pips}
  </svg>`;
}

/** 10% de précision (couleur voulue) au niveau 1 -> 100% au niveau max
 * (retour utilisateur) pour un générateur COLORÉ — au-delà, il rate
 * toujours vers du blanc. */
function genAccuracy(level) {
  return 0.1 + (1 - 0.1) * ((level - 1) / (MAX_GEN_LEVEL - 1));
}

/** 2% PAR couleur (r/g/b) au niveau 1 -> 22% PAR couleur au niveau max
 * (retour utilisateur round 7: "la proba du générateur peut évoluer jusqu'à
 * 12% de chances au niveau max de générateur blanc [fragment], donc les
 * probas des 3 couleurs + blanc passent à terme à 22% chacune au niveau
 * max") pour le générateur BLANC — le blanc lui-même n'est PAS tiré
 * explicitement, il retombe en reste (voir rollGeneratorOutcome): à un
 * niveau donné, blanc = 1 - 3×each - fragmentDropChance(level). Au niveau
 * max ça vaut exactement 1 - 3×0.22 - 0.12 = 0.22 — les 4 issues "lumière"
 * ET le morceau de générateur (voir fragmentDropChance ci-dessous) forment
 * ENSEMBLE un seul tirage à 5 issues qui somme à 100% (4×22%+12%=100%). */
function whiteGenColorChance(level) {
  return 0.02 + (0.22 - 0.02) * ((level - 1) / (MAX_GEN_LEVEL - 1));
}

/** Chance de loot un morceau de générateur — retour utilisateur round 6:
 * "faible et très peu changer", explicitement REVU au round 7: "il faut
 * augmenter la proba du générateur... jusqu'à 12% de chances au niveau max
 * de générateur blanc". Même forme d'interpolation que whiteGenColorChance
 * (4% au niveau 1 -> 12% au niveau max), et fait partie du MÊME tirage
 * unifié qu'elle (voir rollGeneratorOutcome) — RÉSERVÉ au générateur blanc,
 * "uniquement le générateur blanc peut faire loot un générateur". */
function fragmentDropChance(level) {
  return 0.04 + (0.12 - 0.04) * ((level - 1) / (MAX_GEN_LEVEL - 1));
}

/** Rangs de lumière atteignables directement à la génération, selon le
 * niveau du générateur — retour utilisateur: "plus un générateur est haut
 * en niveau, plus il a de chances de générer directement des lumières de
 * niveau supérieur (jusqu'au niveau 4... au niveau du générateur maximal)".
 * Paliers doux: rang 2 dès niveau 3, rang 3 dès niveau 6, rang 4 dès niveau
 * 9 — jamais plus haut que 4 quel que soit le niveau du générateur. */
function maxSpawnTierFor(level) {
  if (level >= 9) return 4;
  if (level >= 6) return 3;
  if (level >= 3) return 2;
  return 1;
}

/** Poids de tirage par rang (index 0 -> rang 1, etc.) — le rang 1 reste
 * TOUJOURS le plus probable (retour utilisateur: "il générera toujours plus
 * de niveau 1 que de niveaux supérieurs"): sa part ne descend jamais sous
 * 70%. La part restante (jusqu'à 30% au niveau max) se répartit entre les
 * rangs supérieurs débloqués, en décroissance géométrique (rang 2 > rang 3
 * > rang 4). */
function lightTierWeights(level) {
  const maxTier = maxSpawnTierFor(level);
  const higherShare = Math.min(0.3, 0.04 * (level - 1));
  const weights = [1 - higherShare];
  if (maxTier === 1) return weights;
  const decay = [];
  for (let t = 2; t <= maxTier; t++) decay.push(Math.pow(0.4, t - 2));
  const decaySum = decay.reduce((s, w) => s + w, 0);
  for (const w of decay) weights.push((w / decaySum) * higherShare);
  return weights;
}

function rollLightTier(level) {
  const weights = lightTierWeights(level);
  const roll = Math.random();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (roll < acc) return i + 1;
  }
  return 1;
}

// Couleurs consommées pour débloquer une case verrouillée — retour
// utilisateur: "une lumière de chaque couleur" — les 4 couleurs que les
// générateurs peuvent produire directement (rouge/verte/bleue/blanche),
// pas les mélanges (jaune/cyan/magenta) qui n'ont pas de générateur propre.
const UNLOCK_COLORS = ["r", "g", "b", "w"];

/**
 * @param {{getPoints: () => number, spendPoints: (amount:number)=>boolean, addPoints:(amount:number)=>void}} pointsApi
 * Solde partagé avec le mode Infini (retour utilisateur round 7: "les points
 * dans le mode Sommation sont les mêmes que dans le mode infinity") — fourni
 * par main.js plutôt que géré localement, pour rester une seule source de
 * vérité (voir main.js: infinitePoints/spendSharedPoints/addSharedPoints).
 */
export function initSommation(pointsApi) {
  const gridEl = document.getElementById("sommation-grid");
  const pointsEl = document.getElementById("sommation-points");
  const debugPointsBtn = document.getElementById("som-debug-points");
  const progressFillEl = document.getElementById("som-badge-progress-fill");
  const progressLabelEl = document.getElementById("som-badge-progress-label");
  const spawnInfoEl = document.getElementById("som-spawn-info");
  const spawnBtn = document.getElementById("som-spawn-btn");
  // Modale "plus assez de points" — retour utilisateur: "on ouvre une
  // modale qui propose de regarder une pub... afin de regagner des points"
  // — même principe placeholder que hint-modal dans main.js.
  const adModalEl = document.getElementById("som-ad-modal");
  const adWatchBtn = document.getElementById("btn-som-ad-watch");

  // Plateau: null (vide) | {type:'gen', color, level} | {type:'light', ch,
  // tier} | {type:'frag'}. Persistant tant que l'onglet reste ouvert
  // (aucune sauvegarde disque du plateau lui-même pour ce premier jet).
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  // Générateur de départ: blanc, peut faire apparaître n'importe quelle
  // couleur mais à très faible taux au niveau 1 — voir rollGeneratorOutcome().
  // C'est aussi le SEUL moyen d'obtenir un générateur (via ses morceaux
  // lootés, voir spawnFromSelected) — retour utilisateur: "on ne doit pas
  // pouvoir acheter un générateur, ça se loot uniquement en fragment".
  board[0][2] = { type: "gen", color: "w", level: 1 };

  // Les 2 dernières lignes démarrent verrouillées — retour utilisateur:
  // "les deux dernières lignes de cases sont verrouillées et à débloquer en
  // les achetant une par une". Cases identifiées par clé "r,c" plutôt que
  // par une valeur de board[][] pour rester indépendant du contenu (une
  // case verrouillée n'a jamais de contenu tant qu'elle n'est pas ouverte).
  const lockedCells = new Set();
  // Ordre CANONIQUE de déblocage — retour utilisateur round 7: "on les
  // débloque dans l'ordre de gauche à droite, pour éviter de remplir un peu
  // les objectifs de niveau 1 un partout avant d'en remplir un entier".
  // Ligne du haut d'abord (gauche à droite), puis la ligne du bas — une
  // seule case peut être "active" (voir activeLockCoord()) à la fois.
  const LOCK_ORDER = [];
  for (let r = SIZE - 2; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      lockedCells.add(`${r},${c}`);
      LOCK_ORDER.push({ r, c });
    }
  }
  const TOTAL_LOCKED_CELLS = lockedCells.size;
  // État de remplissage de la case ACTIVE uniquement (couleur -> déjà
  // fournie) — remis à {} à chaque déblocage (voir doDropOnLock()). Contrat
  // "un item à la fois glissé dessus", comme l'objectif (retour utilisateur:
  // "on peut afficher 4 cercles réceptacles sous le cadenas... on débloque
  // dans l'ordre"), plutôt que l'ancien "tout ou rien" atomique du round 6.
  let lockFill = {};

  function isLocked(r, c) {
    return lockedCells.has(`${r},${c}`);
  }
  function unlockedSoFar() {
    return TOTAL_LOCKED_CELLS - lockedCells.size;
  }
  // Rang requis, DANS CHAQUE couleur, pour débloquer la case ACTIVE — retour
  // utilisateur: "puisque la case verrouillée a un niveau, ça veut dire
  // qu'on déduit soi-même que les objectifs correspondent à ce niveau" (le
  // rang n'est plus affiché explicitement, voir lockedCellHtml()).
  function nextUnlockTier() {
    return 1 + unlockedSoFar();
  }
  // Coordonnées de la PROCHAINE case à débloquer (gauche à droite) — ou
  // null si tout est déjà déverrouillé.
  function activeLockCoord() {
    return LOCK_ORDER[unlockedSoFar()] || null;
  }
  function activeLockKey() {
    const coord = activeLockCoord();
    return coord ? `${coord.r},${coord.c}` : null;
  }

  let selectedGen = null; // {r, c} | null — uniquement pour le bouton "Générer"
  let objectiveIndex = 0;
  let objectiveState = cloneObjective(OBJECTIVE_SCRIPT[0]);
  const meta = loadMeta();
  // Animation à jouer au PROCHAIN rendu (consommée une fois, voir render())
  // — {type:'move'|'merge', r, c} pour une case du plateau, ou
  // {type:'obj-progress'|'obj-complete'|'obj-fail'|'obj-recycle'} pour
  // l'objectif. Retour utilisateur: distinguer visuellement réussite/échec
  // en nourrissant l'objectif, fusion, et la transition de complétion.
  let pendingFx = null;

  function findEmptyCell(exclude) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (isReserved(r, c) || isLocked(r, c)) continue;
        if (exclude && exclude.r === r && exclude.c === c) continue;
        if (!board[r][c]) return { r, c };
      }
    }
    return null;
  }

  /** Nourrir la case verrouillée ACTIVE — retour utilisateur round 7: "les 4
   * couleurs sont un objectif, comme pour l'objectif à remplir du jeu...
   * on peut afficher 4 cercles réceptacles sous le cadenas". Remplace
   * l'ancien tryUnlock() (tout-ou-rien, par tap) par un glisser-déposer UN
   * ITEM À LA FOIS, comme doDropOnObjective() — seule la case ACTIVE (voir
   * activeLockKey()) accepte ces dépôts, les autres restent inertes. */
  function doDropOnLock(key, srcCoord) {
    const item = board[srcCoord.r][srcCoord.c];
    if (item.type !== "light") return { ok: false };
    const tier = nextUnlockTier();
    const letter = letterForChannels(item.ch);
    if (!UNLOCK_COLORS.includes(letter) || item.tier !== tier || lockFill[letter]) return { ok: false };
    lockFill[letter] = true;
    board[srcCoord.r][srcCoord.c] = null;
    playChargeFull();
    if (UNLOCK_COLORS.every((c) => lockFill[c])) {
      lockedCells.delete(key);
      lockFill = {};
      return { ok: true, fx: "unlocked" };
    }
    return { ok: true, fx: "lock-progress", color: letter };
  }

  // ---------- Génération à l'apparition d'une lumière ----------
  /** Tirage UNIFIÉ (retour utilisateur round 7: la proba fragment + les 4
   * probas couleur/blanc forment un seul tirage à 5 issues mutuellement
   * exclusives qui somme à 100%, voir whiteGenColorChance/
   * fragmentDropChance) pour un générateur BLANC — un SEUL Math.random(),
   * jamais deux tirages indépendants comme au round 6 (où une lumière ET un
   * morceau pouvaient tomber ensemble ; désormais c'est l'un OU l'autre).
   * Les générateurs de COULEUR n'ont pas de morceau possible (inchangé). */
  function rollGeneratorOutcome(gen) {
    if (gen.color === "w") {
      const each = whiteGenColorChance(gen.level);
      const frag = fragmentDropChance(gen.level);
      const roll = Math.random();
      if (roll < each) return { kind: "light", ch: COLOR_CH.r };
      if (roll < each * 2) return { kind: "light", ch: COLOR_CH.g };
      if (roll < each * 3) return { kind: "light", ch: COLOR_CH.b };
      if (roll < each * 3 + frag) return { kind: "fragment" };
      return { kind: "light", ch: COLOR_CH.w };
    }
    const accuracy = genAccuracy(gen.level);
    return { kind: "light", ch: Math.random() < accuracy ? COLOR_CH[gen.color] : COLOR_CH.w };
  }

  /** Camembert (conic-gradient CSS) + légende affichés sous le bouton
   * "Générer" — retour utilisateur: "un graphique fromage... et ajoute une
   * légende des probas en colonne à droite... on peut aussi savoir la
   * proba de générer un fragment de générateur, on l'appellera ??? pour
   * rester mystérieux". Mêmes proportions que rollGeneratorOutcome(). */
  function spawnRatiosChart(gen) {
    let segments;
    if (gen.color === "w") {
      const each = whiteGenColorChance(gen.level);
      const frag = fragmentDropChance(gen.level);
      segments = [
        { hex: hexFor(COLOR_CH.r) || "#7b869c", pct: each, label: "Rouge" },
        { hex: hexFor(COLOR_CH.g) || "#7b869c", pct: each, label: "Verte" },
        { hex: hexFor(COLOR_CH.b) || "#7b869c", pct: each, label: "Bleue" },
        { hex: hexFor(COLOR_CH.w) || "#fbfcff", pct: 1 - each * 3 - frag, label: "Blanche" },
        { hex: "#7b869c", pct: frag, label: "???", dashed: true },
      ];
    } else {
      const accuracy = genAccuracy(gen.level);
      segments = [
        { hex: hexFor(COLOR_CH[gen.color]) || "#7b869c", pct: accuracy, label: COLOR_NAMES[gen.color] },
        { hex: hexFor(COLOR_CH.w) || "#fbfcff", pct: 1 - accuracy, label: "Blanche" },
      ];
    }
    let acc = 0;
    const stops = segments
      .map((s) => {
        const start = (acc * 100).toFixed(2);
        acc += s.pct;
        const end = (acc * 100).toFixed(2);
        return `${s.hex} ${start}% ${end}%`;
      })
      .join(", ");
    const legend = segments
      .filter((s) => s.pct > 0.0001)
      .map(
        (s) =>
          `<div class="som-spawn-legend-row"><span class="som-spawn-legend-dot" style="${
            s.dashed ? `border:1px dashed ${s.hex};background:transparent` : `background:${s.hex}`
          }"></span><span>${s.label}</span><span class="som-spawn-legend-pct">${Math.round(s.pct * 100)}%</span></div>`,
      )
      .join("");
    return `<div class="som-spawn-row">
      <div class="som-spawn-pie" style="background: conic-gradient(${stops})"></div>
      <div class="som-spawn-legend">${legend}</div>
    </div>`;
  }

  function letterForChannels(ch) {
    for (const [letter, ref] of Object.entries(COLOR_CH)) {
      if (sameChannels(ref, ch)) return letter;
    }
    return "w";
  }

  // ---------- Actions ----------
  // Chaque fusion/combinaison renvoie { ok, resultCell?, fx? } — utilisé par
  // handleDrop() pour déclencher la bonne animation sur la bonne case
  // (voir pendingFx), sans dupliquer la logique de résolution des positions.

  /** Déclenchée par le bouton "Générer" (ou un second tap sur le générateur
   * déjà sélectionné, voir onDragEnd) — retour utilisateur: "on clique sur
   * le générateur puis sur un bouton qui génère à la première case
   * disponible". Coûte de VRAIS points, désormais le solde PARTAGÉ avec le
   * mode Infini (voir pointsApi/genCost) — retour utilisateur round 7: "les
   * points dans le mode Sommation sont les mêmes que dans le mode
   * infinity". Sans assez de points: modale "regarder une pub" plutôt qu'un
   * message (retour utilisateur), voir openAdModal(). */
  function spawnFromSelected() {
    if (!selectedGen) return;
    const gen = board[selectedGen.r]?.[selectedGen.c];
    if (!gen || gen.type !== "gen") {
      selectedGen = null;
      render();
      return;
    }
    const cost = genCost(gen.level);
    if (pointsApi.getPoints() < cost) {
      openAdModal();
      render();
      return;
    }
    const spot = findEmptyCell();
    if (!spot) return; // plateau plein — aucune case libre, geste silencieux (retour utilisateur: garder le mystère)
    pointsApi.spendPoints(cost);
    // Tirage unifié: soit une lumière (rang variable, voir
    // rollLightTier/lightTierWeights), soit — uniquement pour un générateur
    // blanc — un morceau de générateur (voir rollGeneratorOutcome), jamais
    // les deux à la fois (retour utilisateur round 7: proba fragment +
    // proba des 4 couleurs forment UN SEUL tirage à 100%).
    const outcome = rollGeneratorOutcome(gen);
    if (outcome.kind === "fragment") {
      board[spot.r][spot.c] = { type: "frag" };
    } else {
      const tier = rollLightTier(gen.level);
      board[spot.r][spot.c] = { type: "light", ch: outcome.ch, tier };
    }
    // Fx "spawn" (pop-in depuis rien) plutôt que "merge" (halo sur un
    // élément déjà là) — voir style.css: .som-fx-spawn. Son NEUF, court et
    // étouffé, car cette action est spammable (voir game/sound.js).
    pendingFx = { type: "spawn", r: spot.r, c: spot.c };
    playGenerate();
    render();
  }

  function openAdModal() {
    adModalEl?.classList.remove("hidden");
  }
  function closeAdModal() {
    adModalEl?.classList.add("hidden");
  }

  function doGeneratorMerge(aCell, bCell) {
    const a = board[aCell.r][aCell.c];
    const b = board[bCell.r][bCell.c];
    if (a.color !== b.color || a.level !== b.level || a.level >= MAX_GEN_LEVEL) {
      // Couleurs différentes, NIVEAUX différents (retour utilisateur: "il
      // faut deux générateurs niveau 2 pour avoir un niveau 3, etc.", pas
      // un 1 qui fusionne avec un 2), ou déjà au plafond: échange plutôt
      // que fusion (voir handleDrop()).
      // Pas la même couleur: pas d'échec silencieux — handleDrop() se
      // rabat sur un échange de position (voir retour utilisateur).
      return { ok: false };
    }
    const newLevel = b.level + 1;
    board[bCell.r][bCell.c] = { type: "gen", color: b.color, level: newLevel };
    board[aCell.r][aCell.c] = null;
    playSynapseRestore();
    return { ok: true, resultCell: bCell, fx: "merge" };
  }

  function doLightMerge(aCell, bCell) {
    const a = board[aCell.r][aCell.c];
    const b = board[bCell.r][bCell.c];
    if (sameChannels(a.ch, b.ch)) {
      if (a.tier !== b.tier || a.tier >= MAX_LIGHT_TIER) {
        // Rangs différents, ou déjà au maximum: échange plutôt que rejet
        // (voir handleDrop()).
        return { ok: false };
      }
      board[bCell.r][bCell.c] = { type: "light", ch: a.ch, tier: a.tier + 1 };
      board[aCell.r][aCell.c] = null;
      playSynapseRestore();
      return { ok: true, resultCell: bCell, fx: "merge" };
    }
    const mixed = mixChannels(a.ch, b.ch);
    const tier = Math.max(a.tier, b.tier);
    board[bCell.r][bCell.c] = { type: "light", ch: mixed, tier };
    board[aCell.r][aCell.c] = null;
    playSynapseRestore();
    return { ok: true, resultCell: bCell, fx: "merge" };
  }

  function doFragmentCombine(lightCell, fragCell) {
    const light = board[lightCell.r][lightCell.c];
    if (light.tier < MIN_LIGHT_TIER_FOR_FRAGMENT || !isGeneratableColor(light.ch)) {
      return { ok: false };
    }
    const color = generatableLetterFor(light.ch);
    board[fragCell.r][fragCell.c] = { type: "gen", color, level: 1 };
    board[lightCell.r][lightCell.c] = null;
    playSynapseRestore();
    return { ok: true, resultCell: fragCell, fx: "merge" };
  }

  /** Nourrir l'objectif — retour utilisateur: "l'objectif est multiple et
   * précis" (exigences exactes couleur+rang) ET "on doit pouvoir nourrir
   * l'objectif avec les générateurs mais ça ne rapporte rien du tout, ça
   * sert à libérer de l'espace si on veut". Donc: un générateur ou un
   * morceau déposé ici est TOUJOURS juste recyclé (aucun effet sur les
   * exigences) ; une lumière qui correspond à une exigence en cours la fait
   * progresser (succès), une lumière qui ne correspond à rien est recyclée
   * (échec visuel — voir fx 'obj-fail' — mais sans pénalité réelle). */
  function doDropOnObjective(coord) {
    const item = board[coord.r][coord.c];
    if (item.type !== "light") {
      board[coord.r][coord.c] = null;
      playChargeEmptied();
      return { ok: true, fx: "obj-recycle" };
    }
    const req = objectiveState.requirements.find((r) => r.fulfilled < r.qty && sameChannels(item.ch, COLOR_CH[r.color]) && item.tier === r.tier);
    board[coord.r][coord.c] = null;
    if (!req) {
      playTargetLost();
      return { ok: true, fx: "obj-fail" };
    }
    req.fulfilled += 1;
    // Index de l'orbe qui vient d'être "illuminée" dans .som-obj-orbs (voir
    // objectiveHtml()) — permet à playPendingFx() d'animer PRÉCISÉMENT ce
    // cercle plutôt que toute la case objectif (retour utilisateur: "lorsqu'un
    // sous-objectif est rempli il est illuminé... avec une animation aussi").
    const orbIndex = req.fulfilled - 1;
    const allDone = objectiveState.requirements.every((r) => r.fulfilled >= r.qty);
    if (allDone) {
      meta.objectivesCompleted += 1;
      const completedIndex = objectiveIndex;
      if (!meta.badges.includes(completedIndex)) meta.badges.push(completedIndex);
      saveMeta(meta);
      objectiveIndex = (objectiveIndex + 1) % OBJECTIVE_SCRIPT.length;
      objectiveState = cloneObjective(OBJECTIVE_SCRIPT[objectiveIndex]);
      playWin();
      return { ok: true, fx: "obj-complete" };
    }
    playTargetSuccess();
    return { ok: true, fx: "obj-progress", reqColor: req.color, reqTier: req.tier, orbIndex };
  }

  // ---------- Glisser-déposer (Pointer Events, souris + tactile) ----------

  function cellElAt(r, c) {
    return gridEl.querySelector(`.som-cell[data-r="${r}"][data-c="${c}"]`);
  }

  function findDropTargetAt(x, y) {
    const el = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
    const cellEl = el?.closest?.(".som-cell");
    if (!cellEl) return null;
    if (cellEl.dataset.objective) return { objective: true, el: cellEl };
    if (cellEl.dataset.r == null) return null;
    return { r: Number(cellEl.dataset.r), c: Number(cellEl.dataset.c), el: cellEl };
  }

  /** Lecture seule: prédit ce que ferait handleDrop() pour (src, target),
   * sans toucher au plateau — alimente l'aperçu au survol pendant un
   * glisser (retour utilisateur: "au survol, pour prévisualiser ce qui va
   * se passer"). Toute nouvelle règle de handleDrop() doit avoir son
   * miroir ici pour que l'aperçu reste fiable. */
  function predictDrop(src, target) {
    const srcCell = board[src.r]?.[src.c];
    if (!srcCell) return null;

    if (target?.objective) {
      if (srcCell.type !== "light") return { valid: true, label: "Recycler (aucun gain)" };
      const req = objectiveState.requirements.find((r) => r.fulfilled < r.qty && sameChannels(srcCell.ch, COLOR_CH[r.color]) && srcCell.tier === r.tier);
      return req ? { valid: true, label: "Nourrir l'objectif" } : { valid: false, label: "Ne correspond à rien — recyclage" };
    }
    if (!target || (target.r === src.r && target.c === src.c)) return null;
    if (isLocked(target.r, target.c)) {
      // Seule la case ACTIVE (prochaine à débloquer, gauche à droite — voir
      // activeLockKey()) accepte un dépôt, et uniquement une lumière qui
      // correspond à une couleur pas encore fournie, au rang requis.
      const key = `${target.r},${target.c}`;
      if (key !== activeLockKey() || srcCell.type !== "light") return { valid: false, label: "Case verrouillée" };
      const letter = letterForChannels(srcCell.ch);
      if (!UNLOCK_COLORS.includes(letter) || srcCell.tier !== nextUnlockTier() || lockFill[letter]) {
        return { valid: false, label: "Case verrouillée" };
      }
      return { valid: true, label: "Nourrir le verrou" };
    }

    const dst = board[target.r]?.[target.c];
    if (!dst) return { valid: true, label: "Déplacer ici" };

    // Toute combinaison qui ne fusionne pas se résout par un échange de
    // position (voir handleDrop()) — donc toujours "valid" ici, seul le
    // libellé change pour distinguer une vraie fusion d'un simple échange.
    if (srcCell.type === "gen" && dst.type === "gen") {
      if (srcCell.color !== dst.color) return { valid: true, label: "Échanger les positions" };
      if (srcCell.level !== dst.level) return { valid: true, label: "Échanger les positions" };
      if (srcCell.level >= MAX_GEN_LEVEL) return { valid: true, label: "Échanger (niveau déjà maximum)" };
      return { valid: true, label: `Fusionner → niveau ${dst.level + 1}` };
    }
    if (srcCell.type === "light" && dst.type === "light") {
      if (sameChannels(srcCell.ch, dst.ch)) {
        if (srcCell.tier !== dst.tier) return { valid: true, label: "Échanger les positions" };
        if (srcCell.tier >= MAX_LIGHT_TIER) return { valid: true, label: "Échanger (rang déjà maximum)" };
        return { valid: true, label: `Fusionner → rang ${srcCell.tier + 1}` };
      }
      const mixed = mixChannels(srcCell.ch, dst.ch);
      return { valid: true, label: `Mélanger → ${COLOR_NAMES[letterForChannels(mixed)]}` };
    }
    if ((srcCell.type === "light" && dst.type === "frag") || (srcCell.type === "frag" && dst.type === "light")) {
      const light = srcCell.type === "light" ? srcCell : dst;
      const ok = light.tier >= MIN_LIGHT_TIER_FOR_FRAGMENT && isGeneratableColor(light.ch);
      return ok ? { valid: true, label: `Créer un générateur ${COLOR_NAMES[generatableLetterFor(light.ch)]}` } : { valid: true, label: "Échanger les positions" };
    }
    return { valid: true, label: "Échanger les positions" };
  }

  function handleDrop(src, target) {
    const srcCell = board[src.r][src.c];
    if (!srcCell) return;

    if (target?.objective) {
      const outcome = doDropOnObjective(src);
      if (outcome?.fx) {
        pendingFx = { type: outcome.fx, reqColor: outcome.reqColor, reqTier: outcome.reqTier, orbIndex: outcome.orbIndex };
      }
      return;
    }
    if (!target || (target.r === src.r && target.c === src.c)) return;
    if (isLocked(target.r, target.c)) {
      // Seule la case ACTIVE accepte un dépôt (voir doDropOnLock()) — les
      // autres cases verrouillées restent inertes, geste silencieux.
      const key = `${target.r},${target.c}`;
      if (key === activeLockKey()) {
        const outcome = doDropOnLock(key, src);
        if (outcome?.ok) {
          pendingFx = outcome.fx === "unlocked" ? { type: "spawn", r: target.r, c: target.c } : { type: "lock-progress", color: outcome.color };
        }
      }
      return;
    }

    const dst = board[target.r][target.c];
    if (!dst) {
      // Case vide: on déplace librement (retour utilisateur: "on doit
      // pouvoir déplacer un générateur ou une lumière pour réorganiser").
      board[target.r][target.c] = srcCell;
      board[src.r][src.c] = null;
      if (selectedGen && selectedGen.r === src.r && selectedGen.c === src.c) {
        selectedGen = { r: target.r, c: target.c };
      }
      pendingFx = { type: "move", r: target.r, c: target.c };
      playRemove();
      return;
    }

    let outcome = { ok: false };
    if (srcCell.type === "gen" && dst.type === "gen") outcome = doGeneratorMerge(src, target);
    else if (srcCell.type === "light" && dst.type === "light") outcome = doLightMerge(src, target);
    else if (srcCell.type === "light" && dst.type === "frag") outcome = doFragmentCombine(src, target);
    else if (srcCell.type === "frag" && dst.type === "light") outcome = doFragmentCombine(target, src);

    if (outcome?.ok && outcome.resultCell) {
      pendingFx = { type: outcome.fx, r: outcome.resultCell.r, c: outcome.resultCell.c };
      return;
    }

    // Pas de fusion possible: on échange les deux cases plutôt que de
    // rejeter le geste (retour utilisateur: "ça permet de réorganiser").
    board[src.r][src.c] = dst;
    board[target.r][target.c] = srcCell;
    if (selectedGen) {
      if (selectedGen.r === src.r && selectedGen.c === src.c) selectedGen = { r: target.r, c: target.c };
      else if (selectedGen.r === target.r && selectedGen.c === target.c) selectedGen = { r: src.r, c: src.c };
    }
    pendingFx = { type: "move", r: target.r, c: target.c };
    playRemove();
  }

  let drag = null; // { r, c, pointerId, startX, startY, moved, ghostEl, previewEl, sourceEl, lastHoverEl }

  function clearHoverAndPreview() {
    if (drag?.lastHoverEl) drag.lastHoverEl.classList.remove("som-drop-hover-valid", "som-drop-hover-invalid");
    if (drag?.previewEl) drag.previewEl.remove();
    if (drag) {
      drag.lastHoverEl = null;
      drag.previewEl = null;
    }
  }

  function startDrag(e, r, c) {
    if (e.button != null && e.button !== 0) return;
    const sourceEl = cellElAt(r, c);
    if (!sourceEl) return;
    drag = { r, c, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false, ghostEl: null, previewEl: null, sourceEl, lastHoverEl: null };
    try {
      sourceEl.setPointerCapture(e.pointerId);
    } catch {
      // certains environnements (ex: jsdom) n'implémentent pas la capture — le
      // glisser reste fonctionnel via les écouteurs attachés directement à sourceEl
    }
    sourceEl.addEventListener("pointermove", onDragMove);
    sourceEl.addEventListener("pointerup", onDragEnd);
    sourceEl.addEventListener("pointercancel", onDragEnd);
  }

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      drag.moved = true;
      const rect = drag.sourceEl.getBoundingClientRect();
      const ghost = document.createElement("div");
      ghost.className = "som-cell som-drag-ghost";
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.innerHTML = drag.sourceEl.innerHTML;
      document.body.appendChild(ghost);
      drag.ghostEl = ghost;
      drag.sourceEl.classList.add("som-drag-source");
    }
    if (drag.moved && drag.ghostEl) {
      drag.ghostEl.style.left = `${e.clientX}px`;
      drag.ghostEl.style.top = `${e.clientY}px`;

      const hover = findDropTargetAt(e.clientX, e.clientY);
      if (drag.lastHoverEl && drag.lastHoverEl !== hover?.el) {
        drag.lastHoverEl.classList.remove("som-drop-hover-valid", "som-drop-hover-invalid");
        drag.lastHoverEl = null;
      }

      const isRealTarget = hover?.el && hover.el !== drag.sourceEl;
      const prediction = isRealTarget ? predictDrop({ r: drag.r, c: drag.c }, hover.objective ? { objective: true } : { r: hover.r, c: hover.c }) : null;

      if (isRealTarget) {
        hover.el.classList.add(prediction?.valid ? "som-drop-hover-valid" : "som-drop-hover-invalid");
        drag.lastHoverEl = hover.el;
      }

      if (!drag.previewEl) {
        const p = document.createElement("div");
        p.className = "som-drag-preview";
        document.body.appendChild(p);
        drag.previewEl = p;
      }
      if (prediction) {
        drag.previewEl.textContent = prediction.label;
        drag.previewEl.classList.toggle("som-drag-preview-invalid", !prediction.valid);
        drag.previewEl.style.display = "block";
      } else {
        drag.previewEl.style.display = "none";
      }
      drag.previewEl.style.left = `${e.clientX}px`;
      drag.previewEl.style.top = `${e.clientY - 30}px`;
    }
  }

  function onDragEnd(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { r, c, moved, ghostEl, sourceEl } = drag;
    sourceEl.removeEventListener("pointermove", onDragMove);
    sourceEl.removeEventListener("pointerup", onDragEnd);
    sourceEl.removeEventListener("pointercancel", onDragEnd);
    sourceEl.classList.remove("som-drag-source");
    clearHoverAndPreview();
    if (ghostEl) ghostEl.remove();

    if (!moved) {
      // Simple tap (pas de vrai glisser): un générateur pas encore
      // sélectionné se sélectionne (affiche le bouton "Générer" + son
      // coût) — un second tap sur ce MÊME générateur DÉJÀ sélectionné
      // déclenche directement l'action (retour utilisateur: "le simple fait
      // de cliquer à nouveau dessus va faire l'action, plus simple pour
      // spammer comme ça").
      const cell = board[r]?.[c];
      if (cell?.type === "gen") {
        if (selectedGen && selectedGen.r === r && selectedGen.c === c) {
          spawnFromSelected();
        } else {
          selectedGen = { r, c };
          render();
        }
      }
    } else {
      const target = findDropTargetAt(e.clientX, e.clientY);
      handleDrop({ r, c }, target);
      render();
    }
    drag = null;
  }

  // ---------- Effets visuels (voir pendingFx) ----------

  // "spawn": apparition d'un élément neuf (case vide -> occupée). "merge":
  // fusion d'éléments déjà présents. "move": déplacement/échange. Voir
  // style.css: .som-fx-spawn/.som-fx-merge/.som-fx-move.
  const CELL_FX_CLASS = { spawn: "som-fx-spawn", merge: "som-fx-merge", move: "som-fx-move" };
  const OBJ_FX_CLASS = {
    "obj-complete": "som-fx-obj-complete",
    "obj-fail": "som-fx-obj-fail",
    "obj-recycle": "som-fx-obj-recycle",
  };

  function playPendingFx() {
    if (!pendingFx) return;
    const fx = pendingFx;
    pendingFx = null;
    if (CELL_FX_CLASS[fx.type]) {
      const el = cellElAt(fx.r, fx.c);
      if (!el) return;
      const cls = CELL_FX_CLASS[fx.type];
      el.classList.add(cls);
      el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
      return;
    }
    if (fx.type === "obj-progress") {
      // Retour utilisateur: le sous-objectif rempli "s'illumine" — on anime
      // PRÉCISÉMENT le cercle concerné plutôt que toute la case objectif
      // (voir doDropOnObjective()/objectiveHtml()).
      const reqEl = gridEl.querySelector(`.som-obj-req[data-color="${fx.reqColor}"][data-tier="${fx.reqTier}"]`);
      const orbEl = reqEl?.querySelectorAll(".som-obj-orb")[fx.orbIndex];
      if (!orbEl) return;
      orbEl.classList.add("som-fx-orb-fill");
      orbEl.addEventListener("animationend", () => orbEl.classList.remove("som-fx-orb-fill"), { once: true });
      return;
    }
    if (fx.type === "lock-progress") {
      // Même principe que "obj-progress" mais pour un réceptacle de
      // déblocage (voir doDropOnLock()/lockedCellHtml()).
      const orbEl = gridEl.querySelector(`.som-lock-orb[data-color="${fx.color}"]`);
      if (!orbEl) return;
      orbEl.classList.add("som-fx-orb-fill");
      orbEl.addEventListener("animationend", () => orbEl.classList.remove("som-fx-orb-fill"), { once: true });
      return;
    }
    const cls = OBJ_FX_CLASS[fx.type];
    if (!cls) return;
    const el = gridEl.querySelector(".som-objective");
    if (!el) return;
    el.classList.add(cls);
    el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
  }

  // ---------- Rendu ----------

  function cellHtml(r, c) {
    const cell = board[r][c];
    if (!cell) return "";
    if (cell.type === "gen") {
      const badge = cell.color === "w" ? "" : `<span class="som-badge">${Math.round(genAccuracy(cell.level) * 100)}%</span>`;
      return `${neuronSvg(cell.color)}${badge}<span class="som-badge som-badge-lvl">Nv${cell.level}</span>`;
    }
    if (cell.type === "light") {
      // Design "flagrant" (retour utilisateur) — voir lightSvg(): un pip
      // radial par rang, pas seulement un changement de taille.
      return `${lightSvg(cell.ch, cell.tier)}<span class="som-badge som-badge-lvl">nv${cell.tier}</span>`;
    }
    if (cell.type === "frag") return fragmentSvg();
    return "";
  }

  /** Case verrouillée — retour utilisateur round 7: seule la case ACTIVE
   * (prochaine à débloquer, gauche à droite) affiche 4 réceptacles PETITS
   * et SANS LABEL sous le cadenas (le rang requis se déduit, plus affiché
   * — "on n'affiche pas le niveau des cases verrouillées qui ne sont pas
   * encore déverrouillables"). Les autres restent un cadenas nu. */
  function lockedCellHtml(key) {
    if (key !== activeLockKey()) return lockedCellSvg();
    let orbs = "";
    for (const color of UNLOCK_COLORS) {
      const hex = hexFor(COLOR_CH[color]) || "#fbfcff";
      const filled = !!lockFill[color];
      orbs += `<span class="som-lock-orb${filled ? " som-lock-orb-filled" : ""}" data-color="${color}" style="--som-lock-color:${hex}"></span>`;
    }
    return `<div class="som-lock-wrap">${lockedCellSvg()}<div class="som-lock-orbs">${orbs}</div></div>`;
  }

  function objectiveHtml() {
    // Retour utilisateur: "dessiner juste le cercle vide de la couleur
    // voulue et afficher le niveau voulu en dessous" — un cercle PAR unité
    // requise (qty), qui "s'illumine" (prend l'apparence d'une lumière,
    // couleur pleine + halo) une fois cette unité fournie. Voir
    // doDropOnObjective()/playPendingFx() pour l'animation d'illumination.
    const groups = objectiveState.requirements
      .map((r) => {
        const hex = hexFor(COLOR_CH[r.color]) || "#fbfcff";
        let orbs = "";
        for (let i = 0; i < r.qty; i++) {
          const filled = i < r.fulfilled;
          orbs += `<span class="som-obj-orb${filled ? " som-obj-orb-filled" : ""}" style="--som-obj-color:${hex}"></span>`;
        }
        return `<div class="som-obj-req" data-color="${r.color}" data-tier="${r.tier}">
          <div class="som-obj-orbs">${orbs}</div>
          <span class="som-obj-req-tier">nv${r.tier}</span>
        </div>`;
      })
      .join("");
    return `<div class="som-cell som-objective" data-objective="1">
      <div class="som-obj-reqs">${groups}</div>
    </div>`;
  }

  function render() {
    let html = objectiveHtml();

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (isReserved(r, c)) continue;
        const locked = isLocked(r, c);
        const isEmpty = !locked && !board[r][c];
        const isSelected = selectedGen && selectedGen.r === r && selectedGen.c === c;
        const cls = `som-cell${locked ? " som-locked" : isEmpty ? " som-empty" : ""}${isSelected ? " som-selected" : ""}`;
        html += `<div class="${cls}" data-r="${r}" data-c="${c}">${locked ? lockedCellHtml(`${r},${c}`) : cellHtml(r, c)}</div>`;
      }
    }
    gridEl.innerHTML = html;

    gridEl.querySelectorAll(".som-cell[data-r]").forEach((el) => {
      const r = Number(el.dataset.r);
      const c = Number(el.dataset.c);
      // Une case verrouillée n'est jamais une SOURCE de glisser — elle
      // reste une cible valide (voir handleDrop()/doDropOnLock()), gérée
      // uniquement via les coordonnées calculées en fin de glisser, sans
      // écouteur dédié ici (même principe que la case objectif).
      if (isLocked(r, c)) return;
      if (!board[r][c]) return; // case vide: pas de source de glisser (mais reste une cible valide)
      el.addEventListener("pointerdown", (e) => startDrag(e, r, c));
    });

    playPendingFx();

    // Retour utilisateur: "afficher le nombre de points possédés par le
    // joueur en haut" — même format que les autres totaux de points du jeu
    // (voir "N pt" pour Infini/Secrets). Solde PARTAGÉ (voir pointsApi) —
    // main.js le tient déjà à jour ailleurs (renderPointsEverywhere), ceci
    // reste une écriture de secours pour rester correct dès ce render().
    if (pointsEl) pointsEl.textContent = `${pointsApi.getPoints()} pt`;

    if (progressFillEl || progressLabelEl) {
      // Barre + texte "x/y" en haut — retour utilisateur: "on garde
      // uniquement la barre de progression en haut, avec un x/y". Reflète
      // l'exigence totale (somme fulfilled/qty) de l'objectif EN COURS: le
      // remplir déclenche toujours une récompense (badge nouveau ou déjà
      // connu) — la galerie de badges en bas est retirée (retour
      // utilisateur: "les informations sur les objectifs remplis ne
      // doivent pas être en bas, on les retire").
      let total = 0;
      let done = 0;
      objectiveState.requirements.forEach((r) => {
        total += r.qty;
        done += Math.min(r.fulfilled, r.qty);
      });
      if (progressFillEl) progressFillEl.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
      if (progressLabelEl) progressLabelEl.textContent = `${done}/${total}`;
    }

    if (selectedGen && board[selectedGen.r]?.[selectedGen.c]?.type === "gen") {
      const gen = board[selectedGen.r][selectedGen.c];
      const cost = genCost(gen.level);
      // Le bouton reste ACTIF même sans assez de points (retour
      // utilisateur: cliquer alors ouvre la modale pub — voir
      // spawnFromSelected/openAdModal), plutôt que désactivé/muet.
      spawnBtn.disabled = false;
      spawnBtn.textContent = `Générer (-${cost} points)`;
      if (spawnInfoEl) spawnInfoEl.innerHTML = spawnRatiosChart(gen);
    } else {
      selectedGen = null;
      spawnBtn.disabled = true;
      spawnBtn.textContent = "Sélectionne un générateur";
      if (spawnInfoEl) spawnInfoEl.innerHTML = "";
    }
  }

  spawnBtn.onclick = spawnFromSelected;
  if (debugPointsBtn) {
    debugPointsBtn.onclick = () => {
      pointsApi.addPoints(500);
      render();
    };
  }
  document.querySelectorAll("[data-som-ad-modal-close]").forEach((el) => (el.onclick = closeAdModal));
  if (adWatchBtn) {
    adWatchBtn.onclick = () => {
      // Gratuit pour l'instant, pas de vraie intégration publicitaire — même
      // principe placeholder que hint-modal (voir main.js).
      pointsApi.addPoints(AD_WATCH_REWARD);
      closeAdModal();
      render();
    };
  }

  return {
    onShow() {
      render();
    },
  };
}
