// Régénère src/game/community-seed.js (grilles fictives du fil
// "Communauté" — voir community-store.js). Réutilise generateLevel() du
// vrai générateur Infini: chaque grille est garantie jouable et à solution
// unique, ce ne sont pas des données inventées à la main.
// Usage: node scripts/gen-community-seed.mjs > src/game/community-seed.js
import { generateLevel } from "../src/game/generator.js";

const AUTHORS = [
  { pseudo: "Neurosynth", avatar: "🧠" },
  { pseudo: "Lucie.exe", avatar: "✨" },
  { pseudo: "M. Prisme", avatar: "🔷" },
  { pseudo: "Aeon", avatar: "🌌" },
  { pseudo: "Voltaic", avatar: "⚡" },
  { pseudo: "Songe", avatar: "🌙" },
  { pseudo: "Katsu", avatar: "🦋" },
  { pseudo: "Vortex_9", avatar: "🌀" },
  { pseudo: "Mira", avatar: "🪐" },
  { pseudo: "Ombre Claire", avatar: "🌊" },
  { pseudo: "Petit Nex", avatar: "🧩" },
  { pseudo: "Ignis", avatar: "🔥" },
  { pseudo: "Halo", avatar: "🛰️" },
  { pseudo: "Cascade", avatar: "🦉" },
  { pseudo: "Fable", avatar: "🎯" },
  { pseudo: "Zed", avatar: "🔮" },
];

const TITLES = [
  "Premier signal",
  "Écho simple",
  "Circuit calme",
  "Double impulsion",
  "Le nœud aveugle",
  "Chambre interdite",
  "Triade rouge",
  "Miroir brisé",
  "Dérive bleue",
  "Fractale mineure",
  "Surcharge contrôlée",
  "Le dernier neurone",
  "Pyra dormant",
  "Réseau silencieux",
  "Angle mort",
  "Résonance",
];

// (difficulty étoiles, features activées) — variété volontaire pour que le
// fil ne soit pas monotone: du tutoriel (forbidden seul) jusqu'au 3★ avec
// toutes les mécaniques implémentées (voir FEATURES dans generator.js).
const PLAN = [
  [1, ["forbidden"]],
  [1, ["forbidden"]],
  [1, ["forbidden", "color"]],
  [1, ["forbidden", "color"]],
  [2, ["forbidden", "color"]],
  [2, ["forbidden", "color", "mirror"]],
  [1, ["forbidden", "color", "mirror"]],
  [2, ["forbidden", "color", "mirror"]],
  [2, ["forbidden", "color", "pyra"]],
  [3, ["forbidden", "color", "mirror"]],
  [3, ["forbidden", "color", "pyra"]],
  [1, ["forbidden", "color", "pyra"]],
  [3, ["forbidden", "color", "mirror", "pyra"]],
  [2, ["forbidden", "color", "mirror", "pyra"]],
  [1, ["forbidden"]],
  [3, ["forbidden", "color", "mirror"]],
];

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();

const levels = [];
for (let i = 0; i < PLAN.length; i++) {
  const [difficulty, enabledFeatureKeys] = PLAN[i];
  const seed = 1000 + i * 97;
  const result = generateLevel({ difficulty, enabledFeatureKeys, seed });
  if (!result) {
    console.error(`Échec de génération pour l'entrée ${i} (difficulty=${difficulty}, features=${enabledFeatureKeys.join(",")})`);
    process.exit(1);
  }
  const author = AUTHORS[i % AUTHORS.length];
  levels.push({
    id: `seed-${String(i + 1).padStart(2, "0")}`,
    title: TITLES[i % TITLES.length],
    author,
    rows: result.level.rows,
    cols: result.level.cols,
    cells: result.level.cells,
    mechanics: result.featureSubset,
    difficulty: result.measuredTier,
    // Étalées sur les ~3 dernières semaines, du plus ancien au plus récent
    // (i=0 le plus ancien) pour que le tri "récent" ait un ordre plausible.
    createdAt: new Date(now - (PLAN.length - i) * 1.3 * DAY_MS).toISOString(),
    // Popularité de départ fictive (voir community-store.js: seule la MISE
    // À JOUR — vos propres likes/parties — est réellement locale ; cette
    // base simule que d'autres joueurs existent, sans vrai backend).
    baseLikes: Math.floor(seed % 37) + (difficulty - 1) * 5,
    basePlays: Math.floor((seed * 3) % 89) + 12,
  });
}

const header = `// Grilles communautaires fictives (contenu de seed) — voir community-store.js.
// Généré par scripts/gen-community-seed.mjs (réutilise generateLevel() du
// vrai générateur Infini: chaque grille ci-dessous est garantie jouable et à
// solution unique, ce ne sont pas des données inventées à la main). Contenu
// statique et immuable: seule la couche locale (likes/parties du joueur,
// niveaux qu'IL publie) vit dans localStorage, voir community-store.js.
// Pour régénérer: node scripts/gen-community-seed.mjs
`;

const body = `export const SEED_LEVELS = ${JSON.stringify(levels, null, 2)};\n`;

process.stdout.write(header + body);
