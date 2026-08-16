// Sanity check rapide (pas une vraie suite de tests) : rejoue une solution
// connue pour chaque niveau et vérifie que le niveau est bien gagnable.
// Usage: npm run verify

import { LightUpGrid } from "../src/game/grid.js";
import { levels } from "../src/game/levels.js";

const solutions = [
  [[0, 0], [1, 1]], // Éveil
  [[0, 0], [0, 2], [2, 1]], // Ombre
  [[0, 1], [1, 0], [0, 3]], // Écho
  [[0, 1], [1, 3], [2, 0], [3, 2]], // Croisée
  [[0, 2], [4, 2], [2, 0], [2, 4]], // Fracture
  [[0, 1], [1, 0], [2, 2], [3, 3], [4, 5], [5, 3]], // Dérive
  [[0, 1], [1, 2], [2, 0], [3, 3], [4, 5], [5, 0], [6, 4]], // Veille
  [[0, 2], [1, 0], [2, 1], [2, 5], [3, 0], [3, 7], [4, 3], [4, 5], [5, 4], [6, 7], [7, 1]], // Abîme
  [[0, 3], [1, 0], [2, 2], [2, 4], [3, 0], [3, 5], [4, 1], [5, 2], [5, 6], [6, 3], [7, 0], [8, 1]], // Vertige
  [[0, 3], [0, 7], [1, 2], [1, 6], [2, 0], [3, 1], [3, 4], [3, 8], [4, 3], [5, 5], [5, 9], [6, 2], [6, 7], [7, 0], [7, 3]], // Éclipse
  [[0, 1], [1, 0], [1, 2], [2, 1], [3, 3], [4, 1]], // Miroir
  [[0, 3], [1, 0], [1, 2], [2, 1], [2, 4], [3, 0], [4, 3]], // Silence
  [[0, 1], [1, 2], [1, 4], [2, 0], [3, 4], [4, 3]], // Résonance
  [[0, 3], [1, 1], [1, 5], [2, 2], [2, 4], [3, 0], [4, 3]], // Labyrinthe
  [[0, 2], [0, 5], [1, 0], [1, 3], [2, 1], [3, 6], [4, 0], [5, 6], [6, 2]], // Zénith
  [[0, 0], [0, 3]], // Étincelle
  [[0, 1], [1, 0], [2, 2]], // Mixage
  [[0, 0], [0, 3]], // Veto
  [[0, 0], [0, 3], [2, 5], [2, 2]], // Réseau
  [[0, 1], [1, 0], [2, 2], [3, 3]], // Frontière
  [[0, 1], [0, 4], [1, 0], [1, 2], [2, 3], [2, 6], [3, 1], [3, 4], [4, 5], [5, 1], [6, 0], [6, 6]], // Faille
  [[0, 2], [0, 4], [1, 1], [1, 5], [2, 0], [2, 3], [3, 1], [3, 4], [4, 5], [5, 0], [6, 2], [6, 4]], // Écrin
  [[0, 2], [0, 4], [1, 0], [1, 5], [2, 3], [2, 6], [3, 1], [4, 6], [5, 4], [6, 5]], // Éclat
  [[0, 4], [1, 0], [1, 3], [1, 5], [2, 1], [2, 4], [3, 2], [3, 6], [4, 0], [5, 2], [6, 3], [6, 6]], // Domaine
  [[0, 3], [1, 2], [1, 4], [2, 0], [2, 5], [3, 1], [4, 0], [5, 6], [6, 2], [7, 4]], // Ultime
];

let allOk = true;

levels.forEach((level, i) => {
  const grid = new LightUpGrid(level);
  const solution = solutions[i] || [];

  for (const [r, c] of solution) {
    const result = grid.toggleLight(r, c);
    if (result !== "placed") {
      console.error(
        `Niveau ${i + 1} (${level.name}): pose invalide en (${r},${c}) -> ${result}`
      );
      allOk = false;
    }
  }

  const won = grid.isWon();
  console.log(`Niveau ${i + 1} (${level.name}): ${won ? "OK" : "ECHEC"}`);
  if (!won) allOk = false;
});

process.exit(allOk ? 0 : 1);
