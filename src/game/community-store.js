// Communauté (créer / partager / jouer des grilles d'autres joueurs).
//
// Round 20 (retour utilisateur: "j'ai un compte firebase [...] tu peux
// mettre en place tout ce qu'il faut ?") — les grilles PUBLIÉES/IMPORTÉES
// vivent désormais dans Firestore (collection `levels`, voir
// firebase-config.js) au lieu de localStorage: c'est la seule donnée
// GENUINEMENT partagée entre joueurs (voir échange avec l'utilisateur:
// PlayStore/AppStore ne fournissent aucun stockage, et c'est la seule partie
// de l'app qui a vraiment besoin d'un vrai backend multi-joueurs). Ce module
// reste l'UNIQUE endroit qui sait comment les grilles communautaires sont
// stockées et calculées — le jour où ça change encore, seul ce fichier
// bouge, pas l'UI (main.js/editor.js).
//
// `likes`/`plays`, eux, restent 100% locaux (localStorage) comme avant: ce
// sont des compteurs délibérément personnels/"fictifs" (voir plus bas), pas
// une vraie fonctionnalité sociale — les remonter en base aurait exigé un
// vrai système de compteurs partagés (transactions Firestore) pour un
// bénéfice hors scope de cette demande.
//
// Trois familles de données, toutes indépendantes (même raisonnement que
// storage.js: une erreur sur l'une ne corrompt jamais les autres) :
//   - les grilles Firestore (`cloudLevels`, cache local tenu à jour en temps
//     réel par onSnapshot, voir initCommunityCloud) — TOUTES les grilles
//     publiées/importées par TOUS les joueurs, les vôtres comme celles des
//     autres (distinguées via `ownerUid`, voir listLevels: source "local" vs
//     "community").
//   - `likes` (localStorage): l'ensemble des ids de grilles que VOUS avez
//     likées (seed, vôtres, ou d'un autre joueur) — un like n'a aucun effet
//     sur les autres joueurs, il n'existe que dans votre navigateur.
//   - `plays` (localStorage): combien de fois VOUS avez résolu chaque grille.
// Le nombre de likes/parties AFFICHÉ à l'écran = la base fictive de la seed
// (`baseLikes`/`basePlays`, voir community-seed.js) + votre propre couche
// locale — pour une grille Firestore d'un autre joueur (pas de base fictive),
// ça se résume donc à "0 ou 1 like (le vôtre) / vos propres parties" tant
// qu'aucun vrai compteur partagé n'est branché — comportement honnête plutôt
// qu'un faux total, décision assumée plutôt qu'un oubli.
import { LightUpGrid } from "./grid.js";
import { analyzeSolve } from "./solver.js";
import { SEED_LEVELS } from "./community-seed.js";
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { db, firebaseReady } from "./firebase-config.js";

const LEVELS_COLLECTION = "levels";

const KEYS = {
  likes: "lightup-community-likes",
  plays: "lightup-community-plays",
};

