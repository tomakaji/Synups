// Toute la persistance (localStorage) de l'app rassemblée ici — progression
// Histoire, réglages son/musique/thème PixelArt, points. Auparavant
// éparpillée (POINTS_STORAGE_KEY dans main.js, STORAGE_KEY dans editor.js
// pour les niveaux custom — celui-ci reste dans editor.js, hors du périmètre
// de ce module) : centraliser le reste évite de dupliquer le même motif
// try/catch à chaque nouveau réglage, maintenant qu'on en ajoute beaucoup
// d'un coup (écran titre/options/Remember).
//
// Chaque store est indépendant (clé localStorage dédiée) plutôt qu'un seul
// gros objet JSON : une future feature qui ajoute son propre réglage n'a pas
// à composer avec la forme exacte des autres, et une erreur de parsing sur
// l'un ne corrompt jamais les autres.

const KEYS = {
  points: "lightup-infinite-points", // clé pré-existante (main.js) — conservée telle quelle pour ne pas perdre le total déjà gagné par les joueurs actuels
  progress: "lightup-story-progress",
  settings: "lightup-settings",
  seenMechanics: "lightup-seen-mechanics",
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage indisponible (navigation privée, quota...): la valeur reste
    // correcte en mémoire pour la session en cours, simplement pas persistée
    // — même choix que POINTS_STORAGE_KEY à l'origine.
  }
}

// ---------- Points (mode Infini, dépensés dans Remember) ----------

