// Communauté (créer / partager / jouer des grilles d'autres joueurs) — voir
// plan validé avec l'utilisateur : "tout local, feed simulé". Aucun vrai
// backend pour l'instant : ce module est l'UNIQUE endroit qui sait comment
// les grilles communautaires sont stockées et calculées (SEED_LEVELS statique
// + une couche locale dans localStorage) — le jour où un vrai service est
// branché, seul ce fichier changera, pas l'UI (main.js/editor.js).
//
// Trois familles de données, toutes indépendantes (même raisonnement que
// storage.js: une erreur de parsing sur l'une ne corrompt jamais les autres) :
//   - `published`: les grilles QUE VOUS avez publiées (créées dans l'éditeur,
//     ou importées par code) — la seule chose qu'on écrit vraiment ici.
//   - `likes`: l'ensemble des ids de grilles que VOUS avez likées (seed ou
//     publiées) — un like n'a aucun effet sur les autres joueurs, il n'existe
//     que dans votre navigateur.
//   - `plays`: combien de fois VOUS avez résolu chaque grille.
// Le nombre de likes/parties AFFICHÉ à l'écran = la base fictive de la seed
// (`baseLikes`/`basePlays`, voir community-seed.js) + votre propre couche
// locale — ça donne l'impression d'un fil vivant sans jamais prétendre
// refléter de vraies statistiques multi-joueurs.
import { LightUpGrid } from "./grid.js";
import { analyzeSolve } from "./solver.js";
import { SEED_LEVELS } from "./community-seed.js";

const KEYS = {
  published: "lightup-community-published",
  likes: "lightup-community-likes",
  plays: "lightup-community-plays",
};

/** Choix d'avatar pour le profil joueur (voir storage.js: loadProfile) et la
 * modale "Publier" de l'éditeur — un seul endroit pour cette liste plutôt
 * que dupliquée entre main.js et editor.js, pour qu'un ajout futur (ou un
 * jour, de vraies photos de profil) n'ait qu'un seul fichier à toucher.
 * Même famille que les auteurs fictifs de community-seed.js, pour que les
 * créations des vrais joueurs se mêlent visuellement au fil simulé.
 *
 * Round 18 (retour utilisateur): "il nous faut une liste d'avatars qu'on
 * débloque au fil du jeu [...] en rapport avec le jeu et son design" — la
 * plupart restent débloqués d'office (c'était déjà le cas, aucune
 * régression) le temps que la vraie logique de déblocage soit décidée
 * ailleurs, mais la STRUCTURE est prête : `locked` porte une clé de
 * déblocage optionnelle, résolue par l'appelant (voir isAvatarUnlocked
 * ci-dessous) plutôt que ce module ne connaisse la progression du jeu.
 * "retro" est le premier avatar réellement verrouillé, aligné sur la 5e et
 * dernière récompense Remember (voir sommation.js: isPixelArtUnlocked). */
export const AVATARS = [
  { id: "smile", emoji: "🙂" },
  { id: "brain", emoji: "🧠" },
  { id: "spark", emoji: "✨" },
  { id: "diamond", emoji: "🔷" },
  { id: "nebula", emoji: "🌌" },
  { id: "bolt", emoji: "⚡" },
  { id: "moon", emoji: "🌙" },
  { id: "butterfly", emoji: "🦋" },
  { id: "spiral", emoji: "🌀" },
  { id: "saturn", emoji: "🪐" },
  { id: "wave", emoji: "🌊" },
  { id: "puzzle", emoji: "🧩" },
  { id: "fire", emoji: "🔥" },
  { id: "satellite", emoji: "🛰️" },
  { id: "owl", emoji: "🦉" },
  { id: "target", emoji: "🎯" },
  { id: "crystal", emoji: "🔮" },
  { id: "retro", emoji: "👾", locked: "pixelart" },
];

/** Rétrocompatibilité (profils déjà enregistrés avec un avatar par défaut) :
 * le premier avatar de la liste sert de repli si l'avatar sauvegardé n'existe
 * plus / n'est plus valide. */
export const DEFAULT_AVATAR = AVATARS[0].emoji;

/** true si `avatar` (une entrée de AVATARS) est déverrouillé. `unlocks` est
 * un sac de clés->booléen fourni par l'appelant (voir main.js/editor.js:
 * { pixelart: isPixelArtUnlocked() }) — ce module ne sait rien de la
 * progression du jeu lui-même, uniquement de la liste et de ses clés. */
export function isAvatarUnlocked(avatar, unlocks = {}) {
  return !avatar.locked || !!unlocks[avatar.locked];
}

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
    // correcte en mémoire pour la session en cours — même choix que le
    // reste de l'app (voir storage.js).
  }
}

function loadPublished() {
  const data = readJson(KEYS.published, []);
  return Array.isArray(data) ? data : [];
}

function savePublished(list) {
  writeJson(KEYS.published, list);
}

function loadLikedIds() {
  const data = readJson(KEYS.likes, []);
  return new Set(Array.isArray(data) ? data : []);
}

