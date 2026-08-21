// Musique par calques (voir music-demos/couches/notes-couches.md pour la
// conception d'origine): une piste de fond ("base"), plus une piste par
// mécanique qu'on démute la première fois qu'elle s'active dans le niveau en
// cours (neurone/neurone de couleur/miroir/neurone miroir/prisme), plus une
// piste d'échec. Tant qu'une synapse est rompue ou qu'un neurone est en
// surcharge, TOUT se coupe (base comprise) et seule échec.wav joue — elle
// est conçue pour tenir seule (nappe grave + tritone en dessous de
// l'alarme), pas comme une couche de plus par-dessus la base.
//
// Toutes les pistes sont des fichiers WAV bouclables SANS perte (voir
// public/music/ — durée exacte 24.000000s à 44.1kHz, aucun padding
// d'encodeur contrairement à un mp3/ogg compressé, ce qui garantirait un
// clic au raccord de boucle) démarrées TOUTES EN MÊME TEMPS dès le premier
// clic (voir startMusic) puis JAMAIS arrêtées/redémarrées ensuite — on ne
// fait que faire monter/descendre leur gain individuel. C'est ce qui
// garantit qu'elles restent en phase indéfiniment (aucune dérive possible:
// chaque `Tone.Player` boucle sur son propre buffer via le même
// AudioContext, sans dépendre de `Tone.Transport`).
import * as Tone from "tone";

// Gamme utilisée par TOUTES les couches mélodiques (voir
// music-demos/couches: neurone-couleur.wav, prismes.wav) — exportée comme
// référence de tonalité pour toute synthèse/extension future de ces
// couches. sound.js ne s'en sert plus pour la note de pose (voir
// `nextPlacementNote`, qui cite directement la mélodie de neurone-couleur.wav
// plutôt qu'un tirage dans cette gamme).
export const MUSIC_SCALE = ["A3", "C4", "D4", "E4", "G4"];

const LAYER_URLS = {
  base: "/music/base.wav",
  neurone: "/music/neurone.wav",
  neuroneLayer2: "/music/neurone-layer2.wav",
  neuroneCouleur: "/music/neurone-couleur.wav",
  neuroneCouleurLayer2: "/music/neurone-couleur-layer2.wav",
  miroirs: "/music/miroirs.wav",
  miroirsLayer2: "/music/miroirs-layer2.wav",
  neuronesMiroirs: "/music/neurones-miroirs.wav",
  prismes: "/music/prismes.wav",
  pyra: "/music/pyra.wav",
  echec: "/music/echec.wav",
};

// Couches "mécanique" au sens de resetLayers/setLayerActive — n'inclut ni
// "base" (toujours à 1, jamais dans `unlocked`) ni "echec" (gérée à part,
// voir enterFailure/exitFailure). Les "layer2" sont des couches
// SUPPLÉMENTAIRES qui s'ajoutent par-dessus la couche 1 correspondante à
// partir d'un certain compte (voir MECHANIC_THRESHOLDS) — jamais un
// remplacement, les deux jouent en même temps une fois débloquées.
const MECHANIC_LAYERS = [
  "neurone",
  "neuroneLayer2",
  "neuroneCouleur",
  "neuroneCouleurLayer2",
  "miroirs",
  "miroirsLayer2",
  "neuronesMiroirs",
  "prismes",
  "pyra",
];

// Palier (compte d'éléments actuellement actifs, voir render.js:
// `mechanicCounts`) à partir duquel chaque couche doit être DÉBLOQUÉE — et,
// tout aussi important, RE-VERROUILLÉE si le compte redescend en dessous
// (retour utilisateur: "si on retire les conditions d'unmute, on remute").
// Clé du compte correspondant dans l'objet reçu par `applyMechanicCounts`.
const MECHANIC_THRESHOLDS = {
  neurone: { count: "chargeFull", min: 1 },
  neuroneLayer2: { count: "chargeFull", min: 3 },
  neuroneCouleur: { count: "chargeFullColored", min: 1 },
  neuroneCouleurLayer2: { count: "chargeFullColored", min: 2 },
  miroirs: { count: "mirrorActive", min: 1 },
  miroirsLayer2: { count: "mirrorActive", min: 2 },
  neuronesMiroirs: { count: "neuronesMiroirsActive", min: 1 },
  prismes: { count: "prismActive", min: 1 },
  pyra: { count: "pyraActive", min: 1 },
};

