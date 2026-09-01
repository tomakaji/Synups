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
import { hexFor, colorFor } from "./game/colors.js";
// Bouton "Mon profil" de l'écran "terminé" (voir onShow ci-dessous, round
// 19) — réutilise loadProfile + pointsApi.buildBadgeFrame (round 22, voir
// JSDoc d'initSommation), exactement comme la bannière équivalente du menu
// titre (voir main.js: renderTitleProfileBanner), plutôt que de faire
// remonter cette logique d'affichage à main.js.
import { loadProfile } from "./game/storage.js";
import { DEFAULT_AVATAR } from "./game/community-store.js";
// Rewarded ad (round 20, migration Capacitor/AdMob) — voir game/ads.js pour
// le détail (no-op propre hors app native, ne résout QUE sur confirmation
// du SDK que la récompense a été gagnée). adWatchBtn.onclick plus bas est le
// SEUL endroit de l'app qui appelle showRewardedAd() pour l'instant (seule
// pub demandée par le retour utilisateur à ce jour).
import { showRewardedAd } from "./game/ads.js";
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
// utilisateur: "indiquer le prix en points"). Retour utilisateur round 8:
// "le coût pour utiliser un générateur sera de 1 point" — coût FIXE, quel
// que soit le niveau du générateur (l'ancien coût progressif 5×niveau est
// abandonné : au coût de 1pt, spammer un générateur haut niveau reste
// rentable, ce qui est le but recherché désormais).
function genCost() {
  return 1;
}

// Récompense de la modale "regarder une pub" — retour utilisateur: "si on
// essaye de générer alors qu'on n'a plus assez de points, on ouvre une
// modale qui propose de regarder une pub... afin de regagner des points".
// Placeholder gratuit, même principe que hint-modal (voir main.js) — pas de
// vraie intégration publicitaire. Solde partagé avec le mode Infini: cette
// valeur reste utile même après le passage au coût fixe de 1pt/génération
// (round 8) puisqu'elle peut aussi être drainée depuis Infini.
const AD_WATCH_REWARD = 200;

// ---------- Objectifs: 50 objectifs progressifs + 1 objectif final ----------
// Round 19 (retour utilisateur): "les objectifs doivent être prévus en dur,
// pas calculés. Comme ça je pourrais les modifier à la main moi-même dans le
// code" — remplace l'ancienne génération programmatique (formule + cycle de
// couleurs) par CETTE liste figée, un objectif par ligne, éditable
// directement ici. Le contenu ci-dessous est la sortie EXACTE de l'ancienne
// formule (aucun changement d'équilibrage à ce round) — seule la manière de
// l'obtenir change: littérale plutôt que recalculée à chaque chargement de
// page. `name` n'est affiché nulle part dans l'UI (l'ancien message "Nouveau
// badge débloqué : « nom »" a été retiré au round 7 avec tout texte
// explicatif), il ne sert qu'au débogage.
function req(color, tier, qty = 1) {
  return { kind: "light", color, tier, qty };
}
function genReq(color, level, qty = 1) {
  return { kind: "generator", color, level, qty };
}

// Bande 1 (1-10): une seule exigence, rang 1-3.
// Bande 2 (11-20): deux exigences, rang 2-4, qty 1-2.
// Bande 3 (21-30): deux à trois exigences, rang 3-6.
// Bande 4 (31-40): trois exigences, rang 5-8, qty 2-3.
// Bande 5 (41-50): trois à quatre exigences, rang 7-10, forte présence de blanc.
// 51e (final, "pour finir le mini-jeu"): nourrir les 4 générateurs au niveau
// maximum (10) — exigences "generator" (voir genReq), traitées à part par
// doDropOnObjective()/predictDrop().
const OBJECTIVE_SCRIPT = [
  { name: "Palier 1", requirements: [req("w", 1)] },
  { name: "Palier 2", requirements: [req("r", 1)] },
  { name: "Palier 3", requirements: [req("w", 1)] },
  { name: "Palier 4", requirements: [req("g", 1)] },
  { name: "Palier 5", requirements: [req("w", 2)] },
  { name: "Palier 6", requirements: [req("b", 2)] },
  { name: "Palier 7", requirements: [req("w", 2)] },
  { name: "Palier 8", requirements: [req("r", 2)] },
  { name: "Palier 9", requirements: [req("w", 3)] },
  { name: "Palier 10", requirements: [req("g", 3)] },
  { name: "Palier 11", requirements: [req("w", 2), req("g", 2)] },
  { name: "Palier 12", requirements: [req("b", 2), req("w", 2)] },
  { name: "Palier 13", requirements: [req("w", 2), req("w", 2)] },
  { name: "Palier 14", requirements: [req("r", 2), req("r", 2)] },
  { name: "Palier 15", requirements: [req("w", 3, 2), req("w", 3)] },
  { name: "Palier 16", requirements: [req("w", 3), req("g", 3)] },
  { name: "Palier 17", requirements: [req("r", 3), req("y", 3)] },
  { name: "Palier 18", requirements: [req("w", 3), req("w", 3)] },
  { name: "Palier 19", requirements: [req("g", 4), req("b", 4)] },
  { name: "Palier 20", requirements: [req("w", 4, 2), req("w", 4)] },
  { name: "Palier 21", requirements: [req("w", 3), req("r", 2)] },
  { name: "Palier 22", requirements: [req("b", 3), req("m", 2)] },
  { name: "Palier 23", requirements: [req("w", 3, 2), req("w", 2)] },
  { name: "Palier 24", requirements: [req("c", 4), req("g", 3), req("w", 4)] },
  { name: "Palier 25", requirements: [req("w", 4), req("w", 3)] },
  { name: "Palier 26", requirements: [req("r", 4, 2), req("w", 3)] },
  { name: "Palier 27", requirements: [req("m", 5), req("r", 4)] },
  { name: "Palier 28", requirements: [req("w", 5), req("w", 4), req("w", 5)] },
  { name: "Palier 29", requirements: [req("g", 5, 2), req("g", 4)] },
  { name: "Palier 30", requirements: [req("w", 6), req("y", 5)] },
  { name: "Palier 31", requirements: [req("w", 5, 2), req("w", 5), req("w", 3)] },
  { name: "Palier 32", requirements: [req("w", 5), req("r", 5), req("c", 3)] },
  { name: "Palier 33", requirements: [req("w", 5), req("w", 5), req("w", 3)] },
  { name: "Palier 34", requirements: [req("w", 6, 2), req("g", 6), req("r", 4, 2)] },
  { name: "Palier 35", requirements: [req("w", 6), req("w", 6), req("m", 4)] },
  { name: "Palier 36", requirements: [req("w", 6), req("b", 6), req("w", 4)] },
  { name: "Palier 37", requirements: [req("w", 7, 2), req("w", 7), req("g", 5)] },
  { name: "Palier 38", requirements: [req("w", 7), req("r", 7), req("w", 5, 2)] },
  { name: "Palier 39", requirements: [req("w", 7), req("w", 7), req("w", 5)] },
  { name: "Palier 40", requirements: [req("w", 8, 2), req("g", 8), req("r", 6)] },
  { name: "Palier 41", requirements: [req("w", 7, 2), req("w", 7), req("y", 4, 2)] },
  { name: "Palier 42", requirements: [req("w", 7, 2), req("b", 7), req("w", 4)] },
  { name: "Palier 43", requirements: [req("w", 7, 2), req("w", 7), req("b", 4, 2), req("w", 5)] },
  { name: "Palier 44", requirements: [req("w", 8, 2), req("r", 8), req("w", 5)] },
  { name: "Palier 45", requirements: [req("w", 8, 2), req("w", 8), req("c", 5, 2)] },
  { name: "Palier 46", requirements: [req("w", 8, 2), req("w", 8), req("w", 5), req("w", 6)] },
  { name: "Palier 47", requirements: [req("w", 9, 2), req("r", 9), req("r", 6, 2)] },
  { name: "Palier 48", requirements: [req("w", 9, 2), req("w", 9), req("m", 6)] },
  { name: "Palier 49", requirements: [req("w", 9, 2), req("g", 9), req("w", 6, 2), req("w", 7)] },
  { name: "Palier 50", requirements: [req("w", 10, 2), req("w", 10), req("g", 7)] },
  {
    name: "Le Sommet",
    final: true,
    requirements: [genReq("r", MAX_GEN_LEVEL, 1), genReq("g", MAX_GEN_LEVEL, 1), genReq("b", MAX_GEN_LEVEL, 1), genReq("w", MAX_GEN_LEVEL, 1)],
  },
];