/** Choix d'avatar pour le profil joueur (voir storage.js: loadProfile) — un
 * seul endroit pour cette liste plutôt que dupliquée entre main.js et
 * editor.js. Même famille que les auteurs fictifs de community-seed.js,
 * pour que les créations des vrais joueurs se mêlent visuellement au fil
 * simulé.
 *
 * Round 19 (retour utilisateur): "on supprime tous les avatars sauf ceux
 * qui sont en lien avec le jeu [...] pas juste des sortes d'émoticones" —
 * remplace les emojis génériques par des icônes SVG dérivées du langage
 * visuel du plateau (mêmes formes/couleurs que game/render.js, mais
 * redessinées en statique: un avatar n'a pas d'état de cellule vivant à
 * refléter) + "retro", un sprite façon envahisseur 8-bit dans le vert CRT du
 * thème PixelArt.
 *
 * Round 22 (retour utilisateur): l'avatar "Filtre" (mécanique jamais
 * implémentée, voir generator.js: FEATURES) est retiré — plus que 9 avatars.
 * ORDRE = ordre de déblocage (retour utilisateur: "ordre d'affichage dans le
 * profil à changer") :
 *   1. neuron  — par défaut, débloqué dès le premier profil.
 *   2-4. charge/synapse/mirror — mode Histoire, tous les 10 niveaux
 *        (10/20/30 sur 32 niveaux au total, voir levels.js).
 *   5-8. wall/target/pyra/prism — achetables avec les points partagés
 *        (Infini/Remember), prix croissant 100/200/400/1000 — "Mur avant
 *        Cible [...] Pyra avant le prisme [...] le prisme en avant-dernier"
 *        (dernier = retro, ci-dessous, déblocage à part).
 *   9. retro — 5e/dernière récompense de Remember (inchangé, voir
 *        sommation.js: isPixelArtUnlocked).
 *
 * `svg` (pas `emoji`) est la donnée persistée: `profile.avatar` et
 * `author.avatar` stockent désormais l'ID (ex: "neuron"), jamais le SVG
 * lui-même — voir getAvatarSvg ci-dessous pour la résolution à l'affichage.
 * `unlock` décrit COMMENT il se débloque (résolu par l'appelant, voir
 * isAvatarUnlocked/avatarUnlockLabel ci-dessous) — ce module ne sait rien de
 * la progression du jeu lui-même, uniquement de la liste et de son type de
 * déblocage. */
