// Ambiance sonore minimale, entièrement synthétisée (pas de fichiers audio).
// Sons doux et spatiaux (onde/reverb) plutôt que secs et percussifs, pour
// rester cohérent avec le thème cérébral/neuronal du jeu.
import * as Tone from "tone";

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

export async function playPlace() {
  await ensureStarted();
  tone.triggerAttackRelease("E5", "8n");
}

export async function playRemove() {
  await ensureStarted();
  tone.triggerAttackRelease("C4", "8n");
}

export async function playError() {
  await ensureStarted();
  soft.triggerAttackRelease("F#3", "16n");
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
  soft.triggerAttackRelease("D3", "16n", now);
  soft.triggerAttackRelease("C3", "8n", now + 0.05);
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
  soft.triggerAttackRelease("F3", "16n", now);
  tone.triggerAttackRelease("F#3", "16n", now + 0.02);
}