// Paliers de badges — retour utilisateur round 9: "à chaque fois qu'on
// remplit les objectifs, la barre progresse un peu. Toutes les 10
// progressions on gagne une récompense... une fois la récompense obtenue on
// redémarre la barre à zéro pour la prochaine". Corrige le bug round 8: la
// barre se bloquait définitivement à "5/5" une fois les 51 objectifs
// épuisés (BADGE_THRESHOLDS/currentBadgeTierIndex plafonnaient à 5 paliers
// fixes). Désormais SANS PLAFOND: une récompense tombe tous les
// OBJECTIVES_PER_BADGE objectifs réussis, à l'infini — la séquence des 51
// objectifs (voir OBJECTIVE_SCRIPT) continue elle aussi de tourner en boucle
// (voir objectiveIndex % OBJECTIVE_SCRIPT.length ci-dessous) et alimente
// cette même progression sans distinction.
//
// Round 10 — retour utilisateur: "il faut designer les 4 badges obtenables,
// [...] progressifs et [qui] englobent le pseudo du joueur (comme une sorte
// de bannière). Et la 5eme et dernière récompense du jeu sera un thème
// PixelArt". `BADGE_DEFS` fixait à l'origine EXACTEMENT ces 4 premiers
// paliers (badgesEarned 1 à 4) — bannières de plus en plus élaborées,
// rendues avec le pseudo dans main.js (voir renderCommunityProfile).
// Round 18 (retour utilisateur): "ajoute le badge 'retro' [...] pour le
// dernier gain de remember" — un 5e badge rejoint donc la liste, au même
// palier que le déblocage du thème PixelArt (PIXELART_BADGE_TIER): les deux
// récompenses tombent maintenant exactement en même temps, ce qui rend
// BADGE_DEFS.length === PIXELART_BADGE_TIER (voir nextRewardLabel plus bas).
const OBJECTIVES_PER_BADGE = 10;
const PIXELART_BADGE_TIER = 5;
const BADGE_DEFS = [
  { name: "Étincelle" },
  { name: "Synapse" },
  { name: "Réseau" },
  { name: "Constellation" },
  { name: "Rétro" },
];

// Progression globale minimale, PERSISTÉE à part (clé dédiée, hors
// storage.js/KEYS — même raisonnement que le profil communautaire: ce n'est
// pas la vraie progression du jeu). `badgesEarned`: COMPTEUR simple (pas de
// plafond) de récompenses déjà décrochées.
const META_KEY = "lightup-sommation-meta";

function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    // Migration douce depuis l'ancien format round 8 (`badgeTiers`: liste de
    // paliers 0-4 déjà atteints, plafonnée à 5) — sa longueur devient le
    // point de départ du nouveau compteur illimité.
    const legacyBadgeCount = Array.isArray(parsed?.badgeTiers) ? parsed.badgeTiers.length : 0;
    return {
      objectivesCompleted: Number(parsed?.objectivesCompleted) || 0,
      badgesEarned: Number.isInteger(parsed?.badgesEarned) ? parsed.badgesEarned : legacyBadgeCount,
    };
  } catch {
    return { objectivesCompleted: 0, badgesEarned: 0 };
  }
}

/** Exporté pour l'écran "Mon profil" (voir main.js: renderCommunityProfile)
 * — retour utilisateur: "une fois la barre remplie, on gagne un badge sur
 * ton profil". Round 18 (retour utilisateur): "les badges c'est [...]
 * visible par les autres joueurs [...] son badge sera visible sous forme
 * d'un encadré autour de son pseudo + avatar [...] on sélectionne le badge
 * qu'on souhaite mettre" — getSommationBadges() ne fait plus QUE lister les
 * badges gagnés, l'appelant (main.js) gère en plus la sélection d'un badge
 * "actif" (stockée dans le profil, voir storage.js) qui est celui réellement
 * montré aux autres joueurs (dans les cartes communautaires, l'en-tête de
 * jeu communautaire...), jamais automatiquement le plus haut gagné. */
export function getSommationBadges() {
  const meta = loadMeta();
  return BADGE_DEFS.map((def, i) => ({ name: def.name, earned: meta.badgesEarned > i, tier: i + 1 }));
}

