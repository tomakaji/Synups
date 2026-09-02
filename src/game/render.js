// Rendu partagé d'un plateau LightUp: construit le DOM d'une grille, ses
// icônes (neurone, charge, synapse, cible, mur), les lasers, et déclenche
// les sons de transition d'objectif. Utilisé à la fois par le jeu (main.js)
// et par l'éditeur de niveaux (editor.js) pour un aperçu/test identique.
import { CellType, PRISM_COLOR_SEQUENCE } from "./grid.js";
import { colorFor, hexFor, illuminatedColor, lightColor } from "./colors.js";
// Mode daltonien: calque d'affichage pur, voir colorblind.js — ne redéfinit
// aucune couleur, se contente d'ajouter un repère textuel (R/G/B/RG/...)
// par-dessus les icônes qui portent déjà une couleur ci-dessous, quand le
// réglage est actif (colorLabelSvg() est un no-op sinon).
import { colorLabelSvg } from "./colorblind.js";
// Thème PixelArt (5e récompense de Remember, voir sommation.js): chaque
// icône "lisse" ci-dessous a un équivalent en grille 32x32 dans
// pixelIcons.js — un branchement isPixelTheme() en tête de chaque fonction
// suffit, le reste du pipeline (grid.js, animations JS, sons) est inchangé.
// Portée: uniquement ce plateau (Histoire/Infini) — jamais celui de Remember
// (sommation.js), voir pixelIcons.js pour le détail de cette exclusion.
import {
  isPixelTheme,
  pixelNeuronIcon,
  pixelNeuronDuplicateIcon,
  pixelChargeIcon,
  pixelSynapseIcon,
  pixelTargetIcon,
  pixelMirrorIcon,
  pixelWallIcon,
  pixelPyraIcon,
  pixelMirrorNeuronIcon,
  pixelPrismIcon,
} from "./pixelIcons.js";

// Valeurs de repli seulement — voir `measureMetrics()` plus bas: en jeu, la
// taille réelle des cases peut être plus petite que ça sur mobile (voir
// style.css: #board définit --cell-size en fonction de la largeur d'écran
// pour éviter tout débordement horizontal), donc le positionnement en
// pixels des lasers ne peut PAS se fier à une constante fixe — il doit
// mesurer la case telle qu'elle est réellement rendue.
const CELL_SIZE = 56;
const GAP = 6;

// Rayon extérieur (en fraction de la case) de l'anneau coloré dessiné par
// neuronIcon: cercle de rayon 22 avec un trait de largeur 8 sur un viewBox
// 0-100, donc son bord extérieur est à (22 + 8/2) / 100 = 0.26 — voir
// renderLasers(): le dernier segment d'un laser qui atteint une lumière
// s'arrête à cette distance du centre plutôt qu'au centre exact.
const LAMP_RING_RADIUS_RATIO = 0.26;

const CHARGE_SLOTS = [
  [-20, -20],
  [20, -20],
  [-20, 20],
  [20, 20],
];

function channelColor(ch) {
  return { r: ch === "r", g: ch === "g", b: ch === "b" };
}

// Le prisme utilise 4 lettres (r/g/b/w, voir grid.js: PRISM_COLOR_SEQUENCE)
// alors que channelColor() ne connaît que r/g/b (une charge n'est jamais
// blanche) — mappage direct plutôt que de dévier channelColor pour un seul
// appelant.
const PRISM_LETTER_COLORS = {
  r: { r: true, g: false, b: false },
  g: { r: false, g: true, b: false },
  b: { r: false, g: false, b: true },
  w: { r: true, g: true, b: true },
};

/**
 * Icône d'une case-lumière: anneau épais dans la vraie couleur de la
 * lumière, avec un large contour sombre qui garantit le contraste sur
 * n'importe quel fond (même blanc sur blanc) — plus un halo "sonar" qui
 * part du centre et s'efface en boucle pour signaler "ceci est LA source"
 * par le mouvement plutôt que par une opacité de fond différente (toutes
 * les cases éclairées ont désormais la même opacité, voir colors.js).
 */
// Exportée (comme chargeIcon/mirrorIcon/etc. plus bas): réutilisée par
// main.js pour l'icône du schéma pédagogique "Lumière" (retour utilisateur:
// "il faut aussi une explication pour le neurone sans couleur") — même
// raison que les autres icônes exportées, voir FEATURE_ICON_HTML dans
// main.js: toujours le rendu RÉEL du jeu, jamais un glyphe redessiné à part.
export function neuronIcon(lit) {
  if (isPixelTheme()) {
    const hex = hexFor(lit) || "#fbfcff";
    // Même halo "sonar" que le design lisse (même classe CSS, même div) —
    // sous body.theme-pixelart il devient carré et saute par paliers (voir
    // style.css) au lieu de s'étendre en cercle lisse, pour rester cohérent
    // avec l'esthétique du reste des sprites 32x32.
    return `<div class="cell-sonar-halo" style="border-color:${hex}"></div>${pixelNeuronIcon(lit)}`;
  }
  const hex = hexFor(lit) || "#fbfcff";
  // Le halo sonar est un <div> ordinaire (pas un cercle SVG): transform-box:
  // fill-box sur un <circle> se comporte de façon peu fiable selon les
  // moteurs de rendu (le halo "clignote" entre échelle intérieure/extérieure
  // au lieu de s'étendre en continu). Un div absolument positionné a un
  // transform-origin "center" natif et fiable.
  return `<div class="cell-sonar-halo" style="border-color:${hex}"></div>
  <svg viewBox="0 0 100 100" class="cell-icon-svg">
    <circle cx="50" cy="50" r="22" fill="none" stroke="#0a0c10" stroke-width="14"/>
    <circle cx="50" cy="50" r="22" fill="none" stroke="${hex}" stroke-width="8"/>
    ${colorLabelSvg(lit, 78, 26, 22)}
  </svg>`;
}

/**
 * [Expérimental] Icône d'un duplicata de neurone miroir — design "écho
 * fantôme" (validé après mockups): deux anneaux pointillés violets
 * concentriques (l'écho qui se propage) autour d'un cœur creux et discret
 * (contrairement à neuronIcon, plein et opaque) dans la couleur héritée de
 * l'origine — jamais de halo "sonar" animé, réservé à LA source. Se veut
 * nettement plus affirmé que l'ancien simple anneau pointillé fin, sans
 * pour autant changer le langage visuel de la lampe elle-même (même
 * couleur, même position centrale).
 */
