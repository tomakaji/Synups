// Transforme src/game/community-seed.js (SEED_LEVELS, format "moteur de
// jeu") en scripts/community-seed-data.json (format "document Firestore",
// consommé par scripts/seed-firestore.mjs).
//
// Round Firestore Communauté: avant ce round, ce JSON avait été produit une
// fois par un script Python jetable (jamais commité) — le rendant
// impossible à régénérer proprement si les 16 grilles seed changent un
// jour (ex: après un coup de scripts/gen-community-seed.mjs). Ce script Node
// remplace ce script Python jetable par une étape reproductible et commitée
// du pipeline complet:
//
//   scripts/gen-community-seed.mjs   (régénère les grilles, écrit community-seed.js)
//         ↓
//   scripts/build-community-seed-data.mjs   (ce script: transforme vers le schéma Firestore)
//         ↓
//   scripts/seed-firestore.mjs       (envoie les 16 documents vers Firestore, --reset possible)
//
// Transform appliqué à chaque entrée de SEED_LEVELS:
//   - baseLikes  -> likesCount (nom de champ Firestore réel, voir community-store.js)
//   - basePlays  -> playsCount (idem)
//   - ownerUid   -> "seed-<pseudo slugifié>" (un faux propriétaire par auteur
//     fictif, nécessaire car les règles Firestore/le schéma "levels"
//     attendent un ownerUid ; ces uid ne correspondent à aucun compte
//     Firebase Auth réel, ce script admin bypass les règles via le SDK Admin)
//   - id/title/author/rows/cols/cells/mechanics/difficulty/createdAt: inchangés
//
// Usage: node scripts/build-community-seed-data.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SEED_LEVELS } from "../src/game/community-seed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "community-seed-data.json");

/** Même logique de slug que celle utilisée pour produire le JSON initial:
 * minuscules, tout caractère non alphanumérique devient "-", pas de "-"
 * en double ni en bord de chaîne. */
function slugify(pseudo) {
  return pseudo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const data = SEED_LEVELS.map(
  ({ id, title, author, rows, cols, cells, mechanics, difficulty, createdAt, baseLikes, basePlays }) => ({
    id,
    title,
    author,
    rows,
    cols,
    cells,
    mechanics,
    difficulty,
    ownerUid: `seed-${slugify(author.pseudo)}`,
    likesCount: baseLikes,
    playsCount: basePlays,
    createdAt,
  })
);

writeFileSync(OUT_PATH, JSON.stringify(data, null, 2) + "\n", "utf-8");
console.log(`${data.length} grille(s) écrite(s) dans ${OUT_PATH}`);
