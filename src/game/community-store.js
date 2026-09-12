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
// Round suivant (retour utilisateur: "il faut connecter aussi les likes/
// parties jouées au firestore [...] je veux que toutes les grilles de
// communauté soient désormais requêtées et non une donnée en local") — trois
// changements structurants par rapport au round 20 :
//   1. `likes`/`plays` ne sont PLUS des compteurs locaux/fictifs : chaque
//      grille porte désormais un `likesCount`/`playsCount` RÉEL sur son
//      document Firestore (voir doDropOnObjective... pardon, voir
//      toggleLike/markPlayed ci-dessous), incrémenté/décrémenté pour de vrai
//      et visible par TOUS les joueurs. "Avez-vous aimé cette grille" reste
//      personnel : une collection dédiée `likes` (un document par like,
//      id déterministe `${levelId}_${uid}`) sert à la fois de dé-duplication
//      (impossible de liker deux fois) et de source pour `myLikedIds` (voir
//      plus bas), plutôt qu'un Set en localStorage.
//   2. Les 16 grilles "fictives" (auteurs inventés, voir l'ancien
//      community-seed.js) ne sont plus embarquées dans le bundle JS et
//      fusionnées à la volée — ce sont maintenant de VRAIS documents
//      Firestore (voir scripts/community-seed-data.json +
//      scripts/seed-firestore.mjs, à exécuter une fois pour peupler la base,
//      et réexécutable pour la réinitialiser). `listLevels()` ne lit donc
//      plus QUE `cloudLevels` — plus aucune fusion avec un tableau local.
//   3. Le pseudo/avatar/badge affiché comme auteur d'une grille déjà publiée
//      était figé au moment de la publication. Retour utilisateur: "si un
//      joueur change son pseudo, il faudra le changer aussi dans
//      l'affichage du pseudo du créateur d'une grille [...] on met à jour
//      les grilles publiées, c'est moins propre mais moins coûteux en
//      stockage/requêtes qu'une jointure" — voir syncAuthorToPublishedLevels
//      ci-dessous, appelée par main.js chaque fois que le profil change:
//      ré-écrit le champ `author` de CHAQUE grille déjà publiée par ce
//      joueur (pas de jointure à la lecture, juste une dénormalisation
//      réécrite au moment du changement, comme demandé).
import { LightUpGrid } from "./grid.js";
import { analyzeSolve } from "./solver.js";
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  updateDoc,
  increment,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { db, firebaseReady } from "./firebase-config.js";
import { t } from "./i18n.js";

const LEVELS_COLLECTION = "levels";
const LIKES_COLLECTION = "likes";