function neuronDuplicateIcon(lit) {
  if (isPixelTheme()) return pixelNeuronDuplicateIcon(lit);
  const hex = hexFor(lit) || "#fbfcff";
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
    <circle cx="50" cy="50" r="36" fill="none" stroke="#b98fe0" stroke-width="3" stroke-dasharray="5 5" opacity="0.55"/>
    <circle cx="50" cy="50" r="27" fill="none" stroke="#b98fe0" stroke-width="3" stroke-dasharray="5 5" opacity="0.8"/>
    <circle cx="50" cy="50" r="17" fill="none" stroke="${hex}" stroke-width="5" opacity="0.75"/>
  </svg>`;
}

/** Exportée (comme les autres icônes ci-dessous): réutilisée telle quelle
 * par l'écran de réglages Infini (voir main.js) pour que les tuiles de
 * sélection des mécaniques montrent EXACTEMENT les mêmes images qu'en jeu
 * (retour utilisateur), plutôt que des glyphes simplifiés redessinés à
 * part qui risqueraient de diverger du rendu réel. */
export function chargeIcon(cell) {
  if (isPixelTheme()) return pixelChargeIcon(cell);
  const n = cell.number;
  const count = cell._adjacentLights || 0;
  const satisfied = count === n;
  const overloaded = count > n;
  const chan = cell.color ? channelColor(cell.color) : null;
  const bright = (chan && hexFor(chan)) || "#3a8fa0";
  const glow = (chan && colorFor(chan, 0.4)) || "rgba(58,143,160,0.4)";
  const orbitDot = chan ? "#ffffff" : "#d8f5ff";

  let core;
  if (overloaded) {
    core = `<polygon points="66,50 58.2,58.2 50,64 41.8,58.2 34,50 41.8,41.8 50,36 58.2,41.8" fill="#1a1c22" stroke="#5a6470" stroke-width="1.4"/>`;
  } else if (satisfied) {
    core = `<g class="cell-breathe"><circle cx="50" cy="50" r="24" fill="${glow}"/><circle cx="50" cy="50" r="16" fill="${bright}"/></g>`;
  } else if (chan) {
    // Une charge colorée montre sa couleur requise dès le départ (avant
    // toute lumière posée à côté), pour que le joueur voie le réseau de
    // couleurs de tout le puzzle d'un coup d'oeil — pas seulement une fois
    // les points cardinaux déjà remplis. Anneau discret (pas le remplissage
    // plein et animé de l'état "satisfait") pour rester lisible comme un
    // état "en attente".
    core = `<circle cx="50" cy="50" r="16" fill="#1a2230" stroke="${bright}" stroke-width="2.6" opacity="0.85"/>`;
  } else {
    core = `<circle cx="50" cy="50" r="16" fill="#232c3c" stroke="#4a6a82" stroke-width="1.4"/>`;
  }

  let slots = "";
  if (satisfied) {
    const dots = CHARGE_SLOTS.slice(0, n)
      .map(([dx, dy]) => `<circle cx="${50 + dx}" cy="${50 + dy}" r="6" fill="${orbitDot}"/>`)
      .join("");
    slots = `<g><animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="6s" repeatCount="indefinite"/>${dots}</g>`;
  } else {
    for (let i = 0; i < n; i++) {
      const [dx, dy] = CHARGE_SLOTS[i];
      if (i < Math.min(count, n)) {
        slots += `<circle cx="${50 + dx}" cy="${50 + dy}" r="9" fill="${glow}"/><circle cx="${50 + dx}" cy="${50 + dy}" r="6" fill="${bright}"/>`;
      } else {
        slots += `<circle cx="${50 + dx}" cy="${50 + dy}" r="6" fill="none" stroke="#6a86a0" stroke-width="1.6"/>`;
      }
    }
  }

  let overflow = "";
  if (overloaded) {
    for (let i = 0; i < n; i++) {
      const [dx, dy] = CHARGE_SLOTS[i];
      overflow += `<circle cx="${50 + dx}" cy="${50 + dy}" r="9" fill="${glow}"/><circle cx="${50 + dx}" cy="${50 + dy}" r="6" fill="${bright}"/>`;
    }
    const extraCount = Math.min(count, 4) - n;
    for (let i = 0; i < extraCount; i++) {
      const [dx, dy] = CHARGE_SLOTS[Math.min(n + i, 3)];
      overflow += `<g class="cell-flicker">
        <circle cx="${50 + dx}" cy="${50 + dy}" r="4.5" fill="#cfd6de"/>
        <line x1="${50 + dx}" y1="${50 + dy}" x2="${50 + dx - 9}" y2="${50 + dy - 6}" stroke="#cfd6de" stroke-width="1.2"/>
        <line x1="${50 + dx}" y1="${50 + dy}" x2="${50 + dx + 9}" y2="${50 + dy - 6}" stroke="#cfd6de" stroke-width="1.2"/>
        <line x1="${50 + dx}" y1="${50 + dy}" x2="${50 + dx}" y2="${50 + dy + 11}" stroke="#cfd6de" stroke-width="1.2"/>
      </g>`;
    }
  }

  // Retour utilisateur: "toujours en haut à droite (même pour les [charges]
  // colorées) [...] on adapte la taille de la police aussi (22px)" — même
  // position/taille que neurones/miroirs/Pyra (voir ci-dessus/ci-dessous).
  const label = chan ? colorLabelSvg(chan, 78, 26, 22) : "";
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">${core}${slots}${overflow}${label}</svg>`;
}

export function synapseIcon(state) {
  if (isPixelTheme()) return pixelSynapseIcon(state);
  if (state === "success") {
    return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
      <circle cx="32" cy="32" r="16" fill="#4a3f9a" opacity="0.3"/>
      <circle cx="68" cy="68" r="16" fill="#4a3f9a" opacity="0.3"/>
      <line x1="32" y1="32" x2="68" y2="68" stroke="#7a6fd0" stroke-width="8"/>
      <line x1="44" y1="49" x2="53" y2="40" stroke="#9a90e0" stroke-width="1.4"/>
      <line x1="47" y1="56" x2="56" y2="47" stroke="#9a90e0" stroke-width="1.4"/>
      <circle cx="32" cy="32" r="8" fill="#7a6fd0"/>
      <circle cx="68" cy="68" r="8" fill="#7a6fd0"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
    <circle cx="32" cy="32" r="16" fill="#3a3a42" opacity="0.3"/>
    <circle cx="68" cy="68" r="16" fill="#3a3a42" opacity="0.3"/>
    <polyline points="32,32 46,39 52,29" stroke="#5a5a62" stroke-width="7" fill="none"/>
    <polyline points="68,68 54,61 48,71" stroke="#5a5a62" stroke-width="7" fill="none"/>
    <circle cx="53" cy="52" r="2" fill="#8a97a3"/>
    <circle cx="58" cy="46" r="1.7" fill="#8a97a3"/>
    <circle cx="47" cy="58" r="1.8" fill="#8a97a3"/>
    <circle cx="32" cy="32" r="8" fill="#5a5a62"/>
    <circle cx="68" cy="68" r="8" fill="#5a5a62"/>
  </svg>`;
}

/** Coins de viseur, en retrait des bords (le centre reste libre pour
 * neuronIcon quand une lumière est posée sur la même case). Chaque trait est
 * doublé d'un contour sombre PLEINE opacité (même technique que neuronIcon):
 * une case-cible ATTEINTE prend le fond de sa propre couleur cible
 * (illuminatedColor), donc sans ce contour l'icône de la même couleur s'y
 * fondrait complètement. Le point central n'apparaît qu'une fois la cible
 * atteinte, pour la distinguer d'un simple repère "couleur requise".
 * stroke-linejoin="round" est indispensable ici: chaque coin est un trait
 * qui tourne à 90°, et avec un trait large le raccord "miter" (défaut du
 * SVG) sort un pic pointu à cet endroit — visible comme un bloc noir en
 * trop à un seul coin. Le pointillé posait le même souci en creusant un
 * espace qui révélait ce pic de façon inégale: remplacé par une opacité
 * réduite, plus fiable, pour distinguer l'état "non atteint". */
function targetIcon(cell) {
  if (isPixelTheme()) return pixelTargetIcon(cell);
  const hex = hexFor(cell.target) || "#888";
  const matched = !!cell._colorMatch;
  const corners = "M16,30 V16 H30 M70,16 H84 V30 M84,70 V84 H70 M30,84 H16 V70";
  // Retour utilisateur: "pour la couleur blanche (cibles) on met rien" — une
  // cible qui demande du blanc (les 3 canaux) n'affiche AUCUNE lettre en
  // mode daltonien (là où R/G/B/RG/... reste affiché pour les autres
  // couleurs de cible) : "RGB" texte ajoute plus de bruit que d'info sur une
  // icône déjà chargée (coins de viseur + halo), contrairement à un simple
  // repère de 1-2 lettres.
  const isWhite = !!(cell.target && cell.target.r && cell.target.g && cell.target.b);
  const targetLabel = isWhite ? null : cell.target;
  if (!matched) {
    return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
      <path d="${corners}" fill="none" stroke="#05060a" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>
      <path d="${corners}" fill="none" stroke="${hex}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
      ${colorLabelSvg(targetLabel, 50, 56, 22)}
    </svg>`;
  }
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg cell-target-breathe">
    <path d="${corners}" fill="none" stroke="#05060a" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${corners}" fill="none" stroke="${hex}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="50" cy="50" r="9" fill="#05060a"/>
    <circle cx="50" cy="50" r="6" fill="${hex}"/>
    ${colorLabelSvg(targetLabel, 50, 36, 22)}
  </svg>`;
}

/** Icône d'un miroir: barre diagonale qui dévie un laser de 90°. Neutre au
 * repos, tintée de la couleur du dernier laser qui la traverse (voir
 * grid.js: `_mirrorColor`), pour que le joueur voie où l'impulsion rebondit. */
export function mirrorIcon(cell) {
  if (isPixelTheme()) return pixelMirrorIcon(cell);
  const active = cell._mirrorColor && (cell._mirrorColor.r || cell._mirrorColor.g || cell._mirrorColor.b);
  const stroke = active ? hexFor(cell._mirrorColor) || "#9fb4d8" : "#4a5468";
  const glow = active ? colorFor(cell._mirrorColor, 0.35) || "rgba(159,180,216,0.35)" : "rgba(74,84,104,0.18)";
  const [x1, y1, x2, y2] = cell.orientation === "/" ? [18, 82, 82, 18] : [18, 18, 82, 82];
  const label = active ? colorLabelSvg(cell._mirrorColor, 78, 26, 22) : "";
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${glow}" stroke-width="14" stroke-linecap="round"/>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>
    ${label}
  </svg>`;
}

