// Outil de dev : indique, pour chaque niveau, s'il a 0, 1 ou "2+" solutions.
// Usage: npm run check-unique
//
// Le backtracking est plafonné en nombre de noeuds explorés (voir
// src/game/solver.js) : sur une grande grille peu contrainte, le résultat
// peut être "indéterminé" plutôt que de bloquer indéfiniment. Les niveaux
// conçus pour être à solution unique doivent rester assez petits/contraints
// pour que le solveur conclue vite.

import { levels } from "../src/game/levels.js";
import { countSolutions } from "../src/game/solver.js";

for (let i = 0; i < levels.length; i++) {
  const level = levels[i];
  const start = Date.now();
  const { count, exhausted } = countSolutions(level, 2, 3_000_000);
  const ms = Date.now() - start;

  let label;
  if (!exhausted) label = `indéterminé (budget dépassé, >=${count} trouvée(s))`;
  else if (count === 0) label = "AUCUNE SOLUTION";
  else if (count === 1) label = "unique";
  else label = "plusieurs solutions";

  console.log(`Niveau ${i + 1} (${level.name}): ${label} [${ms}ms]`);
}
