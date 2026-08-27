// Sprites "PixelArt" — 5e et dernière récompense de Remember (voir
// sommation.js: isPixelArtUnlocked, style.css: body.theme-pixelart). Retour
// utilisateur round 12: "le theme PixelArt doit pas juste appliquer un
// filtre, c'est tout un design alternatif en pixel art" + "je préfère le
// format 32x32". Chaque icône est dessinée sur une grille FIXE 32x32 (jamais
// redimensionnée en amont) puis rendue en <rect> SVG avec
// shape-rendering="crispEdges" — le viewBox est le SEUL redimensionnement,
// jamais de flou/anti-aliasing, exactement l'esprit "dessiner en 32x32 et
// zoomer" demandé.
//
// Chaque fonction ici a la MÊME signature que son équivalent "lisse" dans
// render.js — un simple branchement sur isPixelTheme() y suffit à substituer
// l'une par l'autre sans toucher au reste du pipeline (grid.js, animations
// JS, sons...). Portée round 12: uniquement le plateau PRINCIPAL
// (Histoire/Infini) — PAS le plateau de Remember (sommation.js), qui devient
// terminé/non-rejouable dès que ce thème se débloque (voir main.js/
// sommation.js: isPixelArtUnlocked) donc plus jamais affiché dans cet état.
import { hexFor } from "./colors.js";

const SIZE = 32;
const K = "#0a0c10"; // contour sombre — même valeur que le langage visuel "lisse" existant

export function isPixelTheme() {
  return typeof document !== "undefined" && document.body.classList.contains("theme-pixelart");
}

function emptyGrid() {
  return Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
}

function set(grid, x, y, color) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi >= 0 && xi < SIZE && yi >= 0 && yi < SIZE && color) grid[yi][xi] = color;
}

/** Anneau (outline entre rInner et rOuter) + remplissage plein (fill, rayon
 * rInner) — passer rInner<0 donne un disque plein d'une seule couleur
 * (outline couvre tout le disque). Passer fill=null donne un anneau creux
 * (utilisé pour les indicateurs "pas encore rempli"). */
function circle(grid, cx, cy, rOuter, rInner, outline, fill) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= rOuter && d > rInner) set(grid, x, y, outline);
      else if (fill && d <= rInner) set(grid, x, y, fill);
    }
  }
}

/** Ligne en escalier (Bresenham) — le tracé "en marches" plutôt qu'une
 * diagonale lissée est justement ce qui lit "pixel art" à cette résolution.
 * `dashEvery`: si fourni, un pixel sur N le long du tracé est sauté (trait
 * pointillé grossier, pas d'anti-aliasing possible à cette échelle). */
function line(grid, x0, y0, x1, y1, color, thick = 1, dashEvery = 0) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0, step = 0;
  const half = (thick - 1) / 2;
  while (true) {
    if (!dashEvery || step % dashEvery < Math.ceil(dashEvery / 2)) {
      for (let ox = -Math.floor(half); ox <= Math.ceil(half); ox++) {
        for (let oy = -Math.floor(half); oy <= Math.ceil(half); oy++) {
          set(grid, x + ox, y + oy, color);
        }
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    step++;
  }
}

function rectFilled(grid, x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(grid, x, y, color);
}

function rectOutline(grid, x0, y0, x1, y1, color) {
  for (let x = x0; x <= x1; x++) { set(grid, x, y0, color); set(grid, x, y1, color); }
  for (let y = y0; y <= y1; y++) { set(grid, x0, y, color); set(grid, x1, y, color); }
}

function triangleFill(grid, p1, p2, p3, color) {
  const minY = Math.max(0, Math.floor(Math.min(p1[1], p2[1], p3[1])));
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(p1[1], p2[1], p3[1])));
  const sign = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  for (let y = minY; y <= maxY; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d1 = sign(x + 0.5, y + 0.5, p1[0], p1[1], p2[0], p2[1]);
      const d2 = sign(x + 0.5, y + 0.5, p2[0], p2[1], p3[0], p3[1]);
      const d3 = sign(x + 0.5, y + 0.5, p3[0], p3[1], p1[0], p1[1]);
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(hasNeg && hasPos)) set(grid, x, y, color);
    }
  }
}

