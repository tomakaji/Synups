// Mode daltonien — calque d'affichage PUR, ajouté à côté de colors.js sans
// jamais y toucher (retour utilisateur: "en gardant la logique RGB des
// lumières"). colors.js reste l'unique source de vérité sur les teintes
// réellement affichées (PALETTE, mélange additif) ; ce module ne fait que
// DÉRIVER un repère textuel lisible sans distinguer les couleurs, à partir
// des mêmes booléens r/g/b que colors.js consomme déjà (`lit.r/g/b`) —
// aucune des 7 combinaisons non-nulles n'est renommée ni réinterprétée ici,
// juste étiquetée.
//
// Pourquoi un simple label texte plutôt qu'un motif/hachure: avec 7
// combinaisons (r, g, b, rg, gb, rb, rgb) posées sur des icônes déjà denses
// (charge/cible/prisme...), un motif graphique distinct par combo serait
// soit trop subtil pour être fiable, soit trop chargé visuellement. Le nom
// des canaux allumés (ex: "RG" pour jaune) est sans ambiguïté, se lit d'un
// coup d'oeil, et reste cohérent quelle que soit la palette artistique
// choisie dans colors.js (si les teintes exactes changent un jour, ce
// module n'a rien à modifier: il ne connaît que r/g/b, jamais un hex).

import { loadSettings, saveSettings } from "./storage.js";

export function isColorblindMode() {
  return !!loadSettings().colorblindEnabled;
}

export function setColorblindMode(enabled) {
  saveSettings({ ...loadSettings(), colorblindEnabled: !!enabled });
}

/** "R", "G", "B", "RG", "GB", "RB", "RGB" (ordre fixe r->g->b), ou "" si
 * `lit` est nul/vide (case sans couleur — rien à étiqueter). */
export function colorLabel(lit) {
  if (!lit) return "";
  let s = "";
  if (lit.r) s += "R";
  if (lit.g) s += "G";
  if (lit.b) s += "B";
  return s;
}

/** Fragment SVG <text> prêt à insérer dans une icône existante (même
 * technique de contraste que le reste de render.js: un contour sombre
 * derrière un remplissage clair, pour rester lisible sur n'importe quel
 * fond) — no-op (chaîne vide) si le mode est désactivé ou `lit` est vide,
 * pour que chaque appelant puisse l'insérer inconditionnellement sans re-
 * vérifier isColorblindMode() à chaque fois. `x`/`y` en coordonnées du
 * viewBox 0-100 déjà utilisé par toutes les icônes de render.js. */
export function colorLabelSvg(lit, x = 50, y = 78, size = 15) {
  if (!isColorblindMode()) return "";
  const label = colorLabel(lit);
  if (!label) return "";
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" stroke="#05060a" stroke-width="3" paint-order="stroke" fill="#fbfcff">${label}</text>`;
}