export const AVATARS = [
  {
    id: "neuron",
    label: "Neurone",
    unlock: { type: "default" },
    svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="24" fill="none" stroke="#0a0c10" stroke-width="14"/><circle cx="50" cy="50" r="24" fill="none" stroke="#6ee7ff" stroke-width="8"/></svg>',
  },
  {
    id: "charge",
    label: "Charge",
    unlock: { type: "story", level: 10 },
    svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="15" fill="#3a8fa0"/><circle cx="26" cy="26" r="7" fill="#8fd9e8"/><circle cx="74" cy="26" r="7" fill="#8fd9e8"/><circle cx="26" cy="74" r="7" fill="#8fd9e8"/><circle cx="74" cy="74" r="7" fill="#8fd9e8"/></svg>',
  },
  {
    id: "synapse",
    label: "Synapse",
    unlock: { type: "story", level: 20 },
    svg: '<svg viewBox="0 0 100 100"><line x1="30" y1="30" x2="70" y2="70" stroke="#7a6fd0" stroke-width="8"/><circle cx="30" cy="30" r="15" fill="#7a6fd0"/><circle cx="70" cy="70" r="15" fill="#9a90e0"/></svg>',
  },
  {
    id: "mirror",
    label: "Miroir",
    unlock: { type: "story", level: 30 },
    svg: '<svg viewBox="0 0 100 100"><line x1="18" y1="82" x2="82" y2="18" stroke="#4a5468" stroke-width="16" stroke-linecap="round"/><line x1="18" y1="82" x2="82" y2="18" stroke="#9fb4d8" stroke-width="6" stroke-linecap="round"/></svg>',
  },
  {
    id: "wall",
    label: "Mur",
    unlock: { type: "purchase", cost: 100 },
    svg: '<svg viewBox="0 0 100 100"><rect x="14" y="14" width="72" height="72" rx="6" fill="none" stroke="#4a5468" stroke-width="5"/><path d="M14,42 L42,14 M14,66 L66,14 M14,90 L90,14 M38,90 L90,38 M62,90 L90,62" stroke="#4a5468" stroke-width="5"/></svg>',
  },
  {
    id: "target",
    label: "Cible",
    unlock: { type: "purchase", cost: 200 },
    svg: '<svg viewBox="0 0 100 100"><path d="M16,30 V16 H30 M70,16 H84 V30 M84,70 V84 H70 M30,84 H16 V70" fill="none" stroke="#e8b563" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="50" r="6" fill="#e8b563"/></svg>',
  },
  {
    id: "pyra",
    label: "Pyra",
    unlock: { type: "purchase", cost: 400 },
    svg: '<svg viewBox="0 0 100 100"><polygon points="50,15 85,80 15,80" fill="none" stroke="#4a5468" stroke-width="6"/><circle cx="50" cy="15" r="7" fill="#ff5d6c"/><circle cx="85" cy="80" r="7" fill="#59e39d"/><circle cx="15" cy="80" r="7" fill="#5da9ff"/></svg>',
  },
  {
    id: "prism",
    label: "Prisme",
    unlock: { type: "purchase", cost: 1000 },
    svg: '<svg viewBox="0 0 100 100"><polygon points="50,50 92,50 50,8" fill="#ff5d6c"/><polygon points="50,50 50,8 8,50" fill="#f4d35e"/><polygon points="50,50 8,50 50,92" fill="#59c9e3"/><polygon points="50,50 50,92 92,50" fill="#59e39d"/></svg>',
  },
  {
    id: "retro",
    label: "Rétro",
    unlock: { type: "pixelart" },
    svg: '<svg viewBox="0 0 100 100" shape-rendering="crispEdges"><g fill="#39ff14"><rect x="30" y="15" width="10" height="10"/><rect x="60" y="15" width="10" height="10"/><rect x="20" y="25" width="10" height="10"/><rect x="30" y="25" width="40" height="10"/><rect x="70" y="25" width="10" height="10"/><rect x="15" y="35" width="70" height="10"/><rect x="15" y="45" width="10" height="10"/><rect x="30" y="45" width="10" height="10"/><rect x="40" y="45" width="20" height="10"/><rect x="60" y="45" width="10" height="10"/><rect x="75" y="45" width="10" height="10"/><rect x="15" y="55" width="70" height="10"/><rect x="25" y="65" width="10" height="10"/><rect x="65" y="65" width="10" height="10"/></g></svg>',
  },
  // Défi Quotidien (retour utilisateur: "[les étoiles] permettront de
  // débloquer des avatars et des badges") — lot DÉDIÉ aux étoiles, séparé du
  // lot "purchase" ci-dessus (points) : voir unlock.type "star" dans
  // isAvatarUnlocked/avatarUnlockLabel plus bas, et dailyChallenge.js pour la
  // monnaie elle-même (1 étoile/jour).
  //
  // Retour utilisateur (round suivant) : "les 5 badges achetables avec les
  // éclairs seront à ces prix : 3, 5, 10, 20, 50" — Comète/Supernova
  // (5/20) existaient déjà, complété ici par 3 nouveaux badges (3/10/50)
  // dans la MÊME veine céleste/énergie plutôt qu'un thème différent, pour
  // que le lot des 5 reste visuellement cohérent (dégradé de rareté du
  // météore modeste au corps céleste le plus spectaculaire) — ORDONNÉS par
  // coût croissant dans le tableau, comme le reste de la liste.
  {
    id: "meteor",
    label: "Météore",
    unlock: { type: "star", cost: 3 },
    svg: '<svg viewBox="0 0 100 100"><path d="M78,22 L28,72" stroke="#ff7a45" stroke-width="8" stroke-linecap="round" opacity="0.5"/><path d="M74,26 L40,60" stroke="#ffb98a" stroke-width="4" stroke-linecap="round" opacity="0.85"/><circle cx="26" cy="74" r="15" fill="#c9563a"/><circle cx="21" cy="69" r="3" fill="#8f3722"/><circle cx="31" cy="80" r="2.5" fill="#8f3722"/></svg>',
  },
  {
    id: "comet",
    label: "Comète",
    unlock: { type: "star", cost: 5 },
    svg: '<svg viewBox="0 0 100 100"><circle cx="68" cy="32" r="14" fill="#ffd76e"/><path d="M58,42 L18,86" stroke="#ffd76e" stroke-width="7" stroke-linecap="round" opacity="0.55"/><path d="M62,38 L30,78" stroke="#ffe9b0" stroke-width="4" stroke-linecap="round" opacity="0.8"/></svg>',
  },
  {
    id: "aurora",
    label: "Aurore",
    unlock: { type: "star", cost: 10 },
    svg: '<svg viewBox="0 0 100 100"><path d="M8,70 Q30,40 50,58 T92,42" fill="none" stroke="#59e39d" stroke-width="8" stroke-linecap="round" opacity="0.75"/><path d="M8,58 Q30,28 50,46 T92,30" fill="none" stroke="#5da9ff" stroke-width="7" stroke-linecap="round" opacity="0.7"/><path d="M8,46 Q30,16 50,34 T92,18" fill="none" stroke="#c98fe0" stroke-width="6" stroke-linecap="round" opacity="0.65"/></svg>',
  },
  {
    id: "nova",
    label: "Supernova",
    unlock: { type: "star", cost: 20 },
    svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="14" fill="#ffe9b0"/><g stroke="#c98fe0" stroke-width="6" stroke-linecap="round"><line x1="50" y1="8" x2="50" y2="26"/><line x1="50" y1="74" x2="50" y2="92"/><line x1="8" y1="50" x2="26" y2="50"/><line x1="74" y1="50" x2="92" y2="50"/><line x1="21" y1="21" x2="34" y2="34"/><line x1="66" y1="66" x2="79" y2="79"/><line x1="79" y1="21" x2="66" y2="34"/><line x1="34" y1="66" x2="21" y2="79"/></g></svg>',
  },
  {
    id: "eclipse",
    label: "Éclipse",
    unlock: { type: "star", cost: 50 },
    svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#ffd76e" stroke-width="6"/><g stroke="#ffd76e" stroke-width="4" stroke-linecap="round"><line x1="50" y1="2" x2="50" y2="12"/><line x1="50" y1="88" x2="50" y2="98"/><line x1="2" y1="50" x2="12" y2="50"/><line x1="88" y1="50" x2="98" y2="50"/><line x1="15" y1="15" x2="22" y2="22"/><line x1="78" y1="78" x2="85" y2="85"/><line x1="85" y1="15" x2="78" y2="22"/><line x1="22" y1="78" x2="15" y2="85"/></g><circle cx="46" cy="50" r="32" fill="#0a0c10"/></svg>',
  },
];

