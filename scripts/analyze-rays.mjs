// Outil ponctuel : pour un niveau + solution donnés, liste les rayons
// (lumière -> direction) assez longs pour y insérer un filtre + une cible
// colorée. On exclut uniquement les cases qui hébergent déjà une lumière
// de la solution (le reste peut être transformé en filtre/cible sans
// changer la validité de la solution connue : voir raisonnement en
// commentaire dans generate-color-levels si présent).
import { LightUpGrid, CellType } from "../src/game/grid.js";

const DIRECTIONS = [
  ["droite", 0, 1],
  ["gauche", 0, -1],
  ["bas", 1, 0],
  ["haut", -1, 0],
];

export function analyze(level, solution) {
  const grid = new LightUpGrid(level);
  for (const [r, c] of solution) grid.toggleLight(r, c);
  const solutionSet = new Set(solution.map(([r, c]) => `${r},${c}`));

  const rays = [];
  for (const [r, c] of solution) {
    for (const [label, dr, dc] of DIRECTIONS) {
      const path = [];
      let nr = r + dr;
      let nc = c + dc;
      while (grid.inBounds(nr, nc) && grid.cellAt(nr, nc).type === CellType.EMPTY) {
        if (solutionSet.has(`${nr},${nc}`)) break; // une autre lumière occupe cette case
        path.push([nr, nc]);
        nr += dr;
        nc += dc;
      }
      if (path.length >= 2) {
        rays.push({ from: [r, c], label, path });
      }
    }
  }
  return rays;
}

if (process.argv[1] && process.argv[1].endsWith("analyze-rays.mjs")) {
  const { levels } = await import("../src/game/levels.js");
  const idx = Number(process.argv[2]);
  const solution = JSON.parse(process.argv[3]);
  const rays = analyze(levels[idx], solution);
  for (const ray of rays) {
    console.log(
      `${JSON.stringify(ray.from)} -> ${ray.label} (len ${ray.path.length}):`,
      ray.path.map((p) => JSON.stringify(p)).join(" ")
    );
  }
}