function triangleOutline(grid, p1, p2, p3, color) {
  line(grid, ...p1, ...p2, color);
  line(grid, ...p2, ...p3, color);
  line(grid, ...p3, ...p1, color);
}

function toSvgInner(grid) {
  let rects = "";
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = grid[y][x];
      if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  }
  return rects;
}

function toSvg(grid) {
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" class="cell-icon-svg" shape-rendering="crispEdges">${toSvgInner(grid)}</svg>`;
}

function channelColor(ch) {
  return { r: ch === "r", g: ch === "g", b: ch === "b" };
}

// ---------- Neurone (lumière) ----------
// Anneau "lisse" -> orbe plein pixel art (plus lisible à cette résolution),
// contour sombre identique, un pixel de reflet en haut à gauche.
export function pixelNeuronIcon(lit) {
  const hex = hexFor(lit) || "#fbfcff";
  const grid = emptyGrid();
  circle(grid, 16, 16, 13, 9, K, hex);
  set(grid, 11, 9, "#ffffff");
  set(grid, 12, 9, "#ffffff");
  set(grid, 11, 10, "#ffffff");
  return toSvg(grid);
}

/** [Expérimental] Duplicata de neurone miroir: anneaux pointillés violets
 * concentriques (écho) autour d'un cœur creux — même langage que
 * neuronDuplicateIcon "lisse", en pointillé pixel grossier. */
export function pixelNeuronDuplicateIcon(lit) {
  const hex = hexFor(lit) || "#fbfcff";
  const grid = emptyGrid();
  for (let a = 0; a < 360; a += 6) {
    const rad = (a * Math.PI) / 180;
    if (a % 24 < 16) {
      set(grid, 16 + Math.round(Math.cos(rad) * 12), 16 + Math.round(Math.sin(rad) * 12), "#b98fe0");
      set(grid, 16 + Math.round(Math.cos(rad) * 8.5), 16 + Math.round(Math.sin(rad) * 8.5), "#b98fe0");
    }
  }
  circle(grid, 16, 16, 5, 3, hex, hex);
  return toSvg(grid);
}

// ---------- Charge (case numérotée, "neurone récepteur") ----------
// Le coeur (satisfait/surchargé) est peint sur SA PROPRE grille et enveloppé
// dans un <g> qui réutilise les classes CSS déjà existantes du design lisse
// (cell-breathe/cell-flicker, voir style.css) — sous body.theme-pixelart ces
// mêmes classes gagnent une `animation-timing-function: steps(N)` (voir
// style.css), donc pas de nouvelle keyframe à maintenir, juste une saveur
// "par paliers" au lieu de lisse, cohérente avec l'esthétique pixel.
export function pixelChargeIcon(cell) {
  const n = cell.number;
  const count = cell._adjacentLights || 0;
  const satisfied = count === n;
  const overloaded = count > n;
  const chan = cell.color ? channelColor(cell.color) : null;
  const bright = (chan && hexFor(chan)) || "#3a8fa0";
  const core = emptyGrid();
  let coreClass = "";

  if (overloaded) {
    triangleOutline(core, [16, 5], [27, 27], [5, 27], "#5a6470");
    triangleFill(core, [16, 9], [23, 23], [9, 23], "#1a1c22");
    coreClass = "cell-flicker";
  } else if (satisfied) {
    circle(core, 16, 16, 8, -1, bright, bright);
    coreClass = "cell-breathe";
  } else if (chan) {
    circle(core, 16, 16, 6, 4, bright, "#1a2230");
  } else {
    circle(core, 16, 16, 6, 4, "#4a6a82", "#232c3c");
  }

  const slots = [
    [7, 7],
    [25, 7],
    [7, 25],
    [25, 25],
  ];
  const dots = emptyGrid();
  for (let i = 0; i < Math.min(n, 4); i++) {
    const [cx, cy] = slots[i];
    if (i < Math.min(count, n)) circle(dots, cx, cy, 2.6, -1, bright, bright);
    else circle(dots, cx, cy, 2.6, 1.4, "#6a86a0", null);
  }

  const coreSvg = coreClass ? `<g class="${coreClass}">${toSvgInner(core)}</g>` : toSvgInner(core);
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" class="cell-icon-svg" shape-rendering="crispEdges">${coreSvg}${toSvgInner(dots)}</svg>`;
}