/** Teaser affiché au-dessus de la barre de progression — retour utilisateur
 * round 11: "il faut teaser le joueur en affichant la prochaine récompense
 * à débloquer". `badgesEarned` récompenses déjà décrochées -> la prochaine
 * est BADGE_DEFS[badgesEarned] (index 0-based) tant qu'il en reste, sinon
 * plus rien de nouveau ne sera annoncé (barre toujours active au-delà, voir
 * plus haut, mais honnête: on ne tease pas un contenu qui n'existe pas).
 *
 * Round 23 (retour utilisateur: "on n'affiche que la prévisu de la
 * récompense, on ne l'écrit pas (prévisu du badge carrée comme dans
 * 'profil')") — retourne désormais le TIER (1-based) plutôt qu'une phrase
 * toute faite: l'appelant (render() plus bas) construit la même tuile
 * carrée `.badge-teaser` que "Mon profil" (voir main.js:
 * refreshProfileBadges), le nom du badge restant lisible DANS la tuile
 * (`.badge-teaser-name`) sans phrase supplémentaire à côté. Le tout dernier
 * palier (Rétro) tombe pile au même moment que le thème PixelArt
 * (BADGE_DEFS.length === PIXELART_BADGE_TIER, voir plus haut) — signalé en
 * infobulle (title) plutôt qu'écrit, pour ne pas réintroduire de texte. */
function nextRewardTier(badgesEarned) {
  if (badgesEarned >= BADGE_DEFS.length) return null;
  return badgesEarned + 1;
}

/** 5e et dernière récompense du jeu — retour utilisateur: "la 5eme et
 * dernière récompense du jeu sera un theme PixelArt de tout le jeu + menus
 * [...] activable/desactivable dans Options et présent dès le début en
 * grisé". Contrairement aux 4 badges-bannière ci-dessus, ce palier ne
 * produit aucun badge de profil: juste un déverrouillage de réglage (voir
 * main.js: settings.pixelartEnabled, options-pixelart-row). */
export function isPixelArtUnlocked() {
  return loadMeta().badgesEarned >= PIXELART_BADGE_TIER;
}

/** Débogage: force le déverrouillage de la 5e récompense (thème PixelArt)
 * sans avoir à finir le mini-jeu Remember à chaque fois — retour
 * utilisateur round 11: "même si le bouton est verrouillé dans options,
 * j'aimerais pouvoir l'activer pour tester la feature sans avoir à finir le
 * mini jeu à chaque fois". Fait avancer le VRAI compteur badgesEarned
 * (jamais en arrière si déjà plus haut) plutôt qu'un flag de contournement
 * séparé — réutilise tel quel le chemin normal (isPixelArtUnlocked), donc
 * rien à dupliquer/désynchroniser ailleurs. Débloque en même temps les 5
 * bannières (effet de bord acceptable pour un bouton de test — voir
 * main.js: #btn-pixelart-debug-unlock, dans Options). */
export function debugUnlockPixelArt() {
  const meta = loadMeta();
  if (meta.badgesEarned < PIXELART_BADGE_TIER) {
    meta.badgesEarned = PIXELART_BADGE_TIER;
    saveMeta(meta);
  }
}

function saveMeta(meta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // voir storage.js: stockage indisponible, on reste correct en mémoire
  }
}

// ---------- Partie en cours (plateau, verrous, objectif affiché) ----------
// Retour utilisateur round 11: "L'état du jeu Remember (la progression, les
// objectifs remplis, les éléments en jeu sur la grille etc) doit toujours
// être enregistré, c'est pas un mini jeu qu'on recommence, il doit
// persister." Avant ce round, seul META_KEY (compteurs long terme:
// objectifs/badges cumulés) était sauvegardé — le plateau lui-même
// (générateurs/lumières posés), les cases encore verrouillées et
// l'objectif COURANT (avec son remplissage partiel) ne vivaient qu'en
// mémoire JS et disparaissaient au rechargement. Clé dédiée plutôt que
// fusionnée à META_KEY: state "court terme, rejouable" bien distinct de la
// progression "long terme, cumulative" — même découpage d'esprit que
// storage.js (KEYS.progress vs KEYS.points).
//
// Round 19 (retour utilisateur): revirement — "réinitialiser le profil
// joueur doit AUSSI réinitialiser le Remember + les bonus débloqués". Ce
// module reste hors storage.js/KEYS (toujours pas concerné par une éventuelle
// future réinitialisation PARTIELLE), mais expose désormais explicitement
// `resetSommationProgress()` ci-dessous, que main.js appelle en plus de
// storage.js: eraseAllProgress() au clic sur "Réinitialiser le jeu" — voir
// main.js: btn-reset-confirm.
const BOARD_KEY = "lightup-sommation-board";

/** Efface TOUTE la progression Remember (badges/objectifs cumulés + partie
 * en cours) — voir main.js: btn-reset-confirm. Ne touche jamais au profil
 * (pseudo/avatar/badge actif, voir storage.js: PROFILE_KEY) ni aux données
 * Communauté : main.js remet lui-même à part `activeBadge`/`avatar` du
 * profil à leurs valeurs par défaut (le badge/avatar sélectionnés sont un
 * "bonus débloqué" au même titre que le thème PixelArt, même si stockés
 * ailleurs), sans jamais effacer le pseudo. */
export function resetSommationProgress() {
  try {
    localStorage.removeItem(META_KEY);
    localStorage.removeItem(BOARD_KEY);
  } catch {
    // voir storage.js: stockage indisponible, sans conséquence ici
  }
}

/** Lue une seule fois à l'ouverture (voir initSommation ci-dessous) — valide
 * juste assez la forme du plateau (tableau SIZE×SIZE) pour ne jamais
 * planter le rendu si le format a changé entre deux versions; en cas de
 * doute, on retombe silencieusement sur l'état de départ historique plutôt
 * que de risquer une UI incohérente. */