/** Icône d'un mur: hachures pleines, pour se distinguer d'un void (qui, lui,
 * n'affiche RIEN — voir .cell--void) tout en restant dans le langage
 * "obstacle sans corps" (pas de fond/contour de case, juste l'icône). */
function wallIcon() {
  if (isPixelTheme()) return pixelWallIcon();
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
    <rect x="10" y="10" width="80" height="80" rx="6" fill="none" stroke="#3a4258" stroke-width="4"/>
    <path d="M10,34 L34,10 M10,58 L58,10 M10,82 L82,10 M34,90 L90,34 M58,90 L90,58" stroke="#3a4258" stroke-width="4"/>
  </svg>`;
}

/** Icône de Pyra (neurone pyramidal) — variante A validée en mockup:
 * triangle dont les 3 pointes portent un repère rouge/vert/bleu qui
 * scintille en boucle (identité tricolore instable, toujours visible,
 * activé ou non — voir grid.js: CellType.PYRA). L'intérieur se remplit
 * de la couleur active une fois activé (1 à 3 lumières adjacentes,
 * cell._activeColor) ; à 4 (surcharge), on superpose le même motif
 * "étoile" que chargeIcon en surcharge, pour rester cohérent avec le
 * langage visuel des autres charges plutôt que d'inventer un nouveau
 * signe d'erreur. */
export function pyraIcon(cell) {
  if (isPixelTheme()) return pixelPyraIcon(cell);
  const active = cell._activeColor;
  const fillHex = (active && hexFor(channelColor(active))) || "#888";
  const fillOpacity = cell._state === "success" && active ? 0.75 : 0;
  const overload =
    cell._state === "error"
      ? `<polygon points="66,50 58.2,58.2 50,64 41.8,58.2 34,50 41.8,41.8 50,36 58.2,41.8" fill="#1a1c22" stroke="#5a6470" stroke-width="1.4"/>`
      : "";
  // Mode daltonien (retour utilisateur): repère dynamique en haut à droite,
  // même position/taille que les neurones et miroirs — reflète la couleur
  // ACTUELLE du Pyra (instable, dépend du nombre de lumières adjacentes,
  // voir grid.js: _activeColor), donc absent tant que rien n'est actif.
  const label = active ? colorLabelSvg(channelColor(active), 78, 26, 22) : "";
  const triangle = "50,15 85,80 15,80";
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
    <polygon points="${triangle}" fill="none" stroke="#05060a" stroke-width="9" stroke-linejoin="round"/>
    <polygon points="${triangle}" fill="none" stroke="#4a5468" stroke-width="4" stroke-linejoin="round"/>
    <polygon points="${triangle}" fill="${fillHex}" fill-opacity="${fillOpacity}"/>
    <circle cx="50" cy="15" r="5" fill="#ff5d6c">
      <animate attributeName="r" values="5;7;5" dur="1.8s" begin="0s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.4;0.95;0.4" dur="1.8s" begin="0s" repeatCount="indefinite"/>
    </circle>
    <circle cx="85" cy="80" r="5" fill="#59e39d">
      <animate attributeName="r" values="5;7;5" dur="1.8s" begin="0.6s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.4;0.95;0.4" dur="1.8s" begin="0.6s" repeatCount="indefinite"/>
    </circle>
    <circle cx="15" cy="80" r="5" fill="#5da9ff">
      <animate attributeName="r" values="5;7;5" dur="1.8s" begin="1.2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.4;0.95;0.4" dur="1.8s" begin="1.2s" repeatCount="indefinite"/>
    </circle>
    ${label}
    ${overload}
  </svg>`;
}

/** [Expérimental] Icône d'un neurone miroir: un axe de symétrie
 * pointillé (comme un plan de miroir) avec deux repères identiques de
 * part et d'autre, pour évoquer "ce qui touche un côté se reproduit de
 * l'autre" — voir grid.js: MIRROR_NEURON. Couleur violette distincte du
 * reste du langage visuel pour signaler le statut expérimental. */