/** Rétrocompatibilité (profils déjà enregistrés avec un avatar par défaut) :
 * le premier avatar de la liste sert de repli si l'avatar sauvegardé n'existe
 * plus / n'est plus valide — notamment les anciens profils qui stockaient un
 * emoji brut (round 18 et avant), ou l'ancien avatar "Filtre" (retiré round
 * 22), qui ne correspondent plus à aucun ID ici. */
export const DEFAULT_AVATAR = AVATARS[0].id;

/** Résout un ID d'avatar (voir profile.avatar/author.avatar) en markup SVG à
 * afficher — jamais l'inverse (aucun code n'a besoin de "deviner" un ID
 * depuis un SVG). Retombe sur l'avatar par défaut si l'ID est inconnu (voir
 * DEFAULT_AVATAR ci-dessus: anciens profils emoji, ID corrompu...). */
export function getAvatarSvg(id) {
  return (AVATARS.find((a) => a.id === id) || AVATARS[0]).svg;
}

/** true si `avatar` (une entrée de AVATARS) est déverrouillé. `state` est
 * fourni par l'appelant (voir main.js: avatarUnlocks()) et ne dépend QUE du
 * type de déblocage de l'avatar — ce module ne sait rien de la progression
 * du jeu lui-même :
 *   - "default": toujours vrai.
 *   - "story": `state.storyCompleted` (niveaux Histoire complétés) >= `level`.
 *   - "purchase": `state.owned` (Set d'ids achetés, voir profile.ownedAvatars)
 *     contient cet avatar.
 *   - "pixelart": `state.pixelart` (voir sommation.js: isPixelArtUnlocked). */