// Round "audit coûts serveur" (retour utilisateur: "j'aimerais que le
// serveur tienne bien") — trois réglages qui remplacent l'ancienne écoute
// onSnapshot() illimitée (voir refreshCommunityCloud ci-dessous):
//   - LEVELS_FETCH_LIMIT: le fil communautaire est désormais une PHOTO
//     bornée (getDocs, pas un flux temps réel) des N grilles les plus
//     récentes plutôt que TOUTE la collection — un compromis assumé: les
//     onglets de tri "plus aimées"/"plus jouées" (voir main.js:
//     renderCommunityFeed) ne trient que DANS cette fenêtre de 300, jamais
//     sur l'intégralité de la base. Largement suffisant vu le volume de
//     grilles publiées actuellement, à revoir si la Communauté grossit
//     beaucoup (passer à une vraie requête orderBy(likesCount) côté
//     serveur par onglet, avec son propre coût en lectures).
//   - REFRESH_MIN_INTERVAL_MS: un ré-affichage de l'écran Communauté (ex.
//     retour depuis une partie) ne redéclenche PAS systématiquement une
//     lecture réseau — seulement si la dernière date de plus de 15s, pour
//     qu'un joueur qui navigue vite entre les écrans ne multiplie pas les
//     lectures Firestore facturées pour rien.
//   - LIKE_DEBOUNCE_MS: voir toggleLike plus bas.
const LEVELS_FETCH_LIMIT = 300;
const REFRESH_MIN_INTERVAL_MS = 15000;
const LIKE_DEBOUNCE_MS = 800;

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
    // 4e avatar débloqué par la progression campagne (retour utilisateur:
    // "au niveau 40, ajouter un avatar à débloquer") — même schéma
    // unlock.type "story" que Charge/Synapse/Miroir ci-dessus, palier
    // suivant naturel (10/20/30/40). Nom et motif (rayons émis depuis un
    // point central) reprennent "impulsion", le terme du jeu pour désigner
    // une lumière posée (voir round "Terminologie: lumière→impulsion").
    id: "impulsion",
    label: "Impulsion",
    unlock: { type: "story", level: 40 },
    svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="14" fill="#fff2b8"/><line x1="50" y1="8" x2="50" y2="28" stroke="#ffd23f" stroke-width="7" stroke-linecap="round"/><line x1="50" y1="72" x2="50" y2="92" stroke="#ffd23f" stroke-width="7" stroke-linecap="round"/><line x1="8" y1="50" x2="28" y2="50" stroke="#ffd23f" stroke-width="7" stroke-linecap="round"/><line x1="72" y1="50" x2="92" y2="50" stroke="#ffd23f" stroke-width="7" stroke-linecap="round"/></svg>',
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
      return t("avatarUnlockStory", { level: avatar.unlock.level });
    case "purchase":
      // Retour utilisateur: "points" -> "Étoiles" (icône étoile bleue).
      return t("avatarUnlockPurchase", { cost: avatar.unlock.cost });
    case "pixelart":
      return t("avatarUnlockPixelart");
    case "star":
      // Retour utilisateur: "étoiles" (Défi Quotidien) -> "Énergie" (icône
      // éclair jaune) — kind/unlock.type "star" reste inchangé en interne.
      return t("avatarUnlockStar", { cost: avatar.unlock.cost });
    default:
      return t("avatarUnlockDefault");
  }
}

/** Id déterministe d'un document `likes` — double emploi voulu: sert de clé
 * primaire (Firestore rejette une création si le doc existe déjà, donc pas
 * besoin de vérifier "ai-je déjà liké ?" avant d'écrire) ET encode
 * directement (levelId, uid) sans avoir à les stocker deux fois. */
function likeDocId(levelId, uid) {
  return `${levelId}_${uid}`;
}

/** Ajoute les champs calculés (likes/plays réellement affichés, likedByMe) à
 * une entrée brute Firestore — `likesCount`/`playsCount` sont maintenant de
 * vrais compteurs partagés (voir toggleLike/markPlayed), `myLikedIds` un Set
 * tenu à jour par un fetch borné+paresseux de la collection `likes` filtrée
 * sur VOTRE uid (voir refreshCommunityCloud), jamais du localStorage. */
function decorate(entry, source) {
  return {
    ...entry,
    source, // "local" (publié/importé par vous) | "community" (par un autre joueur, ou par un profil seed)
    likes: entry.likesCount ?? 0,
    plays: entry.playsCount ?? 0,
    likedByMe: myLikedIds.has(entry.id),
  };
}

// ---------- Cache Firestore (fetch borné + paresseux) ----------
// `cloudLevels` est la copie locale de la collection Firestore `levels`,
// alimentée par un getDocs() ponctuel et borné (voir refreshCommunityCloud
// ci-dessous) plutôt qu'un onSnapshot() temps réel — jamais lue directement
// depuis Firestore ailleurs dans ce fichier. Ça permet à
// listLevels()/getLevel()/likedLevels() de rester SYNCHRONES (comme avant la
// migration Firestore), sans changer un seul appelant côté main.js/editor.js:
// ils continuent de lire un instantané en mémoire, seulement rafraîchi de
// temps en temps plutôt qu'en continu (voir en-tête de fichier: retour
// utilisateur "j'aimerais que le serveur tienne bien" — un onSnapshot()
// ouvert sans condition pour CHAQUE joueur, sur TOUTE la collection, aussi
// longtemps que l'app reste ouverte, facture une lecture par document par
// écriture d'un AUTRE joueur pendant ce temps: le coût grandit avec
// (joueurs simultanés × écritures globales), sans plafond. Un fetch borné,
// déclenché seulement à l'entrée sur l'écran Communauté et espacé par
// REFRESH_MIN_INTERVAL_MS, retombe à un coût proportionnel aux VISITES.
let cloudLevels = [];
// Vos propres likes — rafraîchi par la même fonction (un 2e getDocs, filtré
// sur votre uid), seulement une fois `myUid` connu. Un Set de levelId,
// jamais persisté nulle part côté client: la collection `likes` EST la
// source de vérité, ce Set n'en est qu'un cache mémoire pratique pour que
// decorate()/toggleLike() restent synchrones.
let myLikedIds = new Set();
let myUid = null;
let started = false;
let lastFetchAt = 0;
let inFlightFetch = null;
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
 * par vous ou un autre joueur, uid anonyme résolu après coup, retour d'un
 * refreshCommunityCloud()...) — voir main.js: ré-affiche l'écran
 * Communauté/Mon profil s'il est actif quand un changement arrive. Renvoie
 * une fonction de désabonnement. */