export function mirrorNeuronIcon() {
  if (isPixelTheme()) return pixelMirrorNeuronIcon();
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
    <line x1="50" y1="10" x2="50" y2="90" stroke="#b98fe0" stroke-width="5" stroke-dasharray="7 6" stroke-linecap="round"/>
    <circle cx="26" cy="50" r="12" fill="none" stroke="#b98fe0" stroke-width="5"/>
    <circle cx="74" cy="50" r="12" fill="none" stroke="#b98fe0" stroke-width="5"/>
  </svg>`;
}

/** Icône d'un prisme: octogone facetté (pierre taillée) avec 4 facettes
 * de forme et taille RIGOUREUSEMENT identiques, chacune centrée sur sa
 * direction cardinale (gauche/bas/droite/haut — donc alignée avec la
 * case voisine qu'elle colore, pas sur un angle entre deux voisins).
 * Chaque facette reste attachée au centre et à ses deux côtés partagés
 * avec ses voisines ; seule sa pointe extérieure respire (avance/recule),
 * en boucle et à un rythme décalé d'une facette à l'autre (asynchrone) —
 * design validé en mockup (variante E) plutôt qu'une simple pulsation
 * d'opacité globale, trop discrète pour se voir.
 *
 * La rotation (voir grid.js: chaque lumière supplémentaire à portée de
 * laser pivote l'ordre d'un cran) n'est PAS obtenue en recalculant quelle
 * couleur va dans quelle facette à chaque rendu — ça ne peut pas
 * s'animer, un changement de fill est instantané. Les 4 facettes sont
 * peintes UNE FOIS avec l'arrangement "de base" (rotation 0, dérivé
 * uniquement de `firstColor`), regroupées dans un <g class="prism-rotor">
 * qu'on fait pivoter de 90° par lumière en portée (`cell._prismAdjacentCount`,
 * voir grid.js) via un transform CSS. Une rotation de +90° (horaire)
 * déplace visuellement le contenu de "droite"→"bas"→"gauche"→"haut"→
 * "droite", ce qui reproduit exactement le décalage de couleurs voulu
 * (vérifié algébriquement: nouvelle couleur en gauche = ancienne couleur
 * en bas, etc.) tout en restant une VRAIE rotation qu'on peut animer en
 * transition CSS — voir render(): le <g> est mis à jour en place (son
 * `transform`, pas son innerHTML) pour que la transition s'applique.
 */
export function prismIcon(cell) {
  if (isPixelTheme()) return pixelPrismIcon(cell, PRISM_COLOR_SEQUENCE, PRISM_LETTER_COLORS);
  const baseIndex = PRISM_COLOR_SEQUENCE.indexOf(cell.firstColor || "r");
  const base = [0, 1, 2, 3].map((i) => PRISM_COLOR_SEQUENCE[(baseIndex + i) % 4]);
  const left = hexFor(PRISM_LETTER_COLORS[base[0]]) || "#888";
  const down = hexFor(PRISM_LETTER_COLORS[base[1]]) || "#888";
  const right = hexFor(PRISM_LETTER_COLORS[base[2]]) || "#888";
  const up = hexFor(PRISM_LETTER_COLORS[base[3]]) || "#888";
  // Chaque facette: centre, côté partagé, pointe (respire entre 42 et 34
  // de rayon), côté partagé suivant. begin décalé de 0.65s par facette.
  const facet = (fill, side1, tipOut, tipIn, side2, begin) => `
    <polygon points="50,50 ${side1} ${tipOut} ${side2}" fill="${fill}" fill-opacity="0.88" stroke="#05060a" stroke-width="3" stroke-linejoin="round">
      <animate attributeName="points" dur="2.6s" begin="${begin}" repeatCount="indefinite"
        values="50,50 ${side1} ${tipOut} ${side2};50,50 ${side1} ${tipIn} ${side2};50,50 ${side1} ${tipOut} ${side2}"/>
    </polygon>`;
  const facets = [
    facet(right, "79.7,20.3", "92,50", "84,50", "79.7,79.7", "0s"),
    facet(down, "79.7,79.7", "50,92", "50,84", "20.3,79.7", "0.65s"),
    facet(left, "20.3,79.7", "8,50", "16,50", "20.3,20.3", "1.3s"),
    facet(up, "20.3,20.3", "50,8", "50,16", "79.7,20.3", "1.95s"),
  ].join("");
  const deg = (cell._prismAdjacentCount || 0) * 90;
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
    <g class="prism-rotor" style="transform-origin:50px 50px; transform:rotate(${deg}deg)">${facets}</g>
  </svg>`;
}

/**
 * Crée un rendu de plateau attaché à `boardEl`. `build(grid, options)`
 * (re)construit le DOM pour une nouvelle instance de LightUpGrid ;
 * `render()` rafraîchit l'affichage (et les sons de transition) sans
 * reconstruire le DOM. `options.onCellClick(r, c)` est appelé au clic sur
 * une case vide (jeu normal ou test en direct dans l'éditeur) ;
 * `options.sounds` est un objet de callbacks optionnels
 * (targetSuccess/targetLost/synapseBreak/synapseRestore/chargeFull/
 * chargeEmptied/chargeOverload/chargeOverloadResolved — edge-triggered, un
 * seul appel au franchissement, effet sonore propre) plus `mechanicCounts`
 * (appelé une fois PAR FRAME avec l'état courant complet — voir plus bas —
 * dédié à la musique par calques, voir music.js: c'est lui qui permet à une
 * couche de se démuter ET de se remuter selon le compte courant, pas juste
 * au premier franchissement).
 * `playMirrorSuccess(links)`/
 * `playMirrorFailure(failure)` [expérimental] jouent une animation
 * éphémère de neurone miroir (voir grid.js: getLastMirrorLinks/
 * getLastMirrorFailure) — à appeler par l'appelant juste après un
 * `toggleLight`, PAS depuis `render()` lui-même (ce sont des événements
 * ponctuels liés à UN clic, pas un état dérivé qui se réaffiche à chaque
 * frame).
 */