export function isAvatarUnlocked(avatar, state = {}) {
  switch (avatar.unlock?.type) {
    case "story":
      return (state.storyCompleted ?? 0) >= avatar.unlock.level;
    case "purchase":
      return !!state.owned?.has(avatar.id);
    case "pixelart":
      return !!state.pixelart;
    // Défi Quotidien: même bookkeeping "owned" que "purchase" (voir
    // profile.ownedAvatars — la monnaie dépensée n'a pas besoin d'être
    // distinguée une fois l'achat fait, voir main.js: refreshProfileAvatarPicker).
    case "star":
      return !!state.owned?.has(avatar.id);
    default:
      return true;
  }
}

/** Texte d'indice affiché sur un avatar verrouillé (voir main.js:
 * refreshProfileAvatarPicker) — décrit COMMENT le débloquer, jamais un
 * simple "verrouillé" muet. */
export function avatarUnlockLabel(avatar) {
  switch (avatar.unlock?.type) {
    case "story":
      return `Débloqué au niveau ${avatar.unlock.level} de l'Histoire`;
    case "purchase":
      // Retour utilisateur: "points" -> "Étoiles" (icône étoile bleue).
      return `S'achète ${avatar.unlock.cost} Étoiles`;
    case "pixelart":
      return "Débloqué à la 5e récompense de Remember";
    case "star":
      // Retour utilisateur: "étoiles" (Défi Quotidien) -> "Énergie" (icône
      // éclair jaune) — kind/unlock.type "star" reste inchangé en interne.
      return `S'achète ${avatar.unlock.cost} Énergie (Défi Quotidien)`;
    default:
      return "Verrouillé";
  }
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

/** Ajoute les champs calculés (likes/plays affichés, likedByMe) à une entrée
 * brute (seed ou Firestore) — TOUJOURS relu depuis localStorage à l'appel
 * plutôt que mis en cache, pour ne jamais afficher un like/une partie
 * périmé après une action juste avant. */
function decorate(entry, source, likedIds, plays) {
  const myPlays = plays[entry.id] || 0;
  return {
    ...entry,
    source, // "seed" (contenu fictif intégré) | "local" (publié/importé par vous) | "community" (par un autre joueur)
    likes: (entry.baseLikes ?? 0) + (likedIds.has(entry.id) ? 1 : 0),
    plays: (entry.basePlays ?? 0) + myPlays,
    likedByMe: likedIds.has(entry.id),
    myPlays,
  };
}

// ---------- Cache Firestore temps réel ----------
// `cloudLevels` est la copie locale, toujours à jour, de la collection
// Firestore `levels` — alimentée par onSnapshot (voir initCommunityCloud),
// jamais lue directement depuis Firestore ailleurs dans ce fichier. Ça
// permet à listLevels()/getLevel()/likedLevels() de rester SYNCHRONES (comme
// avant la migration Firestore), sans changer un seul appelant côté
// main.js/editor.js : ils continuent de lire un instantané en mémoire, qui
// se trouve maintenant être tenu à jour par le réseau plutôt que par
// localStorage.
let cloudLevels = [];
let myUid = null;
let started = false;
const changeListeners = new Set();

function notifyChange() {
  changeListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // Un listener cassé (erreur dans le code appelant) ne doit jamais
      // empêcher les autres d'être notifiés.
    }
  });
}

/** S'abonne aux mises à jour du fil communautaire (nouvelle grille publiée
 * par vous ou un autre joueur, uid anonyme résolu après coup...) — voir
 * main.js: ré-affiche l'écran Communauté/Mon profil s'il est actif quand un
 * changement arrive. Renvoie une fonction de désabonnement. */
export function onLevelsChanged(callback) {
  changeListeners.add(callback);
  return () => changeListeners.delete(callback);
}