// Gain cible (au lieu de 1) quand une couche est débloquée — seule
// "neurone" est montée de 10% (retour utilisateur), toutes les autres
// restent à 1 (aucun effet, valeur par défaut ci-dessous).
const LAYER_ACTIVE_GAIN = { neurone: 1.1 };

const FADE = 0.35; // secondes, montée/descente de gain par calque — évite tout clic

// Fondu utilisé spécifiquement pour l'apparition/disparition d'une couche
// MÉCANIQUE (setLayerActive, palier franchi/défranchi en cours de partie —
// retour utilisateur: le fondu de 0.35s ci-dessus donnait une impression de
// bascule "brutale" pour ce cas précis). Volontairement PAS utilisé pour
// l'état d'échec (enterFailure/exitFailure) ni resetLayers: la musique
// d'erreur doit au contraire apparaître/disparaître de façon nette et
// immédiate — c'est le signal d'alarme, il doit rester FADE (0.35s).
const LAYER_FADE = 1.1;

const musicBus = new Tone.Volume(0).toDestination();

/** Volume musique (0 à 1, linéaire) — bus SÉPARÉ de setMasterVolume dans
 * sound.js (qui reste le volume des effets de jeu: pose/retrait/victoire/
 * cibles/synapses/charges). Les deux curseurs sont donc indépendants. */
export function setMusicVolume(level) {
  const clamped = Math.max(0, Math.min(1, level));
  musicBus.volume.value = clamped <= 0 ? -Infinity : Tone.gainToDb(clamped);
}

let players = null; // { key -> Tone.Player }
let gains = null; // { key -> Tone.Gain }
let unlocked = new Set(); // sous-ensemble courant de MECHANIC_LAYERS démuté
let failureCount = 0; // compteur (pas booléen): plusieurs synapses/surcharges possibles à la fois
let started = false;
let loadPromise = null;

function ensureBuilt() {
  if (players) return;
  players = {};
  gains = {};
  for (const key of Object.keys(LAYER_URLS)) {
    const gain = new Tone.Gain(key === "base" ? 1 : 0).connect(musicBus);
    const player = new Tone.Player({ url: LAYER_URLS[key], loop: true }).connect(gain);
    players[key] = player;
    gains[key] = gain;
  }
}

/** Précharge les 7 pistes (idempotent, peut être appelé tôt — ex. au
 * chargement de la page — pour que `startMusic` n'ait plus qu'à démarrer la
 * lecture sans latence de réseau au premier clic). Ne démarre rien tant que
 * `startMusic` n'a pas été appelée. */
export function preloadMusic() {
  ensureBuilt();
  if (!loadPromise) loadPromise = Tone.loaded();
  return loadPromise;
}

/** Démarre la lecture des 7 pistes, parfaitement synchronisées (même
 * timestamp de départ pour toutes) — à appeler une seule fois, depuis un
 * geste utilisateur (voir `ensureStarted` dans sound.js: Tone.js exige un
 * clic avant de pouvoir jouer du son). Sans effet si déjà démarrée. */
export async function startMusic() {
  if (started) return;
  await preloadMusic();
  started = true;
  const when = Tone.now() + 0.05; // léger différé: laisse le temps au scheduler de tout aligner
  for (const player of Object.values(players)) player.start(when);
}