export function createBoardRenderer(boardEl, options = {}) {
  // Retour utilisateur (round suivant, plusieurs bugs de zoom tactile
  // rapportés): "on ne peut pas déplacer la grille zoomée en cliquant dans
  // le vide autour d'elle, seulement en touchant la grille elle-même" — les
  // gestes (pincement/glissement) étaient posés directement sur `boardEl`,
  // qui RÉTRÉCIT visuellement autour de son centre une fois dézoomé/déplacé:
  // un doigt posé dans l'espace resté vide (désormais hors de la boîte de
  // `boardEl`) ne déclenche alors plus aucun pointerdown dessus. `panSurfaceEl`
  // (optionnel — reste `boardEl` par défaut pour un appelant qui ne le
  // fournit pas) est un conteneur plus large, de la taille de toute la zone
  // de jeu disponible, qui reste LUI immobile (jamais transformé) : les
  // gestes s'y posent sur toute cette zone, tandis que c'est toujours
  // `boardEl` qui reçoit le `transform` visuel. Voir main.js/editor.js pour
  // le wrapper concret passé (`#play-view`/`.editor-board-wrap`).
  const panSurfaceEl = options.panSurfaceEl || boardEl;
  let grid = null;
  let cellEls = [];
  let laserEls = [];
  let onCellClick = null;
  let sounds = {};
  let prevChargeState = new Map();
  let prevSynapseState = new Map();
  let prevTargetState = new Map();
  let cellSize = CELL_SIZE; // voir measureMetrics(): remplacé par la taille RÉELLE rendue
  let gapSize = GAP;

  // ---------- Zoom/pan tactile (retour utilisateur: "ça serait bien de
  // pouvoir zoomer/dézoomer sur une grille [...] tactile sur téléphone") ---
  // Pincement à deux doigts pour zoomer, glisser à un doigt pour déplacer
  // UNE FOIS zoomé (jamais à zoom normal, pour ne pas confondre un
  // glissement avec un simple tap de pose de lumière). Double-tap
  // réinitialise. Posé ici (createBoardRenderer) plutôt que dupliqué en
  // jeu/éditeur: les deux passent par cette même fabrique sur leur propre
  // #board/#editor-board (voir main.js/editor.js).
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 2.5;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  const activeTouchPointers = new Map(); // pointerId -> {x, y}
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let panStart = null; // {x, y, panX, panY} du geste 1 doigt en cours
  let didPanOrZoom = false; // évite qu'un pincement/glissement ne déclenche un clic de pose à la fin
  let lastTapTime = 0;
  let lastTapPos = null;

  function setZoomState(nextZoom, nextPanX, nextPanY) {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    // Limite le pan pour ne jamais perdre complètement la grille hors champ:
    // la moitié de la taille agrandie du plateau, mesurée sur sa boîte de
    // layout NON transformée (offsetWidth/Height, insensibles au transform
    // CSS lui-même contrairement à getBoundingClientRect).
    const naturalW = boardEl.offsetWidth || 1;
    const naturalH = boardEl.offsetHeight || 1;
    const maxPanX = (naturalW * zoom) / 2;
    const maxPanY = (naturalH * zoom) / 2;
    // Retour utilisateur: "lorsqu'on est en état de dézoom maximum, la
    // grille doit toujours être centrée comme à l'origine" — BUG CORRIGÉ: un
    // pincement qui REZOOME vers 1 (dézoom max) ne repassait jamais par le
    // geste à 1 doigt qui remet panX/panY à 0 (voir pointermove plus bas) —
    // un pan acquis PENDANT un zoom précédent pouvait donc subsister
    // exactement à zoom=1 (juste re-clampé, jamais annulé), laissant la
    // grille visuellement décentrée alors même qu'elle n'était plus zoomée.
    // "Dézoomé au max" DOIT toujours correspondre à la position d'origine.
    if (zoom <= MIN_ZOOM) {
      panX = 0;
      panY = 0;
    } else {
      panX = Math.min(maxPanX, Math.max(-maxPanX, nextPanX));
      panY = Math.min(maxPanY, Math.max(-maxPanY, nextPanY));
    }
    boardEl.style.transformOrigin = "center center";
    boardEl.style.transform = zoom === 1 && panX === 0 && panY === 0 ? "" : `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  // Retour utilisateur: "le zoom tactile se bloque très vite [...] il faut
  // recommencer la procédure de zoom pour zoomer davantage" — BUG CORRIGÉ:
  // la version précédente ne posait `touch-action:none` qu'APRÈS coup (dans
  // le pointerdown ci-dessous, au moment même où le 2e doigt se pose, et
  // remise à "" une fois tous les doigts relâchés à zoom=1). Changer
  // touch-action EN COURS DE GESTE — alors que le 1er doigt est déjà posé
  // avec l'ancienne valeur — est un cas mal défini pour les navigateurs, qui
  // répondent souvent en annulant un des deux pointeurs (pointercancel)
  // en plein pincement: exactement le symptôme observé (zoom qui se fige
  // presque aussitôt, un nouveau geste étant alors nécessaire). Posé UNE
  // SEULE FOIS, en dehors de tout geste, sur `panSurfaceEl` (l'élément qui
  // reçoit VRAIMENT les doigts, voir plus haut) — jamais modifié ensuite.
  // `pan-y` (jamais `none`) exclut déjà structurellement le pincement natif
  // du navigateur (pas dans la liste des gestes autorisés) tout en gardant
  // le scroll vertical natif possible au repos (ex: .editor-board-wrap).
  panSurfaceEl.style.touchAction = "pan-y";

  /** Réinitialise zoom/pan — appelé explicitement par l'appelant (voir
   * l'API retournée plus bas) quand un VRAI changement de niveau a lieu,
   * jamais automatiquement depuis build() (qui est aussi appelé à chaque
   * repeinture en cours d'édition — voir editor.js: rebuildEditGrid — where
   * réinitialiser le zoom à chaque case peinte serait très gênant). */
  function resetZoom(animated = false) {
    if (animated && (zoom !== 1 || panX !== 0 || panY !== 0)) {
      boardEl.style.transition = "transform 0.25s ease";
      setTimeout(() => {
        boardEl.style.transition = "";
      }, 260);
    }
    setZoomState(1, 0, 0);
  }

  function touchPointDist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }
  function touchPointMid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  panSurfaceEl.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return; // souris/stylet: comportement inchangé
    activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    didPanOrZoom = false;
    if (activeTouchPointers.size === 2) {
      const [a, b] = Array.from(activeTouchPointers.values());
      pinchStartDist = touchPointDist(a, b);
      pinchStartZoom = zoom;
      panStart = null; // un pincement à 2 doigts prend le dessus sur un pan à 1 doigt en cours
    } else if (activeTouchPointers.size === 1 && zoom > 1) {
      const p = activeTouchPointers.get(e.pointerId);
      panStart = { x: p.x, y: p.y, panX, panY };
    }
  });

  panSurfaceEl.addEventListener("pointermove", (e) => {
    if (!activeTouchPointers.has(e.pointerId)) return;
    activeTouchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activeTouchPointers.size === 2) {
      const [a, b] = Array.from(activeTouchPointers.values());
      const dist = touchPointDist(a, b);
      setZoomState(pinchStartZoom * (dist / pinchStartDist), panX, panY);
      didPanOrZoom = true;
      e.preventDefault();
    } else if (activeTouchPointers.size === 1 && panStart && zoom > 1) {
      const p = activeTouchPointers.get(e.pointerId);
      const dx = p.x - panStart.x;
      const dy = p.y - panStart.y;
      if (didPanOrZoom || Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        didPanOrZoom = true;
        setZoomState(zoom, panStart.panX + dx, panStart.panY + dy);
        e.preventDefault();
      }
    }
  });

  function endTouchPointer(e) {
    activeTouchPointers.delete(e.pointerId);
    if (activeTouchPointers.size < 2) pinchStartDist = 0;
    if (activeTouchPointers.size === 0) {
      panStart = null;
      if (!didPanOrZoom) {
        // Double-tap (deux taps rapprochés, sans déplacement notable):
        // réinitialise le zoom, geste habituel sur mobile.
        const now = Date.now();
        const pos = { x: e.clientX, y: e.clientY };
        if (lastTapPos && now - lastTapTime < 320 && touchPointDist(lastTapPos, pos) < 30) {
          resetZoom(true);
          lastTapTime = 0;
          lastTapPos = null;
          return;
        }
        lastTapTime = now;
        lastTapPos = pos;
      }
    }
  }
  panSurfaceEl.addEventListener("pointerup", endTouchPointer);
  panSurfaceEl.addEventListener("pointercancel", endTouchPointer);

  // Un clic de pose de lumière ne doit jamais se déclencher à la fin d'un
  // pincement/glissement — écoute en phase de capture pour intercepter le
  // "click" que le navigateur émet après pointerup avant qu'il n'atteigne
  // le handler posé sur chaque case (voir build() plus bas).
  boardEl.addEventListener(
    "click",
    (e) => {
      if (didPanOrZoom) {
        e.preventDefault();
        e.stopPropagation();
        didPanOrZoom = false;
      }
    },
    true
  );

  /** Mesure la taille de case et l'espacement effectivement rendus (au lieu
   * de supposer CELL_SIZE/GAP fixes) — nécessaire depuis que #board peut
   * réduire --cell-size en CSS pour tenir dans la largeur de l'écran (voir
   * style.css). Sans ça, les lasers (positionnés en pixels absolus, voir
   * cellCenter) resteraient calés sur l'ancienne taille fixe et
   * désaligneraient dès que l'écran est plus étroit que ~56px/case. Prend
   * l'avantage d'être mesuré sur le DOM réel plutôt que recalculé à la main
   * (fiable quel que soit le calc()/min() utilisé côté CSS). Sans effet sur
   * l'éditeur (#editor-board garde --cell-size fixe, jamais réduit).
   * `/ zoom`: getBoundingClientRect() renvoie la taille ÉCRAN (donc déjà
   * multipliée par le zoom tactile ci-dessus si actif) — on la ramène à la
   * taille de layout non transformée, sans quoi les lasers (positionnés en
   * pixels ENFANTS de #board, donc RE-multipliés par le même transform)
   * se retrouveraient décalés d'un facteur zoom² une fois zoomés. */
  function measureMetrics() {
    const sample = boardEl.querySelector(".cell");
    if (!sample) return;
    const rect = sample.getBoundingClientRect();
    if (rect.width > 0) cellSize = rect.width / zoom;
    const gapValue = parseFloat(getComputedStyle(boardEl).columnGap);
    if (!Number.isNaN(gapValue)) gapSize = gapValue;
  }

  function cellCenter(r, c) {
    return {
      x: gapSize + c * (cellSize + gapSize) + cellSize / 2,
      y: gapSize + r * (cellSize + gapSize) + cellSize / 2,
    };
  }

  function build(newGrid, options = {}) {
    grid = newGrid;
    onCellClick = options.onCellClick || null;
    sounds = options.sounds || {};
    prevChargeState = new Map();
    prevSynapseState = new Map();
    prevTargetState = new Map();

    boardEl.innerHTML = "";
    boardEl.style.gridTemplateColumns = `repeat(${grid.cols}, var(--cell-size))`;
    boardEl.style.gridTemplateRows = `repeat(${grid.rows}, var(--cell-size))`;
    // Nombre de colonnes exposé en variable CSS — voir style.css: #board
    // s'en sert pour calculer une --cell-size qui tient dans la largeur
    // d'écran disponible (mobile), sans jamais dépasser 56px (desktop).
    boardEl.style.setProperty("--cols", grid.cols);

    cellEls = [];
    for (let r = 0; r < grid.rows; r++) {
      const rowEls = [];
      for (let c = 0; c < grid.cols; c++) {
        const div = document.createElement("div");
        div.className = "cell";
        const cellData = grid.cellAt(r, c);

        if (cellData.type !== CellType.VOID) {
          const icon = document.createElement("span");
          icon.className = "cell-icon";
          div.appendChild(icon);
        }

        if (onCellClick && (options.clickableAll || cellData.type === CellType.EMPTY)) {
          div.addEventListener("click", () => onCellClick(r, c));
        }
        boardEl.appendChild(div);
        rowEls.push(div);
      }
      cellEls.push(rowEls);
    }

    laserEls = [];
    render();
  }

  function renderLasers() {
    laserEls.forEach((el) => el.remove());
    laserEls = [];

    // Toujours mesurer juste avant de positionner quoi que ce soit en
    // pixels: la taille réelle des cases peut avoir changé depuis le
    // dernier appel (resize/rotation d'écran — voir main.js, listener
    // "resize" qui redéclenche render()).
    measureMetrics();

    for (const laser of grid.lasers) {
      // Un laser dévié par un miroir est un tracé en plusieurs segments
      // (voir grid.js: `points` contient le départ, chaque coude, et
      // l'arrivée) : on dessine un segment par paire de points consécutifs,
      // tous nécessairement horizontaux ou verticaux (réflexions à 90°).
      // Chaque segment a sa PROPRE couleur (laser.colors[i]): si ce rayon a
      // traversé un miroir partagé avec un autre laser de couleur
      // différente, tout ce qui repart de ce miroir prend la couleur
      // mélangée du miroir plutôt que sa couleur d'origine (voir grid.js).
      const segmentCount = laser.points.length - 1;
      // Neurone miroir [expérimental]: un laser qui atteint directement un
      // duplicata n'a AUCUN effet sur sa couleur (voir grid.js:
      // _mirrorLaserBlocked) — le dernier segment "grésille" au lieu de se
      // connecter normalement, pour que le joueur comprenne que ce laser
      // n'a servi à rien plutôt que de croire qu'il a fonctionné.
      const [lastR, lastC] = laser.points[laser.points.length - 1];
      const blocked = laser.connected && grid.isMirrorDuplicate(lastR, lastC);

      for (let i = 0; i < segmentCount; i++) {
        const hex = hexFor(laser.colors[i]);
        const [r1, c1] = laser.points[i];
        const [r2, c2] = laser.points[i + 1];
        let p1 = cellCenter(r1, c1);
        let p2 = cellCenter(r2, c2);
        const horizontal = r1 === r2;
        const isFirstSegment = i === 0;
        const isLastSegment = i === segmentCount - 1;
        const segmentBlocked = blocked && isLastSegment;
        // `points` va toujours de la charge (départ) vers sa cible (voir
        // grid.js): le sens réel de ce segment précis, pas juste "gauche à
        // droite" à l'écran.
        const forwardH = c2 > c1;
        const forwardV = r2 > r1;

        // Retour utilisateur: "les lasers doivent, lorsqu'elles éclairent
        // une lampe, s'arrêter sur le cerceau du design de la lampe plutôt
        // qu'en son centre afin de montrer qu'elle la colore" — un laser qui
        // atteint réellement une lumière (connected, dernier segment, pas
        // grésillant sur un duplicata) recule son point d'arrivée du rayon
        // extérieur de l'anneau coloré de neuronIcon (cercle r=22, trait
        // 8 -> bord extérieur ~26 sur un viewBox 0-100), pour que le trait
        // touche visuellement le cerceau au lieu de plonger jusqu'au pixel
        // central, sous l'icône. Les segments intermédiaires (rebonds sur un
        // miroir) restent inchangés: leur point d'arrivée EST le pivot du
        // miroir, il doit rester exact.
        if (laser.connected && isLastSegment && !segmentBlocked) {
          const ringRadiusPx = cellSize * LAMP_RING_RADIUS_RATIO;
          if (horizontal) {
            p2 = { x: p2.x + (forwardH ? -ringRadiusPx : ringRadiusPx), y: p2.y };
          } else {
            p2 = { x: p2.x, y: p2.y + (forwardV ? -ringRadiusPx : ringRadiusPx) };
          }
        }

        // Retour utilisateur: "les lasers partent aussi de la couche
        // extérieure" — même traitement, symétrique, sur le PREMIER segment
        // (départ depuis la charge/Pyra qui tire ce rayon, voir grid.js:
        // `points` commence toujours sur la case qui tire, jamais sur une
        // lumière): avance le point de départ du même rayon `ringRadiusPx`
        // pour qu'il parte visuellement du bord extérieur de l'icône plutôt
        // que de son pixel central. Toujours actif (contrairement à
        // l'arrivée ci-dessus): la charge/Pyra qui tire est là qu'elle
        // touche une lumière ou non. Même rayon que neuronIcon même si
        // l'icône de départ (chargeIcon/pyraIcon) diffère légèrement en
        // taille réelle — approximation volontaire, jamais assez visible à
        // l'échelle d'une case pour justifier une constante par forme.
        if (isFirstSegment) {
          const ringRadiusPx = cellSize * LAMP_RING_RADIUS_RATIO;
          if (horizontal) {
            p1 = { x: p1.x + (forwardH ? ringRadiusPx : -ringRadiusPx), y: p1.y };
          } else {
            p1 = { x: p1.x, y: p1.y + (forwardV ? ringRadiusPx : -ringRadiusPx) };
          }
        }

        const wrap = document.createElement("div");
        wrap.className = laser.connected ? "laser" : "laser laser--unconnected";
        if (segmentBlocked) wrap.classList.add("laser--blocked");
        if (horizontal) {
          wrap.style.left = `${Math.min(p1.x, p2.x)}px`;
          wrap.style.top = `${p1.y - 3}px`;
          wrap.style.width = `${Math.abs(p2.x - p1.x)}px`;
          wrap.style.height = "6px";
        } else {
          wrap.style.left = `${p1.x - 3}px`;
          wrap.style.top = `${Math.min(p1.y, p2.y)}px`;
          wrap.style.width = "6px";
          wrap.style.height = `${Math.abs(p2.y - p1.y)}px`;
        }

        const outline = document.createElement("div");
        outline.className = horizontal ? "laser-outline laser-outline--h" : "laser-outline laser-outline--v";
        wrap.appendChild(outline);

        const core = document.createElement("div");
        core.className = horizontal ? "laser-core laser-core--h" : "laser-core laser-core--v";
        if (segmentBlocked) {
          core.style.backgroundColor = "transparent";
          core.style.backgroundImage = horizontal
            ? `repeating-linear-gradient(to right, ${hex} 0 4px, transparent 4px 8px)`
            : `repeating-linear-gradient(to bottom, ${hex} 0 4px, transparent 4px 8px)`;
        } else {
          core.style.backgroundColor = hex;
        }
        wrap.appendChild(core);

        // Les points animés ne se dessinent que sur le dernier segment
        // (juste avant la lumière), pour bien montrer où le rayon "arrive"
        // même s'il a rebondi plusieurs fois avant — sauf si ce laser
        // grésille sur un duplicata: pas de points, il n'y a rien à
        // "connecter" (voir plus haut).
        if (laser.connected && isLastSegment && !segmentBlocked) {
          const dotDirClass = horizontal
            ? forwardH ? "laser-dot--h" : "laser-dot--h-reverse"
            : forwardV ? "laser-dot--v" : "laser-dot--v-reverse";
          for (let i2 = 0; i2 < 2; i2++) {
            const dot = document.createElement("div");
            dot.className = `laser-dot ${dotDirClass}`;
            dot.style.borderColor = hex;
            dot.style.animationDelay = `${i2 * -1.2}s`;
            wrap.appendChild(dot);
          }
        }

        boardEl.appendChild(wrap);
        laserEls.push(wrap);
      }
    }
  }

  /** Rejoue une classe d'animation CSS sur l'icône de (r,c), même si elle
   * y est déjà (retrait + reflow forcé avant de la rajouter) — utilisé par
   * playMirrorSuccess/playMirrorFailure ci-dessous pour que deux clics
   * rapides sur le même neurone rejouent bien l'animation depuis le début
   * plutôt que de ne rien faire (une classe déjà présente ne redéclenche
   * pas une animation CSS). Se retire elle-même une fois terminée. */
  function pulseCell([r, c], className, duration) {
    const icon = cellEls[r]?.[c]?.querySelector(".cell-icon");
    if (!icon) return;
    icon.classList.remove(className);
    void icon.offsetWidth;
    icon.classList.add(className);
    setTimeout(() => icon.classList.remove(className), duration);
  }

  /** [Expérimental] Trace un fil pointillé violet, éphémère (pas persistant
   * — voir grid.js: MIRROR_NEURON), entre deux cases. `failMode` bascule
   * sur l'animation "échoue à mi-chemin et se retire" au lieu de "se
   * dessine jusqu'au bout" — utilisé par playMirrorFailure pour montrer
   * QUEL neurone a refusé de dupliquer, et dans quelle direction. Un
   * simple <svg><line></svg> positionné en overlay (même technique que les
   * lasers), qui se retire lui-même une fois l'animation terminée. */
  function spawnMirrorThread([r1, c1], [r2, c2], failMode) {
    measureMetrics(); // voir renderLasers(): idem, la case a pu changer de taille depuis le dernier rendu
    const p1 = cellCenter(r1, c1);
    const p2 = cellCenter(r2, c2);
    const left = Math.min(p1.x, p2.x);
    const top = Math.min(p1.y, p2.y);
    const width = Math.max(Math.abs(p2.x - p1.x), 1);
    const height = Math.max(Math.abs(p2.y - p1.y), 1);
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.classList.add("mirror-thread-overlay");
    svg.style.left = `${left}px`;
    svg.style.top = `${top}px`;
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", p1.x - left);
    line.setAttribute("y1", p1.y - top);
    line.setAttribute("x2", p2.x - left);
    line.setAttribute("y2", p2.y - top);
    line.setAttribute("stroke", "#b98fe0");
    line.setAttribute("stroke-width", "2.5");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-dasharray", String(len));
    line.style.setProperty("--len", String(len));
    line.classList.add(failMode ? "mirror-thread-line--fail" : "mirror-thread-line--ok");
    svg.appendChild(line);
    boardEl.appendChild(svg);

    const cleanup = () => svg.remove();
    svg.addEventListener("animationend", cleanup, { once: true });
    setTimeout(cleanup, 900); // filet de sécurité si animationend ne se déclenche pas
  }

  /** [Expérimental] Anime une duplication de neurone miroir réussie: le(s)
   * neurone(s) traversé(s) pulsent et un fil part de chacun vers ses deux
   * voisins impliqués (celui qui l'a illuminé, et le duplicata qu'il vient
   * de créer) — voir grid.js: getLastMirrorLinks(). Un item par saut de
   * chaîne, tous joués en même temps (voulu très rapide, pas de mise en
   * scène séquentielle même sur une longue chaîne). Purement cosmétique et
   * éphémère: n'affecte jamais l'état du jeu. */
  function playMirrorSuccess(links) {
    for (const { from, neuron, to } of links) {
      pulseCell(neuron, "mirror-neuron-pulse", 600);
      spawnMirrorThread(from, neuron, false);
      spawnMirrorThread(neuron, to, false);
    }
  }

  /** [Expérimental] Anime une duplication de neurone miroir impossible:
   * le neurone en cause tressaute (secousse, pas de pulsation "réussie") et
   * son fil s'arrête à mi-chemin vers la case visée avant de se retirer —
   * pour que le joueur comprenne QUEL neurone a bloqué le mouvement et
   * DANS QUELLE DIRECTION, plutôt qu'un simple son d'erreur générique.
   * Voir grid.js: getLastMirrorFailure(). */
  function playMirrorFailure(failure) {
    if (!failure) return;
    pulseCell(failure.neuron, "mirror-neuron-fail", 500);
    spawnMirrorThread(failure.neuron, failure.attempted, true);
  }

  // Le prisme est un cas particulier: contrairement à toutes les autres
  // icônes (reconstruites à neuf via innerHTML à chaque render), la sienne
  // doit s'animer en tournant (voir prismIcon) — ce qui exige de GARDER le
  // même noeud <g class="prism-rotor"> entre deux rendus pour que la
  // transition CSS sur `transform` ait un état "avant" à partir duquel
  // interpoler. Un innerHTML à chaque frame recréerait le noeud et
  // supprimerait l'animation (c'était le bug signalé).
  function renderPrismIcon(icon, cellData) {
    if (!icon) return;
    const deg = (cellData._prismAdjacentCount || 0) * 90;
    const rotor = icon.querySelector(".prism-rotor");
    // Le thème (lisse/pixel) peut changer entre deux frames (Options ->
    // toggle PixelArt pendant qu'un plateau est déjà affiché en mémoire,
    // voir main.js: btnPixelartToggle.onclick appelle renderer.render()) —
    // dans ce cas garder l'ancien noeud ne ferait QUE tourner l'icône de
    // l'ancien thème au lieu de la reskinner. Un data-attribute mémorise le
    // thème avec lequel le rotor actuel a été peint, pour ne réutiliser le
    // raccourci "juste tourner le transform" que si le thème n'a pas bougé.
    const pixel = String(isPixelTheme());
    if (rotor && icon.dataset.pixelTheme === pixel) {
      rotor.style.transform = `rotate(${deg}deg)`;
    } else {
      icon.innerHTML = prismIcon(cellData);
      icon.dataset.pixelTheme = pixel;
    }
  }

  function render() {
    // Musique par calques [voir music.js] : contrairement aux hooks
    // ci-dessous (edge-triggered, un seul appel au FRANCHISSEMENT), ces
    // compteurs mesurent l'état COURANT à chaque frame — nécessaire pour
    // pouvoir aussi bien démuter que REMUTER une couche quand son palier
    // n'est plus atteint (retour utilisateur: "si on retire les conditions
    // d'unmute, on remute"), y compris les paliers "couche 2" (≥3
    // neurones/≥2 neurones couleur/≥2 miroirs). `neuronesMiroirsActive`
    // vient directement de `grid._mirrorDuplicateOf` (un duplicata par lien
    // actif) plutôt que d'un compteur par case, ce mécanisme n'ayant pas
    // d'état "actif" par case comme prisme/miroir.
    let chargeFullCount = 0;
    let chargeFullColoredCount = 0;
    let mirrorActiveCount = 0;
    let prismActiveCount = 0;
    let pyraSatisfiedCount = 0;

    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cellData = grid.cellAt(r, c);
        const el = cellEls[r][c];
        const icon = el.querySelector(".cell-icon");

        if (cellData.type === CellType.PRISM) {
          el.className = "cell cell--prism";
          el.style.backgroundColor = "";
          renderPrismIcon(icon, cellData);
          // Musique par calques: "actif" dès la 1ère lumière en portée (voir
          // grid.js — 0 et 1 lumière donnent le même état de base, la
          // couleur s'applique déjà à ce stade). Compté ci-dessous pour
          // `mechanicCounts` (plus de hook edge-triggered dédié: la couche
          // prisme doit pouvoir se remuter, pas seulement se démuter).
          const prismActive = (cellData._prismAdjacentCount || 0) >= 1;
          if (prismActive) prismActiveCount++;
          continue;
        }

        el.className = "cell";
        el.style.backgroundColor = "";
        if (icon) icon.innerHTML = "";
        const key = `${r},${c}`;

        switch (cellData.type) {
          case CellType.VOID:
            el.classList.add("cell--void");
            break;
          case CellType.WALL:
            el.classList.add("cell--wall");
            if (icon) icon.innerHTML = wallIcon();
            break;
          case CellType.MIRROR: {
            el.classList.add("cell--mirror");
            if (icon) icon.innerHTML = mirrorIcon(cellData);
            // Musique par calques: "actif" dès qu'un laser coloré le
            // traverse (voir mirrorIcon ci-dessus, même test). Compté pour
            // `mechanicCounts` (plus de hook edge-triggered dédié).
            const mirrorActive = !!(cellData._mirrorColor && (cellData._mirrorColor.r || cellData._mirrorColor.g || cellData._mirrorColor.b));
            if (mirrorActive) mirrorActiveCount++;
            break;
          }
          case CellType.MIRROR_NEURON:
            el.classList.add("cell--mirror-neuron");
            if (icon) icon.innerHTML = mirrorNeuronIcon();
            break;
          case CellType.FORBIDDEN: {
            el.classList.add("cell--forbidden");
            if (icon) icon.innerHTML = synapseIcon(cellData._state);
            const prevSynapse = prevSynapseState.get(key);
            if (prevSynapse !== undefined) {
              if (cellData._state === "error" && prevSynapse !== "error") sounds.synapseBreak?.();
              else if (prevSynapse === "error" && cellData._state !== "error") sounds.synapseRestore?.();
            }
            prevSynapseState.set(key, cellData._state);
            break;
          }
          case CellType.CLUE: {
            el.classList.add("cell--clue");
            if (icon) icon.innerHTML = chargeIcon(cellData);
            const count = cellData._adjacentLights || 0;
            const satisfied = count === cellData.number;
            const overloaded = count > cellData.number;
            const chargeState = overloaded ? "overloaded" : satisfied ? "satisfied" : "building";
            const prevCharge = prevChargeState.get(key);
            if (prevCharge !== undefined) {
              if (chargeState === "satisfied" && prevCharge !== "satisfied") sounds.chargeFull?.();
              if (prevCharge === "satisfied" && chargeState !== "satisfied") sounds.chargeEmptied?.();
              if (chargeState === "overloaded" && prevCharge !== "overloaded") sounds.chargeOverload?.();
              // Musique par calques: sortie de surcharge (vers "building" OU
              // "satisfied" — les deux comptent comme "erreur résolue" pour
              // l'état échec, voir music.js).
              if (prevCharge === "overloaded" && chargeState !== "overloaded") sounds.chargeOverloadResolved?.();
            }
            prevChargeState.set(key, chargeState);
            if (chargeState === "satisfied") {
              chargeFullCount++;
              if (cellData.color) chargeFullColoredCount++;
            }
            break;
          }
          case CellType.PYRA: {
            el.classList.add("cell--pyra");
            if (icon) icon.innerHTML = pyraIcon(cellData);
            // Réutilise le même vocabulaire de sons que CLUE
            // (satisfied/overloaded/building) et la même map de suivi:
            // une case donnée est CLUE ou PYRA, jamais les deux, pas de
            // collision de clé possible.
            const pyraState =
              cellData._state === "error" ? "overloaded" : cellData._state === "success" ? "satisfied" : "building";
            const prevPyra = prevChargeState.get(key);
            if (prevPyra !== undefined) {
              if (pyraState === "satisfied" && prevPyra !== "satisfied") sounds.chargeFull?.();
              if (prevPyra === "satisfied" && pyraState !== "satisfied") sounds.chargeEmptied?.();
              if (pyraState === "overloaded" && prevPyra !== "overloaded") sounds.chargeOverload?.();
              if (prevPyra === "overloaded" && pyraState !== "overloaded") sounds.chargeOverloadResolved?.();
            }
            prevChargeState.set(key, pyraState);
            if (pyraState === "satisfied") {
              chargeFullCount++;
              // Compteur DÉDIÉ (en plus de chargeFullCount ci-dessus, pas à
              // sa place) pour la couche musicale "pyra" — voir music.js:
              // MECHANIC_THRESHOLDS.pyra, démutée dès 1 pyra satisfaite.
              pyraSatisfiedCount++;
            }
            break;
          }
          case CellType.EMPTY: {
            el.classList.add("cell--empty");
            let iconHtml = "";
            if (grid.hasLight(r, c)) {
              el.classList.add("cell--light");
              el.style.backgroundColor = lightColor(cellData._lit) || "";
              if (grid.isMirrorDuplicate(r, c)) {
                // [Expérimental] Duplicata de neurone miroir: pas
                // interactif (voir grid.js: toggleLight le refuse), design
                // dérivé de la lampe mais visuellement distinct.
                el.classList.add("cell--light-duplicate");
                iconHtml += neuronDuplicateIcon(cellData._lit);
              } else {
                iconHtml += neuronIcon(cellData._lit);
              }
            } else if (cellData._illuminated) {
              el.classList.add("cell--illuminated");
              if (cellData._hits >= 2) el.classList.add("cell--intersection");
              el.style.backgroundColor = illuminatedColor(cellData._lit) || "";
            }
            if (cellData.target) {
              iconHtml += targetIcon(cellData);
              const matched = !!cellData._colorMatch;
              if (matched) {
                el.classList.add("cell--target-glow");
                el.style.setProperty("--target-glow-color", colorFor(cellData.target, 0.4) || "rgba(143, 215, 255, 0.4)");
              }
              const prevTarget = prevTargetState.get(key);
              if (prevTarget !== undefined) {
                if (matched && !prevTarget) sounds.targetSuccess?.();
                else if (!matched && prevTarget) sounds.targetLost?.();
              }
              prevTargetState.set(key, matched);
            }
            if (icon) icon.innerHTML = iconHtml;
            break;
          }
        }
      }
    }

    renderLasers();

    // Musique par calques: un seul appel par frame avec l'état COURANT
    // complet — voir music.js `applyMechanicCounts`, qui décide lui-même
    // démute/remute par seuil (y compris les seuils "couche 2"). Le
    // duplicata de neurone miroir n'a pas de compteur dédié plus haut car
    // ce n'est pas un état par case (voir grid.js: `_mirrorDuplicateOf`, un
    // duplicata actuellement placé = un lien actif).
    sounds.mechanicCounts?.({
      chargeFull: chargeFullCount,
      chargeFullColored: chargeFullColoredCount,
      mirrorActive: mirrorActiveCount,
      prismActive: prismActiveCount,
      neuronesMiroirsActive: grid._mirrorDuplicateOf ? grid._mirrorDuplicateOf.size : 0,
      pyraActive: pyraSatisfiedCount,
    });
  }

  return {
    build,
    render,
    playMirrorSuccess,
    playMirrorFailure,
    /** Remet le zoom/pan tactile à 1x centré — à appeler explicitement à
     * chaque VRAI changement de niveau (voir main.js: loadLevel, editor.js:
     * loadLevelIntoEditor/newBtn), jamais depuis build() lui-même (voir son
     * commentaire plus haut). */
    resetZoom,
    /** Élément DOM d'une case (r, c) — utilisé par main.js pour poser une
     * mise en valeur temporaire (indice) sans dupliquer ici l'accès à
     * `cellEls`, qui reste privé au module. */
    cellElementAt(r, c) {
      return cellEls[r]?.[c] || null;
    },
    get grid() {
      return grid;
    },
  };
}
