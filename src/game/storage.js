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
  volume: 80, // 0-100, curseur commun sons+musique (voir main.js)
  soundMuted: false,
  musicMuted: false,
  globalMuted: false, // toggle unique "couper le son" accessible partout — voir index.html/main.js
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

/** Efface TOUTE la sauvegarde (progression, réglages, points) — voir le
 * bouton "Réinitialiser le jeu" dans Options. Ne touche PAS aux niveaux
 * custom de l'éditeur (STORAGE_KEY dans editor.js): l'éditeur est un outil
 * de développement séparé du jeu tel que vécu par le joueur. */
export function eraseAllProgress() {
  for (const key of Object.values(KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {
      // voir writeJson
    }
  }
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
