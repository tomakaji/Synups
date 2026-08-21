// Ambiance sonore minimale, entièrement synthétisée (pas de fichiers audio).
// Sons doux et spatiaux (onde/reverb) plutôt que secs et percussifs, pour
// rester cohérent avec le thème cérébral/neuronal du jeu.
import * as Tone from "tone";
import { isFailureActive } from "./music.js";

// Multiplicateur d'amplitude (paramètre `velocity` de Tone.Synth, 1 =
// niveau normal) appliqué aux SFX d'action qui mènent à une erreur — retour
// utilisateur: "on les entend trop peu", +20% linéaire. Appliqué via
// `velocity` plutôt qu'en remontant le `.volume` (en dB) des synths
// partagés (`soft`/`tone`), qui servent aussi à d'autres sons (ex.
// playTargetLost, playChargeEmptied) qui ne doivent PAS être affectés.
const ERROR_SFX_VELOCITY = 1.2;

// Note de pose = extraite de la VRAIE mélodie de neurone-couleur.wav
// (analyse spectrale du fichier, voir music-demos/couches/notes-couches.md
// pour le contexte général) plutôt qu'un tirage uniforme dans MUSIC_SCALE
// comme avant — retour utilisateur: la pose doit "citer" la mélodie du jeu.
// La piste est structurée en 3 blocs de 8s (phrase A-B-A', voir notes-
// couches.md) ; chaque bloc est décomposé ci-dessous en sa propre suite de
// notes JOUÉES DANS L'ORDRE. Bloc A (0-8s): E5 puis C5 puis A4 (résolution
// sur la tonique). Bloc B (8-16s): E5, G4, E5 (seul bloc qui ne redescend
// pas sur A4, cohérent avec son rôle de contraste). Bloc A' (16-24s):
// C5, E5, A4 (variante du bloc A, même note de résolution finale).
const MELODY_BLOCKS = [
  ["E5", "C5", "A4"],
  ["E5", "G4", "E5"],
  ["C5", "E5", "A4"],
];

// État de la suite en cours: `currentBlock` est l'un des tableaux ci-dessus
// (référence directe, pas une copie), `posInBlock` l'index de la PROCHAINE
// note à jouer dedans. Tant que la suite n'est pas épuisée, on avance
// simplement dedans à chaque pose ; une fois épuisée, on retire un nouveau
// bloc au hasard parmi les 3 (répétition du même bloc possible, voir retour
// utilisateur) et on repart de son index 0.
let currentBlock = null;
let posInBlock = 0;

function nextPlacementNote() {
  if (!currentBlock || posInBlock >= currentBlock.length) {
    currentBlock = MELODY_BLOCKS[Math.floor(Math.random() * MELODY_BLOCKS.length)];
    posInBlock = 0;
  }
  return currentBlock[posInBlock++];
}

let started = false;
async function ensureStarted() {
  if (!started) {
    await Tone.start();
    started = true;
  }
}

/**
 * Volume général (0 à 1, linéaire) appliqué sur la sortie finale de Tone —
 * en amont de tous les synths/bus ci-dessous, donc affecte tous les sons
 * uniformément sans toucher à leurs volumes individuels respectifs.
 */
export function setMasterVolume(level) {
  const clamped = Math.max(0, Math.min(1, level));
  Tone.getDestination().volume.value = clamped <= 0 ? -Infinity : Tone.gainToDb(clamped);
}

// Bus commun : un peu de reverb + un léger delay pour une sensation
// d'espace/onde, plutôt qu'un son sec qui claque.
const reverb = new Tone.Reverb({ decay: 4.5, wet: 0.4 }).toDestination();
const delay = new Tone.FeedbackDelay({ delayTime: 0.3, feedback: 0.22, wet: 0.16 }).connect(reverb);

const tone = new Tone.Synth({
  oscillator: { type: "sine" },
  envelope: { attack: 0.04, decay: 0.5, sustain: 0.05, release: 0.8 },
  volume: -10,
}).connect(delay);

const soft = new Tone.Synth({
  oscillator: { type: "triangle" },
  envelope: { attack: 0.03, decay: 0.35, sustain: 0, release: 0.5 },
  volume: -16,
}).connect(delay);

// Le son de réussite (playWin, pad + shimmer ci-dessous) est baissé de 30%
// en amplitude perçue: -30% linéaire = 20*log10(0.7) ≈ -3.1 dB, appliqué
// directement sur le volume de base de ces deux synths (utilisés
// uniquement par playWin, donc sans effet sur les autres sons).
const WIN_VOLUME_TRIM_DB = -3.1;

// Durée totale de playWin réduite de moitié par rapport à la version
// d'origine (attaques/decays/releases divisés par 2, voir playWin
// ci-dessous pour les délais et durées de note également divisés par 2).
const pad = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: "sine" },
  envelope: { attack: 0.7, decay: 0.8, sustain: 0.5, release: 2 },
  volume: -12 + WIN_VOLUME_TRIM_DB,
}).connect(reverb);

