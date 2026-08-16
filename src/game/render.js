// Rendu partagé d'un plateau LightUp: construit le DOM d'une grille, ses
// icônes (neurone, charge, synapse, cible, mur), les lasers, et déclenche
// les sons de transition d'objectif. Utilisé à la fois par le jeu (main.js)
// et par l'éditeur de niveaux (editor.js) pour un aperçu/test identique.
import { CellType, PRISM_COLOR_SEQUENCE } from "./grid.js";
import { colorFor, hexFor, illuminatedColor, lightColor } from "./colors.js";

const CELL_SIZE = 56;
const GAP = 6;

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
function neuronIcon(lit) {
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
  </svg>`;
}

/**
 * [Expérimental] Icône d'un duplicata de neurone miroir: reprend le même
 * anneau que neuronIcon (fidèle au design de la lampe, même couleur — voir
 * grid.js: le duplicata imite toujours la couleur de son origine) mais
 * remplace le halo "sonar" animé (réservé à LA source, voir neuronIcon) par
 * un anneau pointillé violet qui reprend le langage visuel du neurone
 * miroir lui-même (même trait, même couleur que mirrorNeuronIcon) — pour
 * signaler d'un coup d'oeil "ceci est une copie, pas la source", sans
 * inventer un nouveau vocabulaire de couleur.
 */
function neuronDuplicateIcon(lit) {
  const hex = hexFor(lit) || "#fbfcff";
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
    <circle cx="50" cy="50" r="34" fill="none" stroke="#b98fe0" stroke-width="4" stroke-dasharray="7 6" stroke-linecap="round" opacity="0.8"/>
    <circle cx="50" cy="50" r="22" fill="none" stroke="#0a0c10" stroke-width="14"/>
    <circle cx="50" cy="50" r="22" fill="none" stroke="${hex}" stroke-width="8"/>
  </svg>`;
}

function chargeIcon(cell) {
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

  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">${core}${slots}${overflow}</svg>`;
}

