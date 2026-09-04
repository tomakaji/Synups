// Test de régression (même esprit que test-mirror-neuron.mjs) pour la
// feature Prisme du générateur Infini : génère plusieurs niveaux 1/2/3★ avec
// "prism" activée, et vérifie pour chacun :
//   1. qu'un niveau a bien été retourné (pas null malgré les retries) ;
//   2. la cohérence interne hasP (case "P" présente dans les cellules) <->
//      featureSubset.includes("prism") ;
//   3. que le niveau reste RÉELLEMENT unique une fois généré (analyzeAndCount,
//      indépendant de la boucle repair/strip qui l'a construit) ;
//   4. que le niveau est RÉELLEMENT gagnable — rejoué depuis une grille VIDE
//      via toggleLight (le même chemin que le joueur), pas via un ajout
//      direct des lumières de `best.solution` (voir commentaire de
//      test-mirror-neuron.mjs pour le pourquoi — un prisme n'a pas de
//      duplicata comme le neurone miroir, mais on garde la même méthode de
//      vérification par cohérence avec l'existant).
import { generateLevel } from "../src/game/generator.js";
import { LightUpGrid } from "../src/game/grid.js";
import { analyzeAndCount } from "../src/game/solver.js";

let totalAttempts = 0;
let prismLevels = 0;
let failures = 0;

for (const stars of [1, 2, 3]) {
  for (let i = 0; i < 12; i++) {
    totalAttempts++;
    const seed = 2000 * stars + i;
    const best = generateLevel({
      difficulty: stars,
      enabledFeatureKeys: ["forbidden", "color", "mirror", "pyra", "mirrorNeuron", "prism"],
      seed,
    });

    if (!best) {
      console.error(`[${stars}★ seed=${seed}] generateLevel a retourné null`);
      failures++;
      continue;
    }

    const hasP = best.level.cells.some((row) => row.split(" ").includes("P"));
    const claimsPrism = best.featureSubset.includes("prism");
    let ok = true;

    // Contrairement au Neurone miroir (isMirrorNeuronToken + sa propre passe
    // de nettoyage), hasP=true/claimsPrism=false N'est PAS une incohérence
    // en soi: comme un Miroir dévieur décoratif, `pruneUnusedPrisms` peut
    // légitimement laisser un prisme non "genuinely used" sur le plateau
    // s'il s'avère malgré tout NÉCESSAIRE comme simple obstacle opaque pour
    // l'unicité du puzzle blanc (voir son mécanisme revert) — juste
    // informatif ici, jamais un échec de test à lui seul (voir unicité +
    // gagnabilité ci-dessous, les seuls critères qui comptent réellement).
    if (hasP !== claimsPrism) {
      console.log(`[${stars}★ seed=${seed}] (info) hasP=${hasP} mais featureSubset prism=${claimsPrism} — décoratif mais nécessaire, pas un échec`);
    }
    if (hasP) prismLevels++;

    // Unicité indépendante: analyzeAndCount (couleur incluse) doit retomber
    // exactement sur count===1, comme n'importe quel niveau généré (voir
    // check-unique.mjs).
    const verify = analyzeAndCount(best.level, 2, 200_000);
    if (!verify || !verify.exhausted || verify.count !== 1) {
      console.error(
        `[${stars}★ seed=${seed}] unicité non confirmée: count=${verify?.count}, exhausted=${verify?.exhausted}`
      );
      ok = false;
    }

    // Rejoue `best.solution` depuis une grille vide via toggleLight — en
    // boucle à point fixe comme test-mirror-neuron.mjs: une entrée peut
    // devenir déjà illuminée (donc plus posable, règle "pas de pose sur une
    // case déjà éclairée") avant que la boucle n'en vienne à l'essayer,
    // selon l'ordre d'énumération de `solution` — un artefact d'ordre, pas
    // un échec réel. Seul `won` fait foi.
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
    const won = replay.isWon();
    if (!won) {
      console.error(`[${stars}★ seed=${seed}] niveau NON gagnable (won=${won}) hasP=${hasP}`);
      ok = false;
    }

    if (ok) {
      console.log(
        `[${stars}★ seed=${seed}] OK — ${best.level.rows}x${best.level.cols}, mesuré=${best.measuredTier}★, features=[${best.featureSubset.join(",")}], hasP=${hasP}`
      );
    } else {
      failures++;
    }
  }
}

console.log(`\nTotal: ${totalAttempts} générations, ${prismLevels} avec prisme, ${failures} échec(s).`);
process.exit(failures > 0 ? 1 : 0);