// ---------- Synapse ----------
export function pixelSynapseIcon(state) {
  const success = state === "success";
  const main = success ? "#7a6fd0" : "#5a5a62";
  const dim = success ? "#4a3f9a" : "#3a3a42";
  const grid = emptyGrid();
  circle(grid, 8, 8, 4.5, -1, dim, dim);
  circle(grid, 24, 24, 4.5, -1, dim, dim);
  if (success) {
    line(grid, 11, 11, 21, 21, main, 2);
    set(grid, 14, 18, "#c9c4f2");
    set(grid, 19, 13, "#c9c4f2");
  } else {
    line(grid, 11, 11, 14, 14, main, 2);
    line(grid, 18, 18, 21, 21, main, 2);
  }
  return toSvg(grid);
}

// ---------- Cible ----------
// Coins de viseur statiques (l'équivalent pixel du contour lisse); le point
// central, lui, n'apparaît qu'une fois la cible atteinte et est enveloppé
// dans .pixel-target-pulse — un clignotement par paliers (steps(), voir
// style.css sous body.theme-pixelart) qui remplace la respiration+quart de
// tour lisse du design d'origine, trop fine à cette résolution.
export function pixelTargetIcon(cell) {
  const hex = hexFor(cell.target) || "#888";
  const matched = !!cell._colorMatch;
  const grid = emptyGrid();
  const corner = (x0, y0, dx, dy) => {
    line(grid, x0, y0, x0 + dx * 6, y0, hex, matched ? 3 : 2);
    line(grid, x0, y0, x0, y0 + dy * 6, hex, matched ? 3 : 2);
  };
  corner(5, 5, 1, 1);
  corner(26, 5, -1, 1);
  corner(5, 26, 1, -1);
  corner(26, 26, -1, -1);
  let dot = "";
  if (matched) {
    const dotGrid = emptyGrid();
    circle(dotGrid, 16, 16, 3, -1, "#05060a", hex);
    dot = `<g class="pixel-target-pulse">${toSvgInner(dotGrid)}</g>`;
  }
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" class="cell-icon-svg" shape-rendering="crispEdges">${toSvgInner(grid)}${dot}</svg>`;
}

// ---------- Mur ----------
export function pixelWallIcon() {
  const grid = emptyGrid();
  rectOutline(grid, 3, 3, 28, 28, "#3a4258");
  for (let i = -28; i <= 28; i += 6) line(grid, Math.max(3, 3 + i), 3, Math.min(28, 28 + i), 28, "#3a4258");
  return toSvg(grid);
}

// ---------- Miroir ----------
export function pixelMirrorIcon(cell) {
  const active = cell._mirrorColor && (cell._mirrorColor.r || cell._mirrorColor.g || cell._mirrorColor.b);
  const stroke = active ? hexFor(cell._mirrorColor) || "#9fb4d8" : "#4a5468";
  const grid = emptyGrid();
  if (cell.orientation === "/") line(grid, 6, 26, 26, 6, stroke, 2);
  else line(grid, 6, 6, 26, 26, stroke, 2);
  return toSvg(grid);
}

