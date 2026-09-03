// Test de régression (dans le même esprit que verify.mjs) pour la feature
// Neurone miroir du générateur Infini : génère plusieurs niveaux 1/2/3★ avec
// "mirrorNeuron" activée, et vérifie pour chacun :
//   1. qu'un niveau a bien été retourné (pas null malgré les retries) ;
//   2. la cohérence interne hasM (case "M" présente dans les cellules) <->
//      featureSubset.includes("mirrorNeuron") ;
//   3. que le niveau est RÉELLEMENT gagnable — rejoué depuis une grille
//      VIDE via toggleLight (le même chemin que le joueur/le solveur), pas
//      via un ajout direct des lumières de `best.solution` à `grid.lights`.
//
// Pourquoi pas un ajout direct (voir `buildGridWithLights` dans
// generator.js, qui procède ainsi) : `best.solution` (produit par
// solver.js) ne liste QUE les lumières explicitement posées par la
// recherche — pas leurs duplicatas de neurone miroir, qui n'existent que
// comme effet de bord de `toggleLight`/`_computeMirrorDuplicates` (cohérent
// avec `getPlacedLightCount()`, qui exclut aussi les duplicatas du compte de
// coups : le joueur ne clique que sur l'origine). Un ajout direct de
// `best.solution` à `grid.lights` sans rejouer `toggleLight` laisse donc les
// duplicatas absents, et une grille en apparence "pas gagnée" — repéré lors
// de ce travail (voir commit), PAS un bug du générateur : `buildGridWithLights`
// a la même limitation, mais elle est sans conséquence pour ses propres
// usages (mesures géométriques/de teinte SUR le plateau déjà connu, pas une
// resimulation depuis zéro).
import { generateLevel } from "../src/game/generator.js";
import { LightUpGrid } from "../src/game/grid.js";

let totalAttempts = 0;
let mirrorNeuronLevels = 0;
let failures = 0;

for (const stars of [1, 2, 3]) {
  for (let i = 0; i < 8; i++) {
    totalAttempts++;
    const seed = 1000 * stars + i;
    const best = generateLevel({
      difficulty: stars,
      enabledFeatureKeys: ["forbidden", "color", "mirror", "pyra", "mirrorNeuron"],
      seed,
    });

    if (!best) {
      console.error(`[${stars}★ seed=${seed}] generateLevel a retourné null`);
      failures++;
      continue;
    }

    const hasM = best.level.cells.some((row) => row.split(" ").includes("M"));
    const claimsMirrorNeuron = best.featureSubset.includes("mirrorNeuron");
    let ok = true;

    if (hasM !== claimsMirrorNeuron) {
      console.error(
        `[${stars}★ seed=${seed}] incohérence: hasM=${hasM} mais featureSubset mirrorNeuron=${claimsMirrorNeuron}`
      );
      ok = false;
    }
    if (hasM) mirrorNeuronLevels++;

    // Rejoue `best.solution` depuis une grille vide via toggleLight — les
    // duplicatas de neurone miroir apparaissent automatiquement (effet de
    // bord de la pose de leur origine), donc on retire chaque clé du
    // "restant" dès qu'elle porte déjà une lumière, sans jamais l'y poser
    // nous-mêmes. Boucle à point fixe: une entrée peut dépendre d'une autre
    // posée plus tard dans `solution` selon son ordre d'énumération.
    const replay = new LightUpGrid(best.level);
    const remaining = new Set(best.solution.map(([r, c]) => `${r},${c}`));
    let guard = 0;
    while (remaining.size > 0 && guard++ < 200) {
      let progressed = false;
      for (const key of Array.from(remaining)) {
        const [r, c] = key.split(",").map(Number);
        if (replay.hasLight(r, c)) {
          remaining.delete(key);
          progressed = true;
          continue;
        }
        if (replay.toggleLight(r, c) === "placed") {
          remaining.delete(key);
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    // `remaining` peut rester > 0 sans que ce soit un échec: une entrée de
    // `best.solution` peut devenir illuminée (donc plus posable via
    // toggleLight, règle "pas de pose sur une case déjà illuminée") avant
    // que la boucle n'en vienne à l'essayer directement — observé aussi sur
    // des niveaux SANS aucun neurone miroir, donc un artefact d'ordre
    // d'énumération de `solution`, pas un signe d'échec réel. Seul `won`
    // (l'état de la grille, la seule chose qui compte pour le joueur) fait
    // foi ici.
    const won = replay.isWon();
    if (!won) {
      console.error(`[${stars}★ seed=${seed}] niveau NON gagnable (restant=${remaining.size}, won=${won}) hasM=${hasM}`);
      ok = false;
    }

    if (ok) {
      console.log(
        `[${stars}★ seed=${seed}] OK — ${best.level.rows}x${best.level.cols}, mesuré=${best.measuredTier}★, features=[${best.featureSubset.join(",")}], hasM=${hasM}`
      );
    } else {
      failures++;
    }
  }
}

console.log(`\nTotal: ${totalAttempts} générations, ${mirrorNeuronLevels} avec neurone miroir, ${failures} échec(s).`);
process.exit(failures > 0 ? 1 : 0);