function readBoardState() {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.board) || parsed.board.length !== SIZE) return null;
    if (!parsed.board.every((row) => Array.isArray(row) && row.length === SIZE)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Écrite à la fin de CHAQUE render() (voir plus bas) — render() est déjà le
 * point de passage unique après toute mutation du plateau (drag, fusion,
 * génération, déblocage, objectif nourri...), donc un seul point d'écriture
 * suffit à tout capturer sans avoir à instrumenter chaque handler. */
function writeBoardState(state) {
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(state));
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

function channelCount(ch) {
  return (ch.r ? 1 : 0) + (ch.g ? 1 : 0) + (ch.b ? 1 : 0);
}

/** Une couleur "pure" (1 seul canal: rouge/verte/bleue) — retour utilisateur
 * round 8: seul un mélange entre deux couleurs PURES différentes reste
 * autorisé. Le blanc (3 canaux) et les couleurs déjà mélangées (2 canaux:
 * jaune/cyan/magenta) sont exclus du mélange (voir doLightMerge/
 * predictDrop): "la fusion entre du blanc et une couleur doit être
 * impossible" et "la fusion entre une couleur fusionnée et une autre doit
 * être impossible, ça retourne sur du blanc, c'est inutile ou frustrant". */
function isPureColor(ch) {
  return channelCount(ch) === 1;
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

/** `atMax`: retour utilisateur round 8 — "lorsqu'on atteint le niveau max
 * d'un générateur, il faut trouver quelque chose de similaire [à l'orbite
 * indéfinie des lumières] (son + animation)". Anneau pointillé supplémentaire
 * autour du neurone, qui tourne indéfiniment en CSS tant que le générateur
 * reste au niveau max (voir style.css: .som-gen-halo/som-orbit-spin) — même
 * langage visuel "orbite" que lightSvg() ci-dessous, adapté au neurone. */
function neuronSvg(color, size = 22, atMax = false) {
  const hex = hexFor(COLOR_CH[color]) || "#fbfcff";
  const halo = atMax ? `<circle class="som-gen-halo" cx="12" cy="12" r="9.5" stroke="${hex}" stroke-dasharray="2.5 3.5"/>` : "";
  return `<svg class="som-gen-svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${hex}" stroke-width="1.6">
    <circle cx="12" cy="12" r="4" fill="${hex}" stroke="none"/>
    <line x1="12" y1="8" x2="12" y2="2"/><line x1="12" y1="16" x2="12" y2="22"/>
    <line x1="8" y1="12" x2="2" y2="12"/><line x1="16" y1="12" x2="22" y2="12"/>
    ${halo}
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
  // Retour utilisateur round 8: "lorsqu'on atteint le niveau maximum d'une
  // lumière... les petites boules tournent autour de la lumière indéfiniment"
  // — les pips au rang MAX sont regroupés dans un <g> dédié pour pouvoir
  // tourner en bloc autour du centre en CSS (voir style.css:
  // .som-light-svg-max .som-light-pips / som-orbit-spin), sans affecter le
  // halo statique (filter) posé sur le <svg> racine.
  const atMax = tier >= MAX_LIGHT_TIER;
  const pipsBlock = atMax ? `<g class="som-light-pips">${pips}</g>` : pips;
  return `<svg class="som-light-svg${atMax ? " som-light-svg-max" : ""}" width="${size}" height="${size}" viewBox="0 0 24 24" style="filter:drop-shadow(0 0 ${glow}px ${hex})">
    <circle cx="${cx}" cy="${cy}" r="${coreR.toFixed(2)}" fill="${hex}"/>
    ${pipsBlock}
  </svg>`;
}

/** 10% de précision (couleur voulue) au niveau 1 -> 100% au niveau max
 * (retour utilisateur) pour un générateur COLORÉ — au-delà, il rate
 * toujours vers du blanc. */
function genAccuracy(level) {
  return 0.1 + (1 - 0.1) * ((level - 1) / (MAX_GEN_LEVEL - 1));
}

/** 2% PAR couleur (r/g/b), FIXE quel que soit le niveau — retour utilisateur
 * round 8: "le générateur blanc finalement progresse sur sa distribution
 * SANS augmenter les probabilités de sortir des couleurs" (revient sur le
 * round 7, où ces probas montaient jusqu'à 22%). Le blanc lui-même n'est
 * PAS tiré explicitement, il retombe en reste (voir rollGeneratorOutcome):
 * blanc = 1 - 3×each - fragmentDropChance(level). Comme fragmentDropChance
 * grandit avec le niveau alors que ce taux-ci reste fixe, seul le morceau
 * de générateur devient plus probable en montant de niveau — le blanc
 * absorbe la différence (voir fragmentDropChance ci-dessous). */
function whiteGenColorChance() {
  return 0.02;
}

/** Chance de loot un morceau de générateur — SEULE proba qui progresse avec
 * le niveau du générateur blanc désormais (retour utilisateur round 8:
 * "morceau à 20% [au niveau max], et blanc pour le reste une fois les
 * probas couleurs soustraites" — révisé round 9: "finalement... on va
 * monter jusqu'à 30% de proba... plutôt que 20%"). 4% au niveau 1 -> 30% au
 * niveau max, RÉSERVÉ au générateur blanc — "uniquement le générateur blanc
 * peut faire loot un générateur" (voir rollGeneratorOutcome pour le tirage
 * unifié). */
function fragmentDropChance(level) {
  return 0.04 + (0.3 - 0.04) * ((level - 1) / (MAX_GEN_LEVEL - 1));
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
 * `pointsApi.goToProfile` (round 19): callback fourni par main.js pour
 * naviguer vers "Mon profil" depuis l'écran "terminé" — même pattern
 * d'injection que getPoints/spendPoints/addPoints, pour ne jamais faire
 * dépendre ce module du routeur de main.js directement.
 * `pointsApi.onBadgeEarned` (round 22, retour utilisateur: "il faudra freeze
 * le jeu lors du déblocage d'un objet cosmétique [...] pareillement pour les
 * badges"): callback `(tier, name) => void` appelé juste après qu'un nouveau
 * badge soit décroché (voir doDropOnObjective ci-dessous) — main.js s'en sert
 * pour déclencher la modale de révélation, ce module ne sait rien de cette
 * modale (même pattern d'injection que goToProfile).
 */
export function initSommation(pointsApi) {
  const gridEl = document.getElementById("sommation-grid");
  const pointsEl = document.getElementById("sommation-points");
  const debugPointsBtn = document.getElementById("som-debug-points");
  const progressFillEl = document.getElementById("som-badge-progress-fill");
  const progressLabelEl = document.getElementById("som-badge-progress-label");
  const nextRewardTeaserEl = document.getElementById("som-next-reward-teaser");
  const spawnInfoEl = document.getElementById("som-spawn-info");
  const spawnBtn = document.getElementById("som-spawn-btn");
  // Modale "plus assez de points" — retour utilisateur: "on ouvre une
  // modale qui propose de regarder une pub... afin de regagner des points".
  // Round 20: branchée sur une vraie rewarded ad (voir game/ads.js) au lieu
  // du placeholder gratuit d'origine — voir adWatchBtn.onclick plus bas.
  const adModalEl = document.getElementById("som-ad-modal");
  const adWatchBtn = document.getElementById("btn-som-ad-watch");
  const adStatusEl = document.getElementById("som-ad-status");
  // Modale de confirmation "recycler ce générateur" — retour utilisateur
  // round 9: "si on met un générateur dans l'objectif pour le recycler,
  // j'aimerais que tu préviennes avec une modale de confirmation... pour
  // éviter la frustration d'un faux mouvement" — voir onDragEnd() plus bas.
  const recycleModalEl = document.getElementById("som-recycle-confirm-modal");
  const recycleConfirmBtn = document.getElementById("btn-som-recycle-confirm");
  // État "terminé" (round 12, devenu l'écran normal round 18) — voir
  // onShow() plus bas et index.html: #som-done-state. Depuis round 18, le
  // menu titre ouvre TOUJOURS Remember (voir main.js: enterRememberDirect),
  // donc c'est bien ICI, une fois PixelArt débloqué, que ce filet devient
  // l'écran effectivement affiché — un état non-interactif ("bravo, plus
  // rien à voir ici") plutôt que le plateau normal.
  const doneStateEl = document.getElementById("som-done-state");
  const progressWrapEl = document.querySelector(".som-progress-wrap");
  const boardWrapEl = document.querySelector(".som-board-wrap");
  const actionsEl = document.querySelector(".som-actions");
  // Lien "Mon profil" de l'écran "terminé" (round 19, retour utilisateur) —
  // voir onShow() plus bas pour le remplissage avatar/pseudo.
  const doneProfileLinkEl = document.getElementById("som-done-profile-link");
  const doneProfileIdentityEl = document.getElementById("som-done-profile-identity");
  if (doneProfileLinkEl) doneProfileLinkEl.onclick = () => pointsApi.goToProfile?.();

  // Partie en cours: restaurée depuis le disque si une sauvegarde valide
  // existe (voir BOARD_KEY/readBoardState plus haut) — retour utilisateur:
  // "c'est pas un mini jeu qu'on recommence, il doit persister". Sinon
  // (première visite, ou sauvegarde invalide) on repart de l'état de départ
  // historique ci-dessous, comme avant ce round.
  const savedBoard = readBoardState();

  // Plateau: null (vide) | {type:'gen', color, level} | {type:'light', ch,
  // tier} | {type:'frag'}.
  const board = savedBoard?.board ?? Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  if (!savedBoard) {
    // Générateur de départ: blanc, peut faire apparaître n'importe quelle
    // couleur mais à très faible taux au niveau 1 — voir rollGeneratorOutcome().
    // C'est aussi le SEUL moyen d'obtenir un générateur (via ses morceaux
    // lootés, voir spawnFromSelected) — retour utilisateur: "on ne doit pas
    // pouvoir acheter un générateur, ça se loot uniquement en fragment".
    board[0][2] = { type: "gen", color: "w", level: 1 };
  }

  // Ordre CANONIQUE de déblocage des 2 dernières lignes — retour
  // utilisateur round 7: "on les débloque dans l'ordre de gauche à droite,
  // pour éviter de remplir un peu les objectifs de niveau 1 un partout
  // avant d'en remplir un entier". Ligne du haut d'abord (gauche à droite),
  // puis la ligne du bas — une seule case peut être "active" (voir
  // activeLockCoord()) à la fois. TOUJOURS recalculé (indépendant de la
  // sauvegarde): seul l'ENSEMBLE des cases encore verrouillées ci-dessous
  // varie d'une partie à l'autre, pas l'ordre lui-même.
  const LOCK_ORDER = [];
  for (let r = SIZE - 2; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) LOCK_ORDER.push({ r, c });
  }
  const TOTAL_LOCKED_CELLS = LOCK_ORDER.length;

  // Les 2 dernières lignes démarrent verrouillées — retour utilisateur:
  // "les deux dernières lignes de cases sont verrouillées et à débloquer en
  // les achetant une par une". Cases identifiées par clé "r,c" plutôt que
  // par une valeur de board[][] pour rester indépendant du contenu (une
  // case verrouillée n'a jamais de contenu tant qu'elle n'est pas ouverte).
  const lockedCells = new Set(savedBoard?.lockedCells ?? LOCK_ORDER.map(({ r, c }) => `${r},${c}`));
  // État de remplissage de la case ACTIVE uniquement (couleur -> déjà
  // fournie) — remis à {} à chaque déblocage (voir doDropOnLock()). Contrat
  // "un item à la fois glissé dessus", comme l'objectif (retour utilisateur:
  // "on peut afficher 4 cercles réceptacles sous le cadenas... on débloque
  // dans l'ordre"), plutôt que l'ancien "tout ou rien" atomique du round 6.
  let lockFill = savedBoard?.lockFill ?? {};

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

  let selectedGen = savedBoard?.selectedGen ?? null; // {r, c} | null — uniquement pour le bouton "Générer"
  // render() revalide de toute façon que selectedGen pointe encore vers un
  // générateur (voir plus bas: "if (selectedGen && board[...]?.type ===
  // 'gen')") — pas besoin de validation supplémentaire ici, un board restauré
  // incohérent s'auto-corrige au premier rendu.
  let objectiveIndex = Number.isInteger(savedBoard?.objectiveIndex)
    ? ((savedBoard.objectiveIndex % OBJECTIVE_SCRIPT.length) + OBJECTIVE_SCRIPT.length) % OBJECTIVE_SCRIPT.length
    : 0;
  // L'objectif sauvegardé n'est repris que s'il a la même forme que le
  // script actuel (même nombre d'exigences) — protège contre une sauvegarde
  // devenue incompatible après une future mise à jour d'OBJECTIVE_SCRIPT:
  // on préfère repartir d'un objectif propre (fulfilled=0) plutôt que
  // risquer un rendu désynchronisé.
  const freshObjective = cloneObjective(OBJECTIVE_SCRIPT[objectiveIndex]);
  let objectiveState =
    savedBoard?.objectiveState?.requirements?.length === freshObjective.requirements.length
      ? savedBoard.objectiveState
      : freshObjective;
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
      const each = whiteGenColorChance();
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
      const each = whiteGenColorChance();
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

  function setAdStatus(text, isError) {
    if (!adStatusEl) return;
    adStatusEl.textContent = text ?? "";
    adStatusEl.classList.toggle("hidden", !text);
    adStatusEl.classList.toggle("som-ad-status--error", !!isError);
  }

  function openAdModal() {
    // Repart toujours propre (bouton actif, pas de message résiduel d'une
    // tentative précédente) — voir adWatchBtn.onclick pour l'état "en cours".
    setAdStatus(null);
    if (adWatchBtn) {
      adWatchBtn.disabled = false;
      adWatchBtn.textContent = "Regarder la pub (+200)";
    }
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
    // Retour utilisateur round 8: "lorsqu'on atteint le niveau max d'un
    // générateur, il faut trouver quelque chose de similaire (son +
    // animation)" — même son que pour une lumière au rang max (voir
    // doLightMerge), l'animation indéfinie est gérée en CSS via la classe
    // posée par cellHtml()/neuronSvg() (voir style.css: .som-gen-halo).
    if (newLevel >= MAX_GEN_LEVEL) playChargeFull();
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
      // Retour utilisateur round 8: "lorsqu'on atteint le niveau maximum
      // d'une lumière, on déclenche un son approprié" — réutilise
      // playChargeFull (déjà le son "quelque chose vient de se remplir/
      // compléter" ailleurs dans Sommation), même principe de réemploi
      // symbolique que le reste des sons de ce fichier.
      if (a.tier + 1 >= MAX_LIGHT_TIER) playChargeFull();
      return { ok: true, resultCell: bCell, fx: "merge" };
    }
    // Mélange: retour utilisateur round 8 — SEULES deux couleurs PURES
    // différentes peuvent se mélanger. Le blanc ("la fusion entre du blanc
    // et une couleur doit être impossible") et les couleurs déjà mélangées
    // ("la fusion entre une couleur fusionnée et une autre... ça retourne
    // sur du blanc, inutile ou frustrant") sont désormais rejetées — voir
    // isPureColor(). Échange plutôt que rejet, comme les autres cas.
    if (!isPureColor(a.ch) || !isPureColor(b.ch)) {
      return { ok: false };
    }
    const mixed = mixChannels(a.ch, b.ch);
    // Retour utilisateur round 8: la lumière fusionnée prend le rang le
    // PLUS BAS des deux (pas le plus haut) — nerf du mélange, qui servait
    // auparavant à "gratter" un rang élevé en sacrifiant une lumière faible.
    const tier = Math.min(a.tier, b.tier);
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

  /** Une exigence "light" (les 50 objectifs normaux) ou "generator" (le 51e,
   * objectif final — voir buildObjectiveScript/genReq) satisfaite par cet
   * item du plateau. */
  function matchesRequirement(item, r) {
    if (r.fulfilled >= r.qty) return false;
    if (r.kind === "generator") return item.type === "gen" && item.color === r.color && item.level >= r.level;
    return item.type === "light" && sameChannels(item.ch, COLOR_CH[r.color]) && item.tier === r.tier;
  }

  /** Nourrir l'objectif — retour utilisateur: "l'objectif est multiple et
   * précis" (exigences exactes couleur+rang) ET "on doit pouvoir nourrir
   * l'objectif avec les générateurs mais ça ne rapporte rien du tout, ça
   * sert à libérer de l'espace si on veut" — SAUF sur l'objectif FINAL, où
   * un générateur au niveau max EST justement ce qui est demandé (voir
   * matchesRequirement). Une lumière qui ne correspond à rien, ou un
   * générateur/morceau hors du cas final, est recyclé (échec visuel — voir
   * fx 'obj-fail'/'obj-recycle' — mais sans pénalité réelle). */
  function doDropOnObjective(coord) {
    const item = board[coord.r][coord.c];
    const req = objectiveState.requirements.find((r) => matchesRequirement(item, r));
    board[coord.r][coord.c] = null;
    if (!req) {
      if (item.type !== "light") {
        playChargeEmptied();
        return { ok: true, fx: "obj-recycle" };
      }
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
      // Retour utilisateur round 8: la barre du haut ne suit plus l'objectif
      // COURANT mais une progression SUPÉRIEURE — révisé round 9: cette
      // progression ne doit JAMAIS se bloquer, elle avance à chaque objectif
      // et redémarre à zéro après chaque récompense, à l'infini (voir
      // OBJECTIVES_PER_BADGE ci-dessus).
      if (meta.objectivesCompleted % OBJECTIVES_PER_BADGE === 0) {
        meta.badgesEarned += 1;
        // Round 22: notifie main.js pour la modale de révélation "cosmétique
        // débloqué" — voir pointsApi.onBadgeEarned dans le JSDoc d'initSommation
        // ci-dessus. `meta.badgesEarned` (pas `objectivesCompleted`) est le
        // tier 1-based, cohérent avec getSommationBadges()/BADGE_DEFS.
        pointsApi.onBadgeEarned?.(meta.badgesEarned, BADGE_DEFS[meta.badgesEarned - 1]?.name);
      }
      saveMeta(meta);
      objectiveIndex = (objectiveIndex + 1) % OBJECTIVE_SCRIPT.length;
      objectiveState = cloneObjective(OBJECTIVE_SCRIPT[objectiveIndex]);
      playWin();
      return { ok: true, fx: "obj-complete" };
    }
    playTargetSuccess();
    return { ok: true, fx: "obj-progress", reqColor: req.color, reqKind: req.kind, reqTier: req.tier, orbIndex };
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
      // Générateur/morceau: recyclage par défaut — SAUF sur l'objectif
      // final, où un générateur au niveau max EST l'exigence (voir
      // matchesRequirement/genReq).
      if (srcCell.type !== "light") {
        const genReqMatch = srcCell.type === "gen" && objectiveState.requirements.find((r) => matchesRequirement(srcCell, r));
        return genReqMatch ? { valid: true, label: "Nourrir l'objectif" } : { valid: true, label: "Recycler (aucun gain)" };
      }
      const req = objectiveState.requirements.find((r) => matchesRequirement(srcCell, r));
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
      // Mélange réservé à deux couleurs PURES différentes (voir
      // doLightMerge/isPureColor) — blanc ou couleur déjà mélangée: échange.
      if (!isPureColor(srcCell.ch) || !isPureColor(dst.ch)) return { valid: true, label: "Échanger les positions" };
      const mixed = mixChannels(srcCell.ch, dst.ch);
      const mixTier = Math.min(srcCell.tier, dst.tier);
      return { valid: true, label: `Mélanger → ${COLOR_NAMES[letterForChannels(mixed)]} (rang ${mixTier})` };
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
        pendingFx = { type: outcome.fx, reqColor: outcome.reqColor, reqKind: outcome.reqKind, reqTier: outcome.reqTier, orbIndex: outcome.orbIndex };
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
  // Glisser en attente de confirmation (voir onDragEnd()/recycleModalEl) —
  // { src: {r,c}, target } le temps que le joueur confirme ou annule le
  // recyclage d'un générateur déposé sur l'objectif.
  let pendingRecycleDrop = null;

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
      const srcCell = board[r]?.[c];
      // Retour utilisateur round 9: "si on met un générateur dans l'objectif
      // pour le recycler, préviens avec une modale de confirmation... pour
      // éviter la frustration d'un faux mouvement" — SEUL un générateur qui
      // ne correspond à AUCUNE exigence (donc perdu pour de bon, voir
      // matchesRequirement/predictDrop) déclenche la confirmation ; un
      // générateur qui nourrit l'objectif final, ou une lumière/un morceau
      // recyclé, restent immédiats (geste peu coûteux ou volontaire).
      const wouldRecycleGenerator =
        target?.objective &&
        srcCell?.type === "gen" &&
        !objectiveState.requirements.some((req) => matchesRequirement(srcCell, req));
      if (wouldRecycleGenerator) {
        pendingRecycleDrop = { src: { r, c }, target };
        recycleModalEl?.classList.remove("hidden");
      } else {
        handleDrop({ r, c }, target);
        render();
      }
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
      const reqSelector =
        fx.reqKind === "generator"
          ? `.som-obj-req[data-color="${fx.reqColor}"][data-kind="generator"]`
          : `.som-obj-req[data-color="${fx.reqColor}"][data-tier="${fx.reqTier}"]`;
      const reqEl = gridEl.querySelector(reqSelector);
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

  // Retour utilisateur round 8: "plutôt qu'écrire nv10, on écrit nvMax.
  // D'ailleurs plutôt que Nv, on préfère choisir l'anglais par défaut, donc
  // lvl" — un seul point de vérité pour ce libellé, réutilisé pour les
  // générateurs ET les lumières (mêmes bornes de "max" différentes: voir
  // appels ci-dessous).
  function lvlLabel(n, max) {
    return n >= max ? "lvlMax" : `lvl${n}`;
  }

  function cellHtml(r, c) {
    const cell = board[r][c];
    if (!cell) return "";
    if (cell.type === "gen") {
      const atMax = cell.level >= MAX_GEN_LEVEL;
      const badge = cell.color === "w" ? "" : `<span class="som-badge">${Math.round(genAccuracy(cell.level) * 100)}%</span>`;
      return `${neuronSvg(cell.color, 22, atMax)}${badge}<span class="som-badge som-badge-lvl">${lvlLabel(cell.level, MAX_GEN_LEVEL)}</span>`;
    }
    if (cell.type === "light") {
      // Design "flagrant" (retour utilisateur) — voir lightSvg(): un pip
      // radial par rang, pas seulement un changement de taille.
      return `${lightSvg(cell.ch, cell.tier)}<span class="som-badge som-badge-lvl">${lvlLabel(cell.tier, MAX_LIGHT_TIER)}</span>`;
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
    // L'objectif FINAL (kind "generator", voir buildObjectiveScript) affiche
    // à la place un petit neurone par exigence, qui s'illumine pareil.
    const groups = objectiveState.requirements
      .map((r) => {
        const hex = hexFor(COLOR_CH[r.color]) || "#fbfcff";
        if (r.kind === "generator") {
          const filled = r.fulfilled >= r.qty;
          return `<div class="som-obj-req" data-color="${r.color}" data-kind="generator">
            <div class="som-obj-orbs">
              <span class="som-obj-orb som-obj-orb-gen${filled ? " som-obj-orb-filled" : ""}" style="--som-obj-color:${hex}">${neuronSvg(r.color, 13)}</span>
            </div>
            <span class="som-obj-req-tier">lvlMax</span>
          </div>`;
        }
        let orbs = "";
        for (let i = 0; i < r.qty; i++) {
          const filled = i < r.fulfilled;
          orbs += `<span class="som-obj-orb${filled ? " som-obj-orb-filled" : ""}" style="--som-obj-color:${hex}"></span>`;
        }
        return `<div class="som-obj-req" data-color="${r.color}" data-tier="${r.tier}">
          <div class="som-obj-orbs">${orbs}</div>
          <span class="som-obj-req-tier">${lvlLabel(r.tier, MAX_LIGHT_TIER)}</span>
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
        const cell = board[r][c];
        const isEmpty = !locked && !cell;
        const isSelected = selectedGen && selectedGen.r === r && selectedGen.c === c;
        // Retour utilisateur round 8: "je préfère le fond teinté sur les
        // lumières" — distingue une case lumière d'une case générateur SANS
        // toucher aux illustrations, via un très léger fond teinté dans la
        // couleur de la lumière (voir style.css: .som-light-cell, placé
        // AVANT les règles d'état comme .som-drop-hover-valid/.som-fx-move
        // pour que ces dernières restent visibles par-dessus pendant un
        // survol/une animation de glisser).
        const isLightCell = !locked && cell?.type === "light";
        const tintStyle = isLightCell ? ` style="--som-light-tint:${colorFor(cell.ch, 0.12)}"` : "";
        const cls = `som-cell${locked ? " som-locked" : isEmpty ? " som-empty" : ""}${isSelected ? " som-selected" : ""}${isLightCell ? " som-light-cell" : ""}`;
        html += `<div class="${cls}" data-r="${r}" data-c="${c}"${tintStyle}>${locked ? lockedCellHtml(`${r},${c}`) : cellHtml(r, c)}</div>`;
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
    // (voir "N pt" pour Infini/Remember). Solde PARTAGÉ (voir pointsApi) —
    // main.js le tient déjà à jour ailleurs (renderPointsEverywhere), ceci
    // reste une écriture de secours pour rester correct dès ce render().
    if (pointsEl) pointsEl.textContent = `${pointsApi.getPoints()} pt`;

    if (progressFillEl || progressLabelEl) {
      // Barre + texte "x/y" en haut — retour utilisateur round 8: "la barre
      // de progression en haut ne doit pas représenter la progression de
      // l'objectif courant, mais une progression supérieure qui avance à
      // chaque fois qu'on remplit les objectifs" — révisé round 9: cette
      // progression ne doit JAMAIS se bloquer (bug: elle restait figée à
      // "5/5" après le 51e objectif). Modulo simple, SANS PLAFOND: avance à
      // chaque objectif, redémarre à zéro juste après chaque récompense
      // (voir OBJECTIVES_PER_BADGE/doDropOnObjective).
      const done = meta.objectivesCompleted % OBJECTIVES_PER_BADGE;
      const total = OBJECTIVES_PER_BADGE;
      if (progressFillEl) progressFillEl.style.width = `${Math.round((done / total) * 100)}%`;
      if (progressLabelEl) progressLabelEl.textContent = `${done}/${total}`;
    }

    if (nextRewardTeaserEl) {
      const tier = nextRewardTier(meta.badgesEarned);
      nextRewardTeaserEl.innerHTML = "";
      nextRewardTeaserEl.classList.toggle("hidden", !tier);
      if (tier) {
        // Même tuile carrée que "Mon profil" (voir main.js:
        // refreshProfileBadges) — un badge PAS ENCORE décroché, donc jamais
        // cliquable (div, pas button) ni marqué "earned": la déco/le nom
        // restent visibles (c'est le TEASER), seul le style "locked"
        // (grisé) est volontairement omis pour ne pas dévaloriser l'aperçu.
        const def = BADGE_DEFS[tier - 1];
        const tile = document.createElement("div");
        tile.className = `badge-teaser badge-teaser--tier-${tier} earned`;
        tile.title = tier === PIXELART_BADGE_TIER ? `${def.name} (et le thème PixelArt)` : def.name;
        const deco = document.createElement("span");
        deco.className = "badge-teaser-deco";
        deco.setAttribute("aria-hidden", "true");
        tile.appendChild(deco);
        const nameEl = document.createElement("span");
        nameEl.className = "badge-teaser-name";
        nameEl.textContent = def.name;
        tile.appendChild(nameEl);
        nextRewardTeaserEl.appendChild(tile);
      }
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

    // Sauvegarde disque — voir writeBoardState/BOARD_KEY plus haut. render()
    // est déjà le point de passage unique après CHAQUE mutation du plateau,
    // donc un seul appel ici suffit à capturer tout changement (drag, fusion,
    // génération, déblocage, objectif nourri, recyclage...) sans avoir à
    // instrumenter chaque handler individuellement. `selectedGen` est repris
    // APRÈS le bloc ci-dessus pour persister sa valeur déjà auto-corrigée
    // (remise à null si elle ne pointait plus vers un générateur valide).
    writeBoardState({ board, lockedCells: Array.from(lockedCells), lockFill, objectiveIndex, objectiveState, selectedGen });
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
    // Round 20 (migration Capacitor/AdMob): remplace l'ancien placeholder
    // gratuit — voir game/ads.js: showRewardedAd() ne résout `earned: true`
    // QUE sur confirmation du SDK, jamais de façon optimiste. Les points ne
    // sont donc crédités QUE dans ce cas précis, jamais avant ni en cas
    // d'échec/fermeture anticipée de la pub.
    adWatchBtn.onclick = async () => {
      adWatchBtn.disabled = true;
      adWatchBtn.textContent = "Chargement…";
      setAdStatus(null);
      const { earned, reason } = await showRewardedAd();
      if (earned) {
        pointsApi.addPoints(AD_WATCH_REWARD);
        closeAdModal();
        render();
        return;
      }
      adWatchBtn.disabled = false;
      adWatchBtn.textContent = "Regarder la pub (+200)";
      setAdStatus(
        reason === "unavailable"
          ? "Pas de pub disponible pour l'instant — réessaie dans un instant."
          : "Pub fermée avant la fin — aucun point crédité.",
        true
      );
    };
  }

  function closeRecycleModal() {
    recycleModalEl?.classList.add("hidden");
    // Annuler: on ferme simplement — le plateau n'a jamais été touché (voir
    // onDragEnd), le générateur reste où il était, aucun render() requis.
    pendingRecycleDrop = null;
  }
  document.querySelectorAll("[data-som-recycle-modal-close]").forEach((el) => (el.onclick = closeRecycleModal));
  if (recycleConfirmBtn) {
    recycleConfirmBtn.onclick = () => {
      if (pendingRecycleDrop) {
        handleDrop(pendingRecycleDrop.src, pendingRecycleDrop.target);
      }
      pendingRecycleDrop = null;
      recycleModalEl?.classList.add("hidden");
      render();
    };
  }

  return {
    onShow() {
      // Voir déclaration de doneStateEl plus haut: si PixelArt est
      // débloqué, Remember est terminé — on affiche un état figé au lieu du
      // plateau (jamais de render(), donc jamais de spawn/fusion/objectif
      // traité pour cette visite).
      const done = isPixelArtUnlocked();
      doneStateEl?.classList.toggle("hidden", !done);
      progressWrapEl?.classList.toggle("hidden", done);
      boardWrapEl?.classList.toggle("hidden", done);
      spawnInfoEl?.classList.toggle("hidden", done);
      actionsEl?.classList.toggle("hidden", done);
      if (done) {
        const profile = loadProfile();
        // Round 22 (retour utilisateur): "l'avatar+pseudo dans le menu (en
        // haut) doit être aussi affiché avec le badge" — même bannière que
        // le titre (voir main.js: renderTitleProfileBanner), donc même
        // composant buildBadgeFrame plutôt qu'un avatar+texte bruts. Fourni
        // via pointsApi (comme goToProfile/onBadgeEarned ci-dessus) pour ne
        // pas faire dépendre ce module de main.js directement.
        if (doneProfileIdentityEl && pointsApi.buildBadgeFrame) {
          doneProfileIdentityEl.innerHTML = "";
          doneProfileIdentityEl.appendChild(
            pointsApi.buildBadgeFrame(
              profile?.avatar ?? DEFAULT_AVATAR,
              profile?.pseudo?.trim() || "Configurer mon profil",
              profile?.activeBadge,
              { chevron: true }
            )
          );
        }
        return;
      }
      render();
    },
  };
}