/** Démarre l'écoute temps réel Firestore + l'authentification anonyme — à
 * appeler UNE fois au chargement de l'app (voir main.js, même principe que
 * ads.js: initAds()). Idempotent. Ne bloque jamais le reste du chargement
 * (pas de await ici) : tant que la première réponse Firestore n'est pas
 * arrivée (ou en cas d'erreur réseau/règles), listLevels() se contente de
 * renvoyer la seed, exactement comme si le fil communautaire "vrais
 * joueurs" était vide — jamais de plantage. */
export function initCommunityCloud() {
  if (started) return;
  started = true;

  firebaseReady().then((uid) => {
    myUid = uid;
    notifyChange(); // un uid qui arrive après coup change qui est "local" pour vous
  });

  onSnapshot(
    collection(db, LEVELS_COLLECTION),
    (snapshot) => {
      cloudLevels = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          ...data,
          id: d.id,
          // `serverTimestamp()` arrive en Firestore Timestamp — reconverti en
          // chaîne ISO ici pour que le reste du code (voir main.js: tri par
          // date via `new Date(level.createdAt)`) n'ait jamais à savoir que
          // la donnée vient de Firestore plutôt que de localStorage.
          createdAt: data.createdAt?.toDate?.().toISOString() ?? data.createdAt ?? new Date().toISOString(),
        };
      });
      notifyChange();
    },
    () => {
      // Hors ligne / règles refusées / etc.: on garde le dernier cache connu
      // plutôt que de le vider — mieux vaut un fil légèrement périmé qu'un
      // fil qui disparaît d'un coup pendant un creux réseau.
    }
  );
}

/** Tout le fil communautaire (grilles Firestore d'abord — les vôtres comme
 * celles des autres joueurs —, puis la seed), prêt à être filtré/trié/
 * affiché par l'appelant (voir main.js). */