// ---------- Pyra (neurone pyramidal) ----------
// Les 3 repères de coin scintillent en boucle même au repos, comme la
// version lisse — mais chacun sur sa PROPRE petite grille, enveloppée dans
// .pyra-dot-pixel (un clignotement par paliers, voir style.css sous
// body.theme-pixelart) plutôt que les <animate> SVG continus du design
// lisse, pour rester cohérent avec l'esthétique "saute par paliers" du
// thème plutôt que d'importer une interpolation lisse.
export function pixelPyraIcon(cell) {
  const active = cell._activeColor;
  const fillHex = (active && hexFor(channelColor(active))) || null;
  const apex = [16, 5], right = [27, 26], left = [5, 26];
  const base = emptyGrid();
  if (cell._state === "success" && fillHex) triangleFill(base, apex, right, left, fillHex);
  triangleOutline(base, apex, right, left, "#4a5468");
  if (cell._state === "error") triangleFill(base, [16, 10], [21, 21], [11, 21], "#1a1c22");

  const dot = (cx, cy, color, delay) => {
    const g = emptyGrid();
    circle(g, cx, cy, 2.2, -1, color, color);
    return `<g class="pyra-dot-pixel" style="animation-delay:${delay}">${toSvgInner(g)}</g>`;
  };

  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" class="cell-icon-svg" shape-rendering="crispEdges">${toSvgInner(base)}${dot(apex[0], apex[1], "#ff5d6c", "0s")}${dot(right[0], right[1], "#59e39d", "0.6s")}${dot(left[0], left[1], "#5da9ff", "1.2s")}</svg>`;
}

// ---------- Filtre ----------
export function pixelFilterIcon(cell) {
  const hex = hexFor(channelColor(cell.filterColor)) || "#888";
  const grid = emptyGrid();
  triangleOutline(grid, [5, 8], [27, 8], [16, 20], hex);
  rectOutline(grid, 12, 20, 20, 27, hex);
  return toSvg(grid);
}

// ---------- Prisme ----------
// Le rotor de facettes "respirant" et pivotant du design lisse est ramené
// à 4 triangles de couleur STATIQUES peints UNE FOIS dans l'arrangement de
// base (rotation 0, dérivé uniquement de firstColor) — même stratégie que
// prismIcon() "lisse": le rendu ci-dessous enveloppe les pixels dans un
// <g class="prism-rotor"> avec le MÊME transform inline que le design lisse,
// pour que render.js (renderPrismIcon) puisse continuer à ne mettre à jour
// QUE ce transform entre deux rendus (et garder l'animation de rotation
// CSS), sans jamais avoir besoin de savoir si l'icône active est lisse ou
// pixel art.
export function pixelPrismIcon(cell, PRISM_COLOR_SEQUENCE, PRISM_LETTER_COLORS) {
  const baseIndex = PRISM_COLOR_SEQUENCE.indexOf(cell.firstColor || "r");
  const base = [0, 1, 2, 3].map((i) => PRISM_COLOR_SEQUENCE[(baseIndex + i) % 4]);
  const right = hexFor(PRISM_LETTER_COLORS[base[0]]) || "#888";
  const down = hexFor(PRISM_LETTER_COLORS[base[1]]) || "#888";
  const left = hexFor(PRISM_LETTER_COLORS[base[2]]) || "#888";
  const up = hexFor(PRISM_LETTER_COLORS[base[3]]) || "#888";
  const grid = emptyGrid();
  const c = [16, 16];
  triangleFill(grid, c, [27, 27], [27, 5], right);
  triangleFill(grid, c, [27, 27], [5, 27], down);
  triangleFill(grid, c, [5, 27], [5, 5], left);
  triangleFill(grid, c, [5, 5], [27, 5], up);
  line(grid, 5, 5, 27, 27, K);
  line(grid, 27, 5, 5, 27, K);
  const deg = (cell._prismAdjacentCount || 0) * 90;
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" class="cell-icon-svg" shape-rendering="crispEdges">
    <g class="prism-rotor" style="transform-origin:${SIZE / 2}px ${SIZE / 2}px; transform:rotate(${deg}deg)">${toSvgInner(grid)}</g>
  </svg>`;
}

// ---------- Neurone miroir [expérimental] ----------
export function pixelMirrorNeuronIcon() {
  const grid = emptyGrid();
  line(grid, 16, 3, 16, 28, "#b98fe0", 2, 3);
  circle(grid, 8, 16, 5.5, 3, "#b98fe0", null);
  circle(grid, 24, 16, 5.5, 3, "#b98fe0", null);
  return toSvg(grid);
}