function synapseIcon(state) {
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
  const hex = hexFor(cell.target) || "#888";
  const matched = !!cell._colorMatch;
  const corners = "M16,30 V16 H30 M70,16 H84 V30 M84,70 V84 H70 M30,84 H16 V70";
  if (!matched) {
    return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
      <path d="${corners}" fill="none" stroke="#05060a" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>
      <path d="${corners}" fill="none" stroke="${hex}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg cell-target-breathe">
    <path d="${corners}" fill="none" stroke="#05060a" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${corners}" fill="none" stroke="${hex}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="50" cy="50" r="9" fill="#05060a"/>
    <circle cx="50" cy="50" r="6" fill="${hex}"/>
  </svg>`;
}

/** Icône d'un miroir: barre diagonale qui dévie un laser de 90°. Neutre au
 * repos, tintée de la couleur du dernier laser qui la traverse (voir
 * grid.js: `_mirrorColor`), pour que le joueur voie où l'impulsion rebondit. */
function mirrorIcon(cell) {
  const active = cell._mirrorColor && (cell._mirrorColor.r || cell._mirrorColor.g || cell._mirrorColor.b);
  const stroke = active ? hexFor(cell._mirrorColor) || "#9fb4d8" : "#4a5468";
  const glow = active ? colorFor(cell._mirrorColor, 0.35) || "rgba(159,180,216,0.35)" : "rgba(74,84,104,0.18)";
  const [x1, y1, x2, y2] = cell.orientation === "/" ? [18, 82, 82, 18] : [18, 18, 82, 82];
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${glow}" stroke-width="14" stroke-linecap="round"/>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>
  </svg>`;
}

/** Icône d'un mur: hachures pleines, pour se distinguer d'un void (qui, lui,
 * n'affiche RIEN — voir .cell--void) tout en restant dans le langage
 * "obstacle sans corps" (pas de fond/contour de case, juste l'icône). */
function wallIcon() {
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
function pyraIcon(cell) {
  const active = cell._activeColor;
  const fillHex = (active && hexFor(channelColor(active))) || "#888";
  const fillOpacity = cell._state === "success" && active ? 0.75 : 0;
  const overload =
    cell._state === "error"
      ? `<polygon points="66,50 58.2,58.2 50,64 41.8,58.2 34,50 41.8,41.8 50,36 58.2,41.8" fill="#1a1c22" stroke="#5a6470" stroke-width="1.4"/>`
      : "";
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
    ${overload}
  </svg>`;
}

/** [Expérimental] Icône d'un neurone miroir: un axe de symétrie
 * pointillé (comme un plan de miroir) avec deux repères identiques de
 * part et d'autre, pour évoquer "ce qui touche un côté se reproduit de
 * l'autre" — voir grid.js: MIRROR_NEURON. Couleur violette distincte du
 * reste du langage visuel pour signaler le statut expérimental. */
function mirrorNeuronIcon() {
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
    <line x1="50" y1="10" x2="50" y2="90" stroke="#b98fe0" stroke-width="5" stroke-dasharray="7 6" stroke-linecap="round"/>
    <circle cx="26" cy="50" r="12" fill="none" stroke="#b98fe0" stroke-width="5"/>
    <circle cx="74" cy="50" r="12" fill="none" stroke="#b98fe0" stroke-width="5"/>
  </svg>`;
}

/** Icône d'un filtre: entonnoir teinté de sa couleur fixe (décidée au
 * level-design, jamais changée en jeu) — même technique de double-contour
 * (sombre plein derrière, couleur devant) que les autres icônes, pour
 * rester lisible même sur un fond de la même teinte. */
function filterIcon(cell) {
  const hex = hexFor(channelColor(cell.filterColor)) || "#888";
  const shape = "M15,25 85,25 60,50 60,80 40,80 40,50 Z";
  return `<svg viewBox="0 0 100 100" class="cell-icon-svg">
    <path d="${shape}" fill="none" stroke="#05060a" stroke-width="9" stroke-linejoin="round"/>
    <path d="${shape}" fill="${hex}" fill-opacity="0.22" stroke="${hex}" stroke-width="4" stroke-linejoin="round"/>
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
 * La rotation (voir grid.js: chaque lumière adjacente supplémentaire
 * pivote l'ordre d'un cran) n'est PAS obtenue en recalculant quelle
 * couleur va dans quelle facette à chaque rendu — ça ne peut pas
 * s'animer, un changement de fill est instantané. Les 4 facettes sont
 * peintes UNE FOIS avec l'arrangement "de base" (rotation 0, dérivé
 * uniquement de `firstColor`), regroupées dans un <g class="prism-rotor">
 * qu'on fait pivoter de 90° par lumière adjacente (`cell._prismAdjacentCount`,
 * voir grid.js) via un transform CSS. Une rotation de +90° (horaire)
 * déplace visuellement le contenu de "droite"→"bas"→"gauche"→"haut"→
 * "droite", ce qui reproduit exactement le décalage de couleurs voulu
 * (vérifié algébriquement: nouvelle couleur en gauche = ancienne couleur
 * en bas, etc.) tout en restant une VRAIE rotation qu'on peut animer en
 * transition CSS — voir render(): le <g> est mis à jour en place (son
 * `transform`, pas son innerHTML) pour que la transition s'applique.
 */
function prismIcon(cell) {
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
 * chargeEmptied/chargeOverload).
 */
export function createBoardRenderer(boardEl) {
  let grid = null;
  let cellEls = [];
  let laserEls = [];
  let onCellClick = null;
  let sounds = {};
  let prevChargeState = new Map();
  let prevSynapseState = new Map();
  let prevTargetState = new Map();

  function cellCenter(r, c) {
    return {
      x: GAP + c * (CELL_SIZE + GAP) + CELL_SIZE / 2,
      y: GAP + r * (CELL_SIZE + GAP) + CELL_SIZE / 2,
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

      for (let i = 0; i < segmentCount; i++) {
        const hex = hexFor(laser.colors[i]);
        const [r1, c1] = laser.points[i];
        const [r2, c2] = laser.points[i + 1];
        const p1 = cellCenter(r1, c1);
        const p2 = cellCenter(r2, c2);
        const horizontal = r1 === r2;
        const isLastSegment = i === segmentCount - 1;
        // `points` va toujours de la charge (départ) vers sa cible (voir
        // grid.js): le sens réel de ce segment précis, pas juste "gauche à
        // droite" à l'écran.
        const forwardH = c2 > c1;
        const forwardV = r2 > r1;

        const wrap = document.createElement("div");
        wrap.className = laser.connected ? "laser" : "laser laser--unconnected";
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
        core.style.backgroundColor = hex;
        wrap.appendChild(core);

        // Les points animés ne se dessinent que sur le dernier segment
        // (juste avant la lumière), pour bien montrer où le rayon "arrive"
        // même s'il a rebondi plusieurs fois avant.
        if (laser.connected && isLastSegment) {
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
    if (rotor) {
      rotor.style.transform = `rotate(${deg}deg)`;
    } else {
      icon.innerHTML = prismIcon(cellData);
    }
  }

  function render() {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cellData = grid.cellAt(r, c);
        const el = cellEls[r][c];
        const icon = el.querySelector(".cell-icon");

        if (cellData.type === CellType.PRISM) {
          el.className = "cell cell--prism";
          el.style.backgroundColor = "";
          renderPrismIcon(icon, cellData);
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
          case CellType.MIRROR:
            el.classList.add("cell--mirror");
            if (icon) icon.innerHTML = mirrorIcon(cellData);
            break;
          case CellType.FILTER:
            el.classList.add("cell--filter");
            if (icon) icon.innerHTML = filterIcon(cellData);
            break;
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
            }
            prevChargeState.set(key, chargeState);
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
            }
            prevChargeState.set(key, pyraState);
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
  }

  return {
    build,
    render,
    get grid() {
      return grid;
    },
  };
}