const shimmer = new Tone.Synth({
  oscillator: { type: "sine" },
  envelope: { attack: 0.3, decay: 0.5, sustain: 0.2, release: 1.5 },
  volume: -18 + WIN_VOLUME_TRIM_DB,
}).connect(reverb);

// Petits accusés de réception pour les objectifs (cible atteinte/perdue,
// synapse rompue/rétablie, charge pleine/vidée/en surcharge) : courts,
// toujours doux, jamais percussifs.
const chime = new Tone.Synth({
  oscillator: { type: "sine" },
  envelope: { attack: 0.015, decay: 0.35, sustain: 0.05, release: 1.1 },
  volume: -13,
}).connect(reverb);

// Timbre dédié au son de pose pendant l'état d'échec (synapse rompue ou
// neurone en surcharge, voir music.js: isFailureActive/enterFailure) — un
// intervalle dissonant (tritone) en registre grave, sur une onde en dents de
// scie (plus "sombre"/rugueuse que le sinus utilisé pour la pose normale)
// pour signaler que quelque chose ne va pas SANS sonner comme playError
// (une seule note, timbre/registre différents) : la pose n'est pas elle-même
// une erreur, elle se contente d'être teintée par l'état d'échec en cours.
const darkPlaceLow = new Tone.Synth({
  oscillator: { type: "sawtooth" },
  envelope: { attack: 0.015, decay: 0.3, sustain: 0, release: 0.4 },
  volume: -14,
}).connect(delay);

const darkPlaceHigh = new Tone.Synth({
  oscillator: { type: "sawtooth" },
  envelope: { attack: 0.015, decay: 0.3, sustain: 0, release: 0.4 },
  volume: -16,
}).connect(delay);

export async function playPlace() {
  await ensureStarted();
  if (isFailureActive()) {
    // Hauteur FIXE (aucune variation de note tant que l'échec dure) — voir
    // nextPlacementNote() plus bas, qu'on n'appelle PAS ici: currentBlock/
    // posInBlock restent inchangés, donc la suite normale reprend
    // exactement où elle en était une fois l'échec résolu.
    const now = Tone.now();
    darkPlaceLow.triggerAttackRelease("G2", "8n", now);
    darkPlaceHigh.triggerAttackRelease("C#3", "8n", now);
    return;
  }
  // Voir nextPlacementNote() plus haut: avance dans la suite de notes du
  // bloc de mélodie en cours (neurone-couleur.wav), retire un nouveau bloc
  // au hasard une fois la suite épuisée.
  tone.triggerAttackRelease(nextPlacementNote(), "8n");
}

export async function playRemove() {
  await ensureStarted();
  tone.triggerAttackRelease("C4", "8n");
}

export async function playError() {
  await ensureStarted();
  soft.triggerAttackRelease("F#3", "16n", Tone.now(), ERROR_SFX_VELOCITY);
}

// Montée ambiante, plus proche d'une onde qui se déploie que d'une fanfare :
// deux accords étalés en pad + un point d'orgue aigu très diffus (reverb).
export async function playWin() {
  await ensureStarted();
  const now = Tone.now();
  pad.triggerAttackRelease(["C4", "G4", "E5"], "4n", now);
  pad.triggerAttackRelease(["D4", "A4", "F#5"], "2n", now + 0.65);
  shimmer.triggerAttackRelease("C6", "2n", now + 0.25);
}

// --- Objectifs: case-cible ---------------------------------------------

export async function playTargetSuccess() {
  await ensureStarted();
  const now = Tone.now();
  chime.triggerAttackRelease("E5", "16n", now);
  chime.triggerAttackRelease("A5", "8n", now + 0.09);
}

export async function playTargetLost() {
  await ensureStarted();
  const now = Tone.now();
  soft.triggerAttackRelease("A4", "16n", now);
  soft.triggerAttackRelease("E4", "8n", now + 0.08);
}

// --- Objectifs: synapse --------------------------------------------------

export async function playSynapseBreak() {
  await ensureStarted();
  const now = Tone.now();
  soft.triggerAttackRelease("D3", "16n", now, ERROR_SFX_VELOCITY);
  soft.triggerAttackRelease("C3", "8n", now + 0.05, ERROR_SFX_VELOCITY);
}

export async function playSynapseRestore() {
  await ensureStarted();
  tone.triggerAttackRelease("G4", "8n");
}

// --- Objectifs: case à charge ---------------------------------------------

export async function playChargeFull() {
  await ensureStarted();
  chime.triggerAttackRelease("F#4", "8n");
}

export async function playChargeEmptied() {
  await ensureStarted();
  soft.triggerAttackRelease("D4", "16n");
}

export async function playChargeOverload() {
  await ensureStarted();
  const now = Tone.now();
  soft.triggerAttackRelease("F3", "16n", now, ERROR_SFX_VELOCITY);
  tone.triggerAttackRelease("F#3", "16n", now + 0.02, ERROR_SFX_VELOCITY);
}