function saveLikedIds(set) {
  writeJson(KEYS.likes, Array.from(set));
}

function loadPlays() {
  const data = readJson(KEYS.plays, {});
  return data && typeof data === "object" ? data : {};
}

function savePlays(map) {
  writeJson(KEYS.plays, map);
}

function nextLocalId() {
  return `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Ajoute les champs calculés (likes/plays affichés, likedByMe) à une entrée
 * brute (seed ou publiée) — TOUJOURS relu depuis localStorage à l'appel
 * plutôt que mis en cache, pour ne jamais afficher un like/une partie
 * périmé après une action juste avant. */
function decorate(entry, source, likedIds, plays) {
  const myPlays = plays[entry.id] || 0;
  return {
    ...entry,
    source, // "seed" (contenu fictif intégré) | "local" (créé/importé par vous)
    likes: (entry.baseLikes ?? 0) + (likedIds.has(entry.id) ? 1 : 0),
    plays: (entry.basePlays ?? 0) + myPlays,
    likedByMe: likedIds.has(entry.id),
    myPlays,
  };
}

/** Tout le fil communautaire (vos créations/imports d'abord, puis la seed),
 * prêt à être filtré/trié/affiché par l'appelant (voir main.js). */
export function listLevels() {
  const likedIds = loadLikedIds();
  const plays = loadPlays();
  const local = loadPublished().map((l) => decorate(l, "local", likedIds, plays));
  const seed = SEED_LEVELS.map((l) => decorate(l, "seed", likedIds, plays));
  return [...local, ...seed];
}

export function getLevel(id) {
  return listLevels().find((l) => l.id === id) || null;
}

/** Grilles que vous avez likées, seed ou publiées confondues — pour l'écran
 * "Mon profil". */
export function likedLevels() {
  return listLevels().filter((l) => l.likedByMe);
}

/** Bascule votre like sur une grille et renvoie le nouvel état (true = vous
 * l'aimez désormais). Fonctionne aussi bien sur une grille seed que sur une
 * grille publiée (locale ou par un autre "joueur" simulé). */
export function toggleLike(id) {
  const liked = loadLikedIds();
  if (liked.has(id)) liked.delete(id);
  else liked.add(id);
  saveLikedIds(liked);
  return liked.has(id);
}

/** Incrémente VOTRE compteur de parties pour cette grille — appelé à la
 * résolution d'un niveau communautaire (voir main.js: mode "community"). */
export function markPlayed(id) {
  const plays = loadPlays();
  plays[id] = (plays[id] || 0) + 1;
  savePlays(plays);
}

/** Mécaniques réellement présentes dans une grille, déduites des tokens —
 * contrairement au mode Infini (qui connaît déjà son `featureSubset` par
 * construction), une grille peinte dans l'éditeur ou collée par code n'a pas
 * cette info toute faite. */
export function detectMechanics(cells) {
  const found = new Set();
  for (const row of cells) {
    const tokens = Array.isArray(row) ? row : String(row).trim().split(/\s+/);
    for (const token of tokens) {
      if (token === "0") found.add("forbidden");
      else if (token === "/" || token === "\\") found.add("mirror");
      else if (token === "Y") found.add("pyra");
      else if (token === "M") found.add("mirrorNeuron");
      else if (/^F/.test(token)) found.add("filter");
      else if (/^P/.test(token)) found.add("prism");
      else if (/^\d/.test(token) && token.length > 1) found.add("color"); // charge colorée, ex "2r"
      else if (/^[rgbycmw]$/.test(token)) found.add("color"); // case-cible couleur
    }
  }
  return Array.from(found);
}

/** Palier solveur (1-4, voir solver.js: computeTier) converti en étoiles
 * affichées (1-3) — même conversion que le générateur Infini
 * (`starsForSolverTier`, non exportée de generator.js, donc reproduite ici
 * plutôt que dupliquée en plusieurs endroits différemment). */
function starsForSolverTier(tier) {
  if (tier == null) return 1;
  return Math.max(1, tier - 1);
}

/** Valide qu'un objet a la forme d'une grille jouable ET qu'il a
 * effectivement une solution (même garde-fou que l'éditeur avant Exporter/
 * Sauvegarder, voir editor.js) — obligatoire avant de publier ou d'importer
 * un code de partage, pour ne jamais laisser entrer une grille cassée dans
 * le fil communautaire. Mesure aussi la difficulté au passage (un seul
 * appel au solveur, pas deux). */
export function validatePlayableLevel({ rows, cols, cells }) {
  if (!Number.isInteger(rows) || rows < 1) return { error: "Nombre de lignes invalide." };
  if (!Number.isInteger(cols) || cols < 1) return { error: "Nombre de colonnes invalide." };
  if (!Array.isArray(cells) || cells.length !== rows) return { error: "Grille invalide (lignes manquantes)." };
  try {
    new LightUpGrid({ name: "", rows, cols, cells });
  } catch (e) {
    return { error: `Case invalide dans la grille : ${e.message}` };
  }
  let analysis;
  try {
    analysis = analyzeSolve({ name: "", rows, cols, cells }, 300_000);
  } catch (e) {
    return { error: `Erreur du solveur : ${e.message}` };
  }
  if (!analysis) return { error: "Cette grille n'a aucune solution — impossible de la publier." };
  return { ok: true, solutionLength: analysis.solution.length, difficulty: starsForSolverTier(analysis.tier) };
}

/** true si une grille du même titre par le même auteur existe déjà dans le
 * fil (seed ou publiée, peu importe) — retour utilisateur round 18: la
 * modale de confirmation "Publier" doit vérifier "qu'il n'existe pas de
 * niveau qui a le même combo nom + auteur" avant de laisser passer, pour
 * éviter les republications accidentelles/redondantes du même niveau. */
export function isDuplicatePublication(title, authorPseudo) {
  const t = (title || "").trim().toLowerCase();
  const a = (authorPseudo || "").trim().toLowerCase();
  if (!t) return false;
  return listLevels().some(
    (l) => (l.title || "").trim().toLowerCase() === t && (l.author?.pseudo || "").trim().toLowerCase() === a
  );
}

/** Publie une grille (depuis l'éditeur, voir editor.js) dans VOTRE espace
 * local — visible dans le fil communautaire de ce même navigateur
 * uniquement (voir en-tête du fichier). L'appelant doit avoir déjà validé
 * la grille via `validatePlayableLevel`. */
export function publishLevel({ title, rows, cols, cells, author, difficulty }) {
  const entry = {
    id: nextLocalId(),
    title,
    author,
    rows,
    cols,
    cells,
    mechanics: detectMechanics(cells),
    difficulty: difficulty ?? null,
    createdAt: new Date().toISOString(),
    baseLikes: 0,
    basePlays: 0,
  };
  const list = loadPublished();
  list.unshift(entry);
  savePublished(list);
  return decorate(entry, "local", loadLikedIds(), loadPlays());
}

/** Retire une grille que vous aviez publiée (voir écran "Mon profil") — sans
 * effet sur une grille seed (contenu fictif intégré, jamais éditable). */
export function unpublishLevel(id) {
  savePublished(loadPublished().filter((l) => l.id !== id));
}

// ---------- Partage par code (export/import manuel, sans backend) ----------
// Retour utilisateur ("tout local, feed simulé") + besoin réel de faire
// passer une grille d'un appareil à un autre malgré l'absence de backend :
// un code base64 autoportant (titre + auteur + grille) à copier-coller
// (Discord, SMS, etc.), décodé et validé exactement comme une publication
// normale avant d'atterrir dans VOTRE espace local.
const SHARE_CODE_PREFIX = "SYN1-";

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShareCode(entry) {
  const payload = {
    title: entry.title,
    author: entry.author,
    rows: entry.rows,
    cols: entry.cols,
    cells: entry.cells,
    mechanics: entry.mechanics,
    difficulty: entry.difficulty,
  };
  return SHARE_CODE_PREFIX + utf8ToBase64(JSON.stringify(payload));
}

/** Décode + valide un code de partage. Ne modifie rien : c'est à l'appelant
 * (voir main.js) d'appeler `importSharedLevel` s'il veut vraiment l'ajouter. */
export function decodeShareCode(code) {
  const trimmed = String(code || "").trim();
  if (!trimmed.startsWith(SHARE_CODE_PREFIX)) {
    return { error: "Code invalide : ce n'est pas un code de partage Synups." };
  }
  let json;
  try {
    json = base64ToUtf8(trimmed.slice(SHARE_CODE_PREFIX.length));
  } catch {
    return { error: "Code invalide : impossible de le décoder." };
  }
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    return { error: "Code invalide : contenu corrompu." };
  }
  const { title, author, rows, cols, cells, mechanics, difficulty } = payload || {};
  if (typeof title !== "string" || !title.trim()) {
    return { error: "Code invalide : titre manquant." };
  }
  const check = validatePlayableLevel({ rows, cols, cells });
  if (check.error) return { error: check.error };
  return {
    level: {
      title: title.trim(),
      author: author && typeof author.pseudo === "string" ? author : { pseudo: "Joueur", avatar: "🙂" },
      rows,
      cols,
      cells,
      mechanics: Array.isArray(mechanics) ? mechanics : detectMechanics(cells),
      difficulty: Number.isInteger(difficulty) ? difficulty : check.difficulty,
    },
  };
}

/** Ajoute à votre espace local une grille déjà décodée+validée par
 * `decodeShareCode`. */
export function importSharedLevel(level) {
  const entry = {
    id: nextLocalId(),
    title: level.title,
    author: level.author,
    rows: level.rows,
    cols: level.cols,
    cells: level.cells,
    mechanics: level.mechanics,
    difficulty: level.difficulty ?? null,
    createdAt: new Date().toISOString(),
    baseLikes: 0,
    basePlays: 0,
  };
  const list = loadPublished();
  list.unshift(entry);
  savePublished(list);
  return decorate(entry, "local", loadLikedIds(), loadPlays());
}