export function onLevelsChanged(callback) {
  changeListeners.add(callback);
  return () => changeListeners.delete(callback);
}

/** Rafraîchit le fil communautaire depuis Firestore — fetch PONCTUEL et
 * BORNÉ (getDocs, pas onSnapshot), à appeler à chaque entrée sur l'écran
 * Communauté/Mon profil (voir main.js: showView) plutôt qu'une seule fois au
 * chargement de l'app. Deux protections anti-spam:
 *   1. Paresseux: ne démarre plus automatiquement au boot (voir main.js,
 *      ancien appel à initCommunityCloud() retiré) — un joueur qui ne visite
 *      jamais la Communauté ne déclenche plus aucune lecture Firestore.
 *   2. Throttle: un appel qui arrive moins de REFRESH_MIN_INTERVAL_MS après
 *      le précédent est un no-op silencieux (sauf `force`), pour qu'un
 *      aller-retour rapide entre écrans ne reparte pas en réseau à chaque
 *      fois. Les appels concurrents pendant qu'un fetch est déjà en cours
 *      partagent la même promesse plutôt que d'en déclencher un 2e.
 * Ne bloque jamais l'appelant (best-effort, comme le reste du module): en
 * cas d'échec réseau/règles, on garde le dernier cache connu plutôt que de
 * le vider — mieux vaut un fil légèrement périmé qu'un fil qui disparaît
 * d'un coup pendant un creux réseau. */
