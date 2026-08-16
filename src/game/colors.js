// Palette curatée pour l'affichage des couleurs de lumière (mélange additif
// borné à des combinaisons booléennes r/g/b). Volontairement pas un mélange
// RGB brut : on garde des teintes choisies pour rester dans l'ambiance
// épurée/mystérieuse plutôt que des couleurs primaires criardes.

const PALETTE = {
  "000": null, // pas de lumière -> laisser le CSS gérer (fond par défaut)
  "100": [255, 93, 108],
  "010": [89, 227, 157],
  "001": [93, 169, 255],
  "110": [255, 224, 102],
  "011": [98, 232, 224],
  "101": [209, 123, 255],
  "111": [251, 252, 255],
};

// Doit correspondre à --cell-empty dans style.css: base de mélange pour les
// couleurs "pleines" (voir illuminatedColor/lightColor) plutôt qu'une
// transparence CSS qui s'empilerait de façon imprévisible avec les icônes.
const BASE_BG = [38, 46, 70];

// Toutes les cases éclairées (source ou simplement traversées) partagent
// désormais EXACTEMENT le même traitement de fond: seule l'icône (voir
// neuronIcon dans render.js — anneau à contour sombre + halo sonar)
// distingue la case-source, plus une histoire d'opacité. Un seul ratio de
// mélange pour les deux rôles, y compris le blanc (qui n'a plus besoin de
// cas particulier: l'anneau à contour sombre reste lisible sur n'importe
// quel fond, y compris blanc sur blanc).
const ILLUM_MIX = 0.55;

function keyFor(lit) {
  return `${lit.r ? 1 : 0}${lit.g ? 1 : 0}${lit.b ? 1 : 0}`;
}

function mixRgb(base, target, t) {
  return [
    Math.round(base[0] + (target[0] - base[0]) * t),
    Math.round(base[1] + (target[1] - base[1]) * t),
    Math.round(base[2] + (target[2] - base[2]) * t),
  ];
}

/** Couleur pleine (opaque), utilisée pour les repères statiques (ex: coeur
 * de neurone, case-cible atteinte). */
export function hexFor(lit) {
  if (!lit) return null;
  const rgb = PALETTE[keyFor(lit)];
  if (!rgb) return null;
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * Couleur de la lumière projetée sur une case (pas la case-source), à 50%
 * de transparence par défaut. Utilisée pour de petits éléments décoratifs
 * (halo d'icône) où l'empilement de transparences n'est pas un problème.
 */
export function colorFor(lit, alpha = 0.5) {
  if (!lit) return null;
  const rgb = PALETTE[keyFor(lit)];
  if (!rgb) return null;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * Couleur PLEINE (pas de transparence CSS) d'une case illuminée par un
 * rayon, mélangée avec le fond de case selon ILLUM_MIX — le même ratio que
 * lightColor(), pour que toutes les cases éclairées aient la même opacité
 * ("on sait qu'une case est éclairée ou non", peu importe si elle est la
 * source ou juste traversée).
 */
export function illuminatedColor(lit) {
  if (!lit) return null;
  const rgb = PALETTE[keyFor(lit)];
  if (!rgb) return null;
  const mixed = mixRgb(BASE_BG, rgb, ILLUM_MIX);
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

/**
 * Couleur PLEINE d'une case-source (une lumière y est posée). Même ratio de
 * mélange que illuminatedColor(): la distinction "ceci est LA source" se
 * fait maintenant via l'icône (anneau + halo sonar dans render.js), pas via
 * une opacité différente.
 */
export function lightColor(lit) {
  if (!lit) return null;
  const rgb = PALETTE[keyFor(lit)];
  if (!rgb) return null;
  const mixed = mixRgb(BASE_BG, rgb, ILLUM_MIX);
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}
