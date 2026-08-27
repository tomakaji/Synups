// Musique par calques (voir music-demos/couches/notes-couches.md pour la
// conception d'origine): une piste de fond ("base"), plus une piste par
// mécanique qu'on démute la première fois qu'elle s'active dans le niveau en
// cours (neurone/neurone de couleur/miroir/neurone miroir/prisme), plus une
// piste d'échec. Tant qu'une synapse est rompue ou qu'un neurone est en
// surcharge, base + couches débloquées ne sont plus COUPÉES mais ÉTOUFFÉES
// (voir `duckFilter`/FAILURE_MUFFLE_GAIN ci-dessous — retour utilisateur:
// "plutôt que de couper la musique qui se joue actuellement, l'étouffer pour
// qu'elle paraisse loin") pendant qu'échec.wav (non filtrée, voir
// `ensureBuilt`) monte par-dessus — elle est conçue pour dominer largement
// ce fond assourdi, pas pour jouer seule dans un silence complet.
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
import { isPixelTheme } from "./pixelIcons.js";

// Gamme utilisée par TOUTES les couches mélodiques (voir
// music-demos/couches: neurone-couleur.wav, prismes.wav) — exportée comme
// référence de tonalité pour toute synthèse/extension future de ces
// couches. sound.js ne s'en sert plus pour la note de pose (voir
// `nextPlacementNote`, qui cite directement la mélodie de neurone-couleur.wav
// plutôt qu'un tirage dans cette gamme).
export const MUSIC_SCALE = ["A3", "C4", "D4", "E4", "G4"];