export function loadPoints() {
  try {
    const raw = localStorage.getItem(KEYS.points);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function savePoints(points) {
  try {
    localStorage.setItem(KEYS.points, String(points));
  } catch {
    // voir writeJson
  }
}

// ---------- Progression Histoire ----------
// `completed`: ensemble d'index (0-based) de niveaux statiques (levels.js)
// déjà résolus au moins une fois. Le déverrouillage se déduit toujours de cet
// ensemble (jamais stocké séparément, pour ne jamais désynchroniser les
// deux) : un niveau est débloqué si tous les niveaux qui le précèdent sont
// dans `completed` — voir `unlockedCount`.

export function loadStoryProgress() {
  const data = readJson(KEYS.progress, { completed: [] });
  return new Set(Array.isArray(data.completed) ? data.completed : []);
}

export function saveStoryProgress(completedSet) {
  writeJson(KEYS.progress, { completed: Array.from(completedSet) });
}

// ---------- Mécaniques déjà expliquées (mode Histoire) ----------
// Round 23 (retour utilisateur: "on pourrait essayer d'intégrer des
// 'schéma' qui expliquent les mécaniques de façon très simplifiée à chaque
// nouveau composant ajouté") — un Set d'IDs de mécaniques (voir
// community-store.js: detectMechanics, même vocabulaire que les icônes de
// cartes Communauté) déjà montrées au joueur AU MOINS une fois, pour
// n'afficher la modale explicative qu'à la toute première rencontre — même
// forme de stockage que loadStoryProgress/saveStoryProgress ci-dessus.
export function loadSeenMechanics() {
  const data = readJson(KEYS.seenMechanics, { seen: [] });
  return new Set(Array.isArray(data.seen) ? data.seen : []);
}

export function saveSeenMechanics(seenSet) {
  writeJson(KEYS.seenMechanics, { seen: Array.from(seenSet) });
}

/** Nombre de niveaux accessibles (1 à `total`) : les niveaux complétés, EN
 * PARTANT DU DÉBUT ET SANS TROU, plus le tout premier niveau pas encore fait
 * — c'est-à-dire la frontière de progression. Un trou (niveau 5 fait sans le
 * 4) ne peut normalement pas arriver (déverrouillage strictement dans
 * l'ordre) mais s'il survient quand même (édition manuelle du storage), il
 * ne débloque rien au-delà du premier trou plutôt que de planter. */
export function unlockedCount(completedSet, total) {
  let n = 0;
  while (n < total && completedSet.has(n)) n++;
  return Math.min(total, n + 1);
}

/** Index (0-based) du niveau "en cours" pour le raccourci "Histoire" du menu
 * titre: le premier non complété, ou le dernier niveau si tout est fini
 * (aucun niveau "après" à proposer — on retombe sur la sélection classique). */
export function currentStoryIndex(completedSet, total) {
  for (let i = 0; i < total; i++) if (!completedSet.has(i)) return i;
  return total - 1;
}

// ---------- Réglages (son/musique/thème PixelArt) ----------

const DEFAULT_SETTINGS = {
  volume: 80, // 0-100, curseur commun sons+musique (voir main.js) — jamais modifié par `muted` lui-même (voir applyVolumes: seul l'AFFICHAGE du curseur retombe à 0 le temps du mute, la valeur réelle reste intacte pour être réappliquée telle quelle au démute).
  // Round 19 (retour utilisateur): "le bouton flottant et le bouton dans
  // Options [...] appellent la même fonction et variable" — remplace les
  // anciens soundMuted+globalMuted (round <19, deux booléens distincts pour
  // deux boutons qui faisaient déjà presque la même chose) par CE SEUL
  // booléen, piloté indifféremment par les deux boutons (voir main.js:
  // setMuted). Coupe son ET musique (voir applyVolumes) ; musicMuted
  // ci-dessous reste un réglage INDÉPENDANT (couper juste la musique, pas
  // les effets sonores).
  muted: false,
  musicMuted: false,
  // Thème visuel PixelArt: 5e/dernière récompense de Remember (voir
  // sommation.js: isPixelArtUnlocked). Le toggle n'est exposé dans Options
  // qu'une fois débloqué, mais la valeur peut techniquement persister à
  // false même avant déverrouillage (pas de risque, juste inerte).
  pixelartEnabled: false,
};

export function loadSettings() {
  const data = readJson(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...data };
}

export function saveSettings(settings) {
  writeJson(KEYS.settings, settings);
}

/** Efface la progression Histoire/Infini (voir le bouton "Réinitialiser le
 * jeu" dans Options) — PLUS, depuis round 19 (retour utilisateur:
 * "réinitialiser le profil joueur doit aussi réinitialiser le Remember + les
 * bonus débloqués [...] la seule donnée conservée sera les niveaux dans
 * Communauté [...], les réglages son et le pseudo"), le reste de la
 * progression Remember (voir main.js: appelle en plus
 * sommation.js:resetSommationProgress() et remet à zéro avatar/badge actif
 * du profil, PAS son pseudo). Contrairement à avant ce round, ne vide plus
 * KEYS.settings en bloc — volume/muted/musicMuted (réglages son) sont
 * désormais explicitement PROTÉGÉS ; seul `pixelartEnabled` (un
 * déverrouillage, pas un réglage son) est remis à false ici, puisque c'est
 * le seul champ de KEYS.settings concerné par un "bonus débloqué". Ne touche
 * toujours PAS aux niveaux custom de l'éditeur (STORAGE_KEY dans editor.js)
 * ni aux données Communauté (community-store.js) : hors du périmètre d'un
 * reset de progression/profil joueur. */
export function eraseAllProgress() {
  try {
    localStorage.removeItem(KEYS.points);
  } catch {
    // voir writeJson
  }
  try {
    localStorage.removeItem(KEYS.progress);
  } catch {
    // voir writeJson
  }
  // Round 23: les modales pédagogiques (voir loadSeenMechanics ci-dessus)
  // redeviennent pertinentes à la même occasion que la progression Histoire
  // elle-même — sans ce retrait, un joueur qui recommence les reverrait
  // jamais, alors qu'il "redécouvre" chaque mécanique depuis le niveau 1.
  try {
    localStorage.removeItem(KEYS.seenMechanics);
  } catch {
    // voir writeJson
  }
  saveSettings({ ...loadSettings(), pixelartEnabled: false });
}

// ---------- Profil joueur (section Communauté) ----------
// Volontairement à part de KEYS/eraseAllProgress ci-dessus, même raisonnement
// que les niveaux custom de l'éditeur (STORAGE_KEY dans editor.js): "Mon
// profil" et les grilles publiées/likées (voir community-store.js) forment
// un espace séparé de la progression Histoire/Infini — "Réinitialiser le
// jeu" ne doit pas faire perdre son pseudo ni ses créations communautaires.
// Faké entièrement en local pour l'instant (pas de vrai compte/backend —
// voir community-store.js): juste assez pour préfigurer un futur branchement
// à un vrai fournisseur d'identité (Google Play Games ou autre).
const PROFILE_KEY = "lightup-community-profile";

export function loadProfile() {
  return readJson(PROFILE_KEY, null);
}

export function saveProfile(profile) {
  writeJson(PROFILE_KEY, profile);
}

export function hasProfile() {
  return loadProfile() != null;
}

/** Met à jour PARTIELLEMENT le profil (pseudo/avatar/activeBadge...) sans
 * écraser les champs non fournis — utile pour un réglage isolé comme le
 * badge "actif" (voir main.js: sélection dans "Mon profil", round 18)
 * pendant que le formulaire pseudo/avatar reste géré séparément par
 * saveProfile ci-dessus. */
export function updateProfile(partial) {
  const next = { ...(loadProfile() || {}), ...partial };
  saveProfile(next);
  return next;
}