export function refreshCommunityCloud({ force = false } = {}) {
  if (!force && Date.now() - lastFetchAt < REFRESH_MIN_INTERVAL_MS) return inFlightFetch ?? Promise.resolve();
  if (inFlightFetch) return inFlightFetch;

  started = true;
  inFlightFetch = firebaseReady()
    .then(async (uid) => {
      myUid = uid;
      notifyChange(); // un uid qui arrive après coup change qui est "local" pour vous

      const levelsQuery = query(collection(db, LEVELS_COLLECTION), orderBy("createdAt", "desc"), limit(LEVELS_FETCH_LIMIT));
      const likesQuery = uid ? query(collection(db, LIKES_COLLECTION), where("uid", "==", uid)) : null;

      const [levelsSnap, likesSnap] = await Promise.all([
        getDocs(levelsQuery).catch(() => null),
        likesQuery ? getDocs(likesQuery).catch(() => null) : Promise.resolve(null),
      ]);

      if (levelsSnap) {
        cloudLevels = levelsSnap.docs.map((d) => {
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
      }
      // hors ligne/échec d'auth: pas de requête filtrée possible, myLikedIds
      // reste tel quel (honnête plutôt que vidé pour rien)
      if (uid && likesSnap) {
        myLikedIds = new Set(likesSnap.docs.map((d) => d.data().levelId));
      }

      lastFetchAt = Date.now();
      notifyChange();
    })
    .finally(() => {
      inFlightFetch = null;
    });

  return inFlightFetch;
}

/** Tout le fil communautaire — SEULEMENT Firestore (voir en-tête de fichier:
 * les 16 grilles "fictives" sont désormais de vrais documents, injectés une
 * fois pour toutes par scripts/seed-firestore.mjs, jamais fusionnés ici à la
 * volée) —, prêt à être filtré/trié/affiché par l'appelant (voir main.js). */
export function listLevels() {
  return cloudLevels.map((l) => decorate(l, l.ownerUid && l.ownerUid === myUid ? "local" : "community"));
}

export function getLevel(id) {
  return listLevels().find((l) => l.id === id) || null;
}

/** Grilles que vous avez likées — pour l'écran "Mon profil". */
export function likedLevels() {
  return listLevels().filter((l) => l.likedByMe);
}

// Minuteurs de debounce en cours, un par grille (id -> timeoutId) — voir
// toggleLike ci-dessous. Un Map plutôt qu'une seule variable: rien n'empêche
// de liker une grille PUIS une autre coup sur coup, chacune doit avoir son
// propre délai indépendant.
const likeDebounceTimers = new Map();
// État "avant la rafale" (id -> liked au moment du TOUT PREMIER tap non
// encore envoyé), utilisé pour détecter un effet net nul sur toute une
// rafale de taps (pas seulement le dernier tap) — voir toggleLike.
const likeBurstAnchor = new Map();

/** Bascule votre like sur une grille — SAUF sur une grille dont VOUS êtes
 * l'auteur (retour utilisateur: "on ne doit pas pouvoir liker sa propre
 * grille publiée dans communauté"), où c'est un no-op. Optimiste (même
 * philosophie que publishToCloud/unpublishLevel plus bas): `myLikedIds` et
 * le `likesCount` en cache sont mis à jour IMMÉDIATEMENT à CHAQUE tap, avant
 * même la confirmation réseau, pour que le cœur réagisse sans attendre.
 *
 * L'écriture Firestore réelle, elle, est DEBOUNCÉE (retour utilisateur: "go
 * faire [...] le débounce du like") — un joueur qui tape plusieurs fois de
 * suite sur le même cœur (double-tap accidentel, hésitation like/unlike)
 * n'envoie qu'UNE seule écriture réseau, LIKE_DEBOUNCE_MS après le DERNIER
 * tap, reflétant l'état net final. Si la rafale de taps revient à l'état de
 * départ (like puis unlike avant l'écriture), l'écriture est annulée
 * purement et simplement: aucun round-trip réseau pour un effet net nul.
 * Les deux écritures liées (doc `likes` + compteur sur `levels`) restent
 * regroupées dans un seul writeBatch() (retour utilisateur: "ces deux
 * requêtes seront toujours liées"). Ne renvoie rien: aucun appelant (voir
 * main.js) n'utilisait la valeur de retour, chacun ré-affiche depuis
 * getLevel()/listLevels() juste après. */
export function toggleLike(id) {
  const level = getLevel(id);
  if (!level || (level.ownerUid && level.ownerUid === myUid)) return;
  const wasLiked = myLikedIds.has(id);
  if (wasLiked) myLikedIds.delete(id);
  else myLikedIds.add(id);
  cloudLevels = cloudLevels.map((l) => (l.id === id ? { ...l, likesCount: (l.likesCount ?? 0) + (wasLiked ? -1 : 1) } : l));
  notifyChange();

  // Annule tout envoi déjà programmé pour CETTE grille: seul le dernier tap
  // de la rafale déclenchera une écriture, LIKE_DEBOUNCE_MS plus tard. Le
  // tout premier tap d'une rafale (pas de timer en cours) fixe l'ancre:
  // l'état d'avant rafale auquel comparer le résultat final.
  const pending = likeDebounceTimers.get(id);
  if (pending) clearTimeout(pending);
  else likeBurstAnchor.set(id, wasLiked);

  likeDebounceTimers.set(
    id,
    setTimeout(() => {
      likeDebounceTimers.delete(id);
      const likedBeforeBurst = likeBurstAnchor.get(id) ?? wasLiked;
      likeBurstAnchor.delete(id);
      // État net à envoyer: ce que myLikedIds contient MAINTENANT (après
      // toute la rafale), comparé à ce qu'il contenait avant le TOUT PREMIER
      // tap de la rafale (l'ancre) — une rafale like→unlike→like→unlike doit
      // être détectée comme nette nulle même si elle compte plus de 2 taps.
      const likedNow = myLikedIds.has(id);
      if (likedNow === likedBeforeBurst) return; // rafale nette nulle: rien à écrire

      firebaseReady().then((uid) => {
        if (!uid) return; // hors ligne: reste purement optimiste pour cette session
        const ref = doc(db, LIKES_COLLECTION, likeDocId(id, uid));
        const levelRef = doc(db, LEVELS_COLLECTION, id);
        const batch = writeBatch(db);
        if (likedNow) {
          batch.set(ref, { levelId: id, uid, createdAt: serverTimestamp() });
          batch.update(levelRef, { likesCount: increment(1) });
        } else {
          batch.delete(ref);
          batch.update(levelRef, { likesCount: increment(-1) });
        }
        batch.commit().catch(() => {});
      });
    }, LIKE_DEBOUNCE_MS)
  );
}

/** Incrémente le compteur de parties RÉEL (partagé, visible par tous) de
 * cette grille — appelé à la résolution d'un niveau communautaire (voir
 * main.js: mode "community"). Optimiste comme toggleLike ci-dessus. */
export function markPlayed(id) {
  cloudLevels = cloudLevels.map((l) => (l.id === id ? { ...l, playsCount: (l.playsCount ?? 0) + 1 } : l));
  notifyChange();
  updateDoc(doc(db, LEVELS_COLLECTION, id), { playsCount: increment(1) }).catch(() => {
    // Échec (hors ligne, doc pas encore confirmé côté serveur pour une
    // publication toute fraîche...): le compteur local reste optimiste pour
    // cette session, le prochain snapshot réel fera foi.
  });
}

/** Retour utilisateur: "si un joueur change son pseudo, il faudra le
 * changer aussi dans l'affichage du pseudo du créateur d'une grille dans
 * communauté [...] on met à jour les grilles publiées, c'est moins propre
 * mais moins coûteux en stockage/requêtes" — ré-écrit `author` sur CHAQUE
 * grille déjà publiée par ce joueur (`ownerUid === myUid`), en un seul
 * batch. Appelée par main.js chaque fois que pseudo/avatar/badge change
 * (voir updateProfileAndSyncAuthor) — jamais automatiquement ici, ce module
 * ne sait rien du profil, seulement de la forme de `author` qu'on lui donne. */
export async function syncAuthorToPublishedLevels(author) {
  const uid = await firebaseReady();
  if (!uid) return; // hors ligne: rien à synchroniser pour l'instant, un prochain appel (ex: au retour en ligne) rattrapera
  const snapshot = await getDocs(query(collection(db, LEVELS_COLLECTION), where("ownerUid", "==", uid)));
  if (snapshot.empty) return;
  const batch = writeBatch(db);
  snapshot.docs.forEach((d) => batch.update(d.ref, { author }));
  await batch.commit().catch(() => {
    // Best-effort: un échec réseau laisse simplement les grilles avec
    // l'ancien auteur jusqu'au prochain changement de profil ou prochain
    // appel explicite — jamais bloquant pour le joueur.
  });
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
  // Nommée titleNorm (pas `t`) pour ne pas masquer le t() d'i18n importé
  // plus haut dans ce fichier, même si cette fonction ne l'appelle pas.
  const titleNorm = (title || "").trim().toLowerCase();
  const a = (authorPseudo || "").trim().toLowerCase();
  if (!titleNorm) return false;
  return listLevels().some(
    (l) => (l.title || "").trim().toLowerCase() === titleNorm && (l.author?.pseudo || "").trim().toLowerCase() === a
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
  // likesCount/playsCount à 0 dès la création: toggleLike/markPlayed font des
  // increment() Firestore, qui ont besoin d'un champ numérique existant pour
  // ne jamais reposer indéfiniment sur le fallback `?? 0` de decorate().
  const docBase = { ...base, likesCount: 0, playsCount: 0 };
  cloudLevels = [{ ...docBase, id: optimisticId, ownerUid: myUid, createdAt: nowIso }, ...cloudLevels];
  notifyChange();

  firebaseReady().then((uid) => {
    if (!uid) return; // pas de connexion Firebase dispo (hors ligne...): reste juste local/optimiste pour cette session
    addDoc(collection(db, LEVELS_COLLECTION), {
      ...docBase,
      ownerUid: uid,
      createdAt: serverTimestamp(),
    }).catch(() => {
      cloudLevels = cloudLevels.filter((l) => l.id !== optimisticId);
      notifyChange();
    });
  });

  return decorate({ ...docBase, id: optimisticId, ownerUid: myUid, createdAt: nowIso }, "local");
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