/** À appeler au chargement d'un nouveau niveau: remet toutes les couches
 * mécaniques et la couche échec au silence (la base continue de jouer sans
 * interruption) — le déblocage reflète la progression du niveau EN COURS,
 * pas un cumul entre niveaux. Ne touche pas à la lecture elle-même (aucun
 * redémarrage, donc aucun risque de désynchronisation). */
export function resetLayers() {
  unlocked = new Set();
  failureCount = 0;
  if (!gains) return;
  gains.base.gain.rampTo(1, FADE); // garde-fou: au cas où un niveau se termine en pleine erreur
  for (const key of MECHANIC_LAYERS) gains[key].gain.rampTo(0, FADE);
  gains.echec.gain.rampTo(0, FADE);
}

/** Démute OU remute une couche mécanique selon `active` (no-op si déjà dans
 * cet état — évite de relancer une rampe déjà en cours à chaque frame,
 * `applyMechanicCounts` ci-dessous appelle cette fonction en continu). Si
 * une erreur est en cours (voir enterFailure), `unlocked` est quand même
 * tenu à jour mais le gain ne bouge pas avant la résolution de l'erreur
 * (voir exitFailure) — cohérent avec "couper toutes les pistes sauf la
 * base" pendant une erreur. */
function setLayerActive(key, active) {
  if (!MECHANIC_LAYERS.includes(key)) return;
  const wasActive = unlocked.has(key);
  if (wasActive === active) return;
  if (active) unlocked.add(key);
  else unlocked.delete(key);
  if (!gains || failureCount > 0) return;
  gains[key].gain.rampTo(active ? (LAYER_ACTIVE_GAIN[key] ?? 1) : 0, LAYER_FADE);
}

/** Point d'entrée unique pour la musique par calques côté logique de jeu —
 * voir render.js: `mechanicCounts`, appelé une fois par frame avec l'état
 * COURANT (pas un événement ponctuel). Chaque couche de MECHANIC_THRESHOLDS
 * est comparée à son palier et démutée/remutée en conséquence : une couche
 * peut donc aussi bien apparaître que disparaître si le compte redescend
 * (retour utilisateur — un palier qui peut se franchir doit pouvoir se
 * défranchir). */
export function applyMechanicCounts(counts) {
  for (const [key, { count, min }] of Object.entries(MECHANIC_THRESHOLDS)) {
    setLayerActive(key, (counts[count] || 0) >= min);
  }
}

/** Synapse rompue ou neurone en surcharge: coupe TOUT (y compris la base —
 * échec.wav est conçue pour tenir seule, voir music-demos/couches/notes-
 * couches.md) et joue la piste d'échec en boucle. Un compteur (pas un
 * booléen) car plusieurs erreurs peuvent être actives en même temps — seule
 * la PREMIÈRE fait vraiment quelque chose. */
export function enterFailure() {
  failureCount++;
  if (failureCount !== 1 || !gains) return;
  gains.base.gain.rampTo(0, FADE);
  for (const key of unlocked) gains[key].gain.rampTo(0, FADE);
  gains.echec.gain.rampTo(1, FADE);
}

/** Vrai tant qu'au moins une synapse est rompue ou qu'un neurone est en
 * surcharge (voir enterFailure/exitFailure) — consommé par sound.js pour
 * assombrir le son de pose pendant que la musique d'échec joue, sans que
 * sound.js ait besoin de dupliquer sa propre logique de comptage. */
export function isFailureActive() {
  return failureCount > 0;
}

/** Résolution d'UNE erreur — restaure l'état normal (base + couches
 * débloquées) seulement si c'était la DERNIÈRE erreur encore active. */
export function exitFailure() {
  if (failureCount === 0) return; // garde-fou défensif
  failureCount--;
  if (failureCount !== 0 || !gains) return;
  gains.echec.gain.rampTo(0, FADE);
  gains.base.gain.rampTo(1, FADE);
  for (const key of unlocked) gains[key].gain.rampTo(LAYER_ACTIVE_GAIN[key] ?? 1, FADE);
}