export function listLevels() {
  const likedIds = loadLikedIds();
  const plays = loadPlays();
  const cloud = cloudLevels.map((l) =>
    decorate(l, l.ownerUid && l.ownerUid === myUid ? "local" : "community", likedIds, plays)
  );
  const seed = SEED_LEVELS.map((l) => decorate(l, "seed", likedIds, plays));
  return [...cloud, ...seed];
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
    // Retour utilisateur: "la popup pour le neurone couleur arrive au
    // niveau 4 alors que le neurone couleur arrive seulement au niveau 9" —
    // BUG CORRIGÉ: cette tokenisation ignorait la même règle que le VRAI
    // parseur du jeu (voir grid.js: LightUpGrid constructor) — une rangée
    // compacte SANS espace (un caractère = une case, ex "1..1") était quand
    // même passée à split(/\s+/), qui ne coupe rien faute d'espace et
    // renvoie la ligne ENTIÈRE comme un seul "token" (ex "1..1", longueur 4,
    // commence par un chiffre) — testé plus bas contre /^\d/ + length > 1,
    // exactement le motif d'une charge colorée ("2r") : "color" était donc
    // ajouté à tort dès qu'un niveau simple contenait une charge à 2
    // chiffres ou plus consécutifs, bien avant l'apparition réelle de la
    // couleur. Un niveau compact n'a jamais de token à 2 caractères, donc
    // aucune ambiguïté possible à séparer caractère par caractère.
    const tokens = Array.isArray(row)
      ? row
      : String(row).includes(" ")
      ? String(row).trim().split(/\s+/)
      : String(row).trim().split("");
    for (const token of tokens) {
      if (token === "0") found.add("forbidden");
      else if (token === "/" || token === "\\") found.add("mirror");
      else if (token === "Y") found.add("pyra");
      else if (token === "M") found.add("mirrorNeuron");
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

/** Écrit une nouvelle grille dans Firestore, partagée factorisée entre
 * publishLevel et importSharedLevel (même forme de document dans les deux
 * cas). Optimiste : la grille apparaît IMMÉDIATEMENT dans `cloudLevels` (id
 * provisoire "pending-..."), avant même la confirmation réseau — voir
 * en-tête du fichier: le fil ne doit jamais paraître figé le temps d'un
 * aller-retour Firestore. Dès que le snapshot temps réel confirme
 * l'écriture, le doc provisoire est remplacé par le vrai (id Firestore
 * définitif) au prochain rendu — il n'a jamais existé qu'en mémoire, donc
 * rien à nettoyer explicitement. En cas d'échec d'écriture (hors ligne,
 * règles Firestore...), la version optimiste est retirée plutôt que de
 * laisser croire qu'elle a été publiée pour de vrai. */
function publishToCloud(base) {
  const optimisticId = `pending-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const nowIso = new Date().toISOString();
  cloudLevels = [{ ...base, id: optimisticId, ownerUid: myUid, createdAt: nowIso }, ...cloudLevels];
  notifyChange();

  firebaseReady().then((uid) => {
    if (!uid) return; // pas de connexion Firebase dispo (hors ligne...): reste juste local/optimiste pour cette session
    addDoc(collection(db, LEVELS_COLLECTION), {
      ...base,
      ownerUid: uid,
      createdAt: serverTimestamp(),
    }).catch(() => {
      cloudLevels = cloudLevels.filter((l) => l.id !== optimisticId);
      notifyChange();
    });
  });

  return decorate({ ...base, id: optimisticId, ownerUid: myUid, createdAt: nowIso }, "local", loadLikedIds(), loadPlays());
}

/** Publie une grille (depuis l'éditeur, voir editor.js) — désormais visible
 * dans le fil communautaire de TOUS les joueurs (voir en-tête du fichier:
 * migration Firestore round 20). L'appelant doit avoir déjà validé la
 * grille via `validatePlayableLevel`. */
export function publishLevel({ title, rows, cols, cells, author, difficulty }) {
  return publishToCloud({
    title,
    author,
    rows,
    cols,
    cells,
    mechanics: detectMechanics(cells),
    difficulty: difficulty ?? null,
  });
}

/** Retire une grille que VOUS aviez publiée (voir écran "Mon profil", bouton
 * affiché seulement quand `source === "local"`, donc seulement sur vos
 * propres grilles) — sans effet sur une grille seed (contenu fictif intégré,
 * jamais éditable) ni sur celle d'un autre joueur (voir firestore.rules:
 * delete refusé si `ownerUid` ne correspond pas). Optimiste comme
 * publishToCloud : disparaît immédiatement de `cloudLevels`. */
export function unpublishLevel(id) {
  cloudLevels = cloudLevels.filter((l) => l.id !== id);
  notifyChange();
  if (id.startsWith("pending-")) return; // jamais écrit côté serveur (encore en vol) — rien à supprimer
  deleteDoc(doc(db, LEVELS_COLLECTION, id)).catch(() => {
    // Échec de suppression (hors ligne...) : le prochain snapshot temps réel
    // remettra de toute façon le doc dans cloudLevels s'il existe encore
    // vraiment côté serveur — pas besoin de le regérer manuellement ici.
  });
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
      author: author && typeof author.pseudo === "string" ? author : { pseudo: "Joueur", avatar: DEFAULT_AVATAR },
      rows,
      cols,
      cells,
      mechanics: Array.isArray(mechanics) ? mechanics : detectMechanics(cells),
      difficulty: Number.isInteger(difficulty) ? difficulty : check.difficulty,
    },
  };
}

/** Ajoute au fil communautaire (Firestore, voir publishToCloud) une grille
 * déjà décodée+validée par `decodeShareCode` — apparaît comme publiée par
 * VOUS (source "local"), au même titre qu'une publication depuis
 * l'éditeur. */
export function importSharedLevel(level) {
  return publishToCloud({
    title: level.title,
    author: level.author,
    rows: level.rows,
    cols: level.cols,
    cells: level.cells,
    mechanics: level.mechanics,
    difficulty: level.difficulty ?? null,
  });
}