// Round 13 (thème PixelArt, 6e volet — musique): les mêmes 11 pistes
// existent en DEUX versions — le rendu "lisse" d'origine (public/music/) et
// une réorchestration chiptune/Game Boy (public/music-chip/, voir
// tools/chiptune/ pour le synthétiseur qui les a générées) qui reprend les
// mêmes thèmes/tonalité (même gamme MUSIC_SCALE, même mouvement d'accords
// Am->C->Am sur base.wav) mais en timbres pulse/triangle/bruit LFSR plutôt
// qu'en instruments "lisses". `currentLayerUrls()` choisit le bon jeu selon
// le thème actif au moment de la construction/rechargement des lecteurs —
// voir refreshMusicTheme() plus bas pour le cas où le thème change EN COURS
// DE LECTURE (bouton Options, voir main.js: btnPixelartToggle.onclick).
const LAYER_URLS_SMOOTH = {
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

const LAYER_URLS_CHIP = {
  base: "/music-chip/base.wav",
  neurone: "/music-chip/neurone.wav",
  neuroneLayer2: "/music-chip/neurone-layer2.wav",
  neuroneCouleur: "/music-chip/neurone-couleur.wav",
  neuroneCouleurLayer2: "/music-chip/neurone-couleur-layer2.wav",
  miroirs: "/music-chip/miroirs.wav",
  miroirsLayer2: "/music-chip/miroirs-layer2.wav",
  neuronesMiroirs: "/music-chip/neurones-miroirs.wav",
  prismes: "/music-chip/prismes.wav",
  pyra: "/music-chip/pyra.wav",
  echec: "/music-chip/echec.wav",
};

function currentLayerUrls() {
  return isPixelTheme() ? LAYER_URLS_CHIP : LAYER_URLS_SMOOTH;
}

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

// Retour utilisateur : "plutôt que de couper la musique qui se joue
// actuellement, l'étouffer pour qu'elle paraisse loin" — au lieu de ramener
// le gain de base/des couches débloquées à 0 pendant une erreur, on les
// ramène à ce niveau réduit (jamais silencieux) ET on les fait passer par
// `duckFilter` (passe-bas partagé, voir ci-dessous), qui simule
// l'éloignement/l'étouffement plutôt qu'une coupure nette. Valeurs choisies
// par écoute sur les démos ("wobble prononcé") validées par l'utilisateur.
const FAILURE_MUFFLE_GAIN = 0.4;
const FAILURE_MUFFLE_CUTOFF_HZ = 420;
const NORMAL_CUTOFF_HZ = 20000; // au-delà du spectre audible: filtre inactif en pratique

const musicBus = new Tone.Volume(0).toDestination();

// Passe-bas PARTAGÉ pour base + couches mécaniques uniquement — échec.wav
// (voir ensureBuilt) NE PASSE PAS par ce filtre: elle doit rester pleinement
// claire/nette pendant que le reste s'étouffe derrière elle. Cutoff au repos
// à NORMAL_CUTOFF_HZ (inaudible, filtre neutre) — voir enterFailure/
// exitFailure pour la rampe vers/depuis FAILURE_MUFFLE_CUTOFF_HZ.
const duckFilter = new Tone.Filter(NORMAL_CUTOFF_HZ, "lowpass").connect(musicBus);

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

// Ambiance (boutique "Secrets", voir storage.js/main.js): un socle de
// couches TOUJOURS démutées, par-dessus lesquelles les déblocages normaux du
// niveau en cours (unlocked, ci-dessus) continuent de s'ajouter comme avant.
// Réutilise les couches mécaniques déjà composées plutôt que de nouveaux
// morceaux dédiés — une vraie composition originale par ambiance serait un
// chantier audio à part entière (voir l'historique de base.wav/echec.wav...,
// plusieurs jours d'itération). Défini ici (pas juste dans MECHANIC_LAYERS)
// pour que `setLayerActive` sache ne JAMAIS re-couper une couche d'ambiance
// au gré des déblocages/déverrouillages du niveau — c'est un socle permanent
// pour la session, pas un événement de jeu.
export const MUSIC_AMBIANCES = {
  "signal-clair": { label: "Signal clair", layers: [] }, // par défaut: comportement inchangé
  "echo-profond": { label: "Écho profond", layers: ["neuroneCouleur"] },
  "reseau-eveille": { label: "Réseau éveillé", layers: ["miroirs", "prismes"] },
};

let ambianceLayers = new Set();

/** Change le socle de couches toujours actives (voir MUSIC_AMBIANCES) — sans
 * effet sur les couches actuellement débloquées par le niveau en cours tant
 * que resetLayers() n'a pas tourné (prochain niveau/chargement), pour ne
 * jamais couper une couche EN PLEIN NIVEAU juste parce que le joueur change
 * d'ambiance dans Options entre deux niveaux. */
export function setMusicAmbiance(key) {
  ambianceLayers = new Set(MUSIC_AMBIANCES[key]?.layers ?? []);
}

function ensureBuilt() {
  if (players) return;
  players = {};
  gains = {};
  const urls = currentLayerUrls();
  for (const key of Object.keys(urls)) {
    // échec.wav se branche directement sur musicBus (jamais étouffée, voir
    // duckFilter ci-dessus) — base + toutes les couches mécaniques passent
    // par le passe-bas partagé, neutre hors état d'échec.
    const gain = new Tone.Gain(key === "base" ? 1 : 0).connect(key === "echec" ? musicBus : duckFilter);
    const player = new Tone.Player({ url: urls[key], loop: true }).connect(gain);
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

/** Recharge les 11 pistes sur le jeu d'URLs correspondant au thème ACTUEL
 * (voir currentLayerUrls) — à appeler quand le thème PixelArt est
 * togglé en cours de session (voir main.js: btnPixelartToggle.onclick),
 * puisque `ensureBuilt` ci-dessus n'est exécutée qu'une seule fois et ne
 * relit donc jamais le thème après coup. Sans effet si la musique n'a
 * jamais été construite (le prochain `ensureBuilt` prendra le bon thème
 * directement, rien à rattraper). Les gains (couches débloquées, ambiance,
 * état d'échec) sont préservés tels quels — seul le CONTENU audio change,
 * pas le mix en cours. */
export async function refreshMusicTheme() {
  if (!players) return;
  const urls = currentLayerUrls();
  const wasStarted = started;
  if (wasStarted) {
    for (const player of Object.values(players)) player.stop();
  }
  await Promise.all(Object.keys(urls).map((key) => players[key].load(urls[key])));
  if (wasStarted) {
    const when = Tone.now() + 0.05;
    for (const player of Object.values(players)) player.start(when);
  }
}

/** À appeler au chargement d'un nouveau niveau: remet toutes les couches
 * mécaniques et la couche échec au silence (la base continue de jouer sans
 * interruption) — le déblocage reflète la progression du niveau EN COURS,
 * pas un cumul entre niveaux. Ne touche pas à la lecture elle-même (aucun
 * redémarrage, donc aucun risque de désynchronisation). */
export function resetLayers() {
  // Voir MUSIC_AMBIANCES: le socle d'ambiance (boutique Secrets) reste
  // démuté même au reset — seules les couches HORS ambiance retombent à 0.
  unlocked = new Set(ambianceLayers);
  failureCount = 0;
  if (!gains) return;
  gains.base.gain.rampTo(1, FADE); // garde-fou: au cas où un niveau se termine en pleine erreur
  for (const key of MECHANIC_LAYERS) {
    gains[key].gain.rampTo(ambianceLayers.has(key) ? (LAYER_ACTIVE_GAIN[key] ?? 1) : 0, FADE);
  }
  gains.echec.gain.rampTo(0, FADE);
  duckFilter.frequency.rampTo(NORMAL_CUTOFF_HZ, FADE); // même garde-fou pour l'étouffement
}

/** Démute OU remute une couche mécanique selon `active` (no-op si déjà dans
 * cet état — évite de relancer une rampe déjà en cours à chaque frame,
 * `applyMechanicCounts` ci-dessous appelle cette fonction en continu). Si
 * une erreur est en cours (voir enterFailure), `unlocked` est quand même
 * tenu à jour mais le gain ne bouge pas avant la résolution de l'erreur
 * (voir exitFailure) — cohérent avec "toutes les pistes étouffées derrière
 * échec.wav" pendant une erreur (voir enterFailure). */
function setLayerActive(key, active) {
  if (!MECHANIC_LAYERS.includes(key)) return;
  if (!active && ambianceLayers.has(key)) return; // socle d'ambiance: jamais re-coupée par la logique de jeu
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

/** Synapse rompue ou neurone en surcharge: ÉTOUFFE tout (base comprise —
 * voir FAILURE_MUFFLE_GAIN/duckFilter en tête de fichier) au lieu de couper,
 * pour que la musique en cours paraisse s'éloigner plutôt que disparaître,
 * et joue la piste d'échec (non filtrée) en boucle par-dessus. Un compteur
 * (pas un booléen) car plusieurs erreurs peuvent être actives en même temps
 * — seule la PREMIÈRE fait vraiment quelque chose. */
export function enterFailure() {
  failureCount++;
  if (failureCount !== 1 || !gains) return;
  gains.base.gain.rampTo(FAILURE_MUFFLE_GAIN, FADE);
  for (const key of unlocked) gains[key].gain.rampTo(FAILURE_MUFFLE_GAIN, FADE);
  duckFilter.frequency.rampTo(FAILURE_MUFFLE_CUTOFF_HZ, FADE);
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
  duckFilter.frequency.rampTo(NORMAL_CUTOFF_HZ, FADE);
  gains.base.gain.rampTo(1, FADE);
  for (const key of unlocked) gains[key].gain.rampTo(LAYER_ACTIVE_GAIN[key] ?? 1, FADE);
}
