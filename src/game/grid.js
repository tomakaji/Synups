// Modèle de grille et règles du jeu LightUp.
// Aucune dépendance : facile à tester isolément (voir scripts/verify.mjs,
// scripts/check-unique.mjs et src/game/solver.js).
//
// Mécanique couleur (v2, "charge + laser"): une case à charge (CLUE) peut
// porter une couleur. Quand elle atteint son état "success" (le bon nombre
// de lumières adjacentes), chacune de ses directions qui ne pointe PAS vers
// une lumière tire un laser fin de sa couleur, qui voyage jusqu'à la
// première case-lumière rencontrée sur cette ligne/colonne et la teinte
// (elle diffuse alors sa propre couleur au lieu du blanc par défaut). Le
// laser est purement indicatif: il ne rend pas les cases traversées
// "illuminées". Si plusieurs lasers de couleurs différentes atteignent la
// même lumière, leurs couleurs se mélangent (addition des canaux r/g/b).
//
// Une case interdite (FORBIDDEN) est un type dédié: aucune lumière ne peut
// jamais être adjacente. Remplace l'ancien indice numéroté "0".
//
// VOID (hors-grille) et WALL (mur) sont à nouveau deux types distincts:
// tous les deux bloquent la lumière blanche de base comme n'importe quel
// obstacle opaque, MAIS un laser de charge colorée traverse un VOID sans y
// être arrêté (transparent, comme si la case n'existait pas pour le
// routage coloré) alors qu'un WALL l'arrête bel et bien. Ça permet de
// distinguer "en dehors de la forme du niveau" (void, souvent traversé par
// des lasers qui routent ailleurs) de "obstacle solide qui bloque
// vraiment" (wall).
//
// Miroir (MIRROR, token "/" ou "\"): dévie un laser de charge colorée de
// 90° au lieu de l'arrêter. Ne concerne QUE les lasers colorés — la
// lumière blanche de base (illumination normale, comptage des cases à
// charge/interdites) le traverse comme n'importe quel obstacle opaque
// (il bloque, sans dévier). Ça permet de router un laser en coude vers
// une lumière qui n'est pas sur la même ligne/colonne que la charge.
//
// Filtre (FILTER, token "Fr"/"Fg"/"Fb"): couleur fixe décidée au
// level-design (pas cliquable en jeu, contrairement au miroir qui ne
// change pas de couleur non plus d'ailleurs — "pas cliquable" ici précise
// juste qu'il n'y a aucune interaction joueur possible sur cette case).
// Un laser coloré qui le traverse ne garde QUE le canal du filtre (ex: un
// filtre rouge ne laisse jamais passer ni vert ni bleu, même si le rayon
// entrant en contenait) — ne dévie pas, contrairement au miroir.
//
// Prisme (PRISM, token "P" ou "Pr"/"Pg"/"Pb"/"Pw"): case fixe du niveau
// (non posable par le joueur) qui colore directement ses 4 cases
// adjacentes SI elles portent une lumière — rouge/vert/bleu/blanc dans
// l'ordre fixe gauche/bas/droite/haut. La "première couleur" (celle à
// gauche) s'applique dès la PREMIÈRE lumière adjacente posée (0 et 1
// lumière adjacente donnent donc le même état de base) ; chaque lumière
// SUPPLÉMENTAIRE (la 2e, 3e, 4e...) pivote l'ordre d'un cran (90°) de
// plus (voir PRISM_COLOR_SEQUENCE ci-dessous). L'ordre relatif reste
// toujours rouge→vert→bleu→blanc, seul le point de départ pivote.
//
// L'icône affichée est volontairement EN AVANCE d'un cran sur cette
// rotation "appliquée": elle montre où ira la couleur de la PROCHAINE
// lumière plutôt que la couleur déjà attribuée aux lumières en place —
// le joueur doit pouvoir anticiper avant de poser, pas seulement
// constater après coup (voir `appliedRotation` vs `displayRotation`
// dans recompute()). Les lumières déjà posées, elles, ne changent
// jamais rétroactivement de couleur.
//
// Pyra (PYRA, token "Y"): neurone pyramidal. Contrairement à une charge
// (CLUE) qui exige un nombre EXACT de lumières adjacentes, Pyra n'a pas
// de quantité fixe: il est "activé" dès qu'il a entre 1 et 3 lumières
// adjacentes (n'importe lequel de ces comptes suffit), et surchargé à 4
// (comme n'importe quelle charge en surcharge). Son identité est une
// instabilité tricolore: une fois activé, il tire un laser dont la
// couleur dépend du nombre de lumières adjacentes — 1=rouge, 2=vert,
// 3=bleu — exactement comme une charge colorée satisfaite, sauf que la
// couleur n'est pas fixée au level-design mais recalculée à chaque passe.
//
// [Expérimental] Neurone miroir (MIRROR_NEURON, token "M"): obstacle fixe
// du niveau (non posable par le joueur). Dès qu'une lumière l'illumine
// (elle est sur sa ligne/colonne, avec ligne de vue directe — même
// logique que l'illumination de base) le neurone la duplique
// AUTOMATIQUEMENT en symétrie centrale par rapport à lui-même (si la
// lumière est à distance d du neurone dans une direction, le duplicata
// apparaît à distance d dans la direction opposée). Si cette case
// symétrique ne peut pas légalement recevoir de lumière (hors-grille,
// case non vide, déjà occupée ou déjà illuminée), alors TOUT le
// mouvement est annulé (toggleLight renvoie false, son d'erreur) —
// on ne pose jamais la lumière d'origine seule sans son duplicata.
// Retirer l'une des deux lumières d'une paire ainsi liée retire l'autre
// avec elle (voir `_mirrorLinks`, `_computeMirrorDuplicates`).
// Limitation connue (acceptable pour une mécanique expérimentale): un
// duplicata qui illuminerait à son tour un AUTRE neurone miroir ne
// déclenche pas de réaction en chaîne — seule la lumière posée par le
// joueur déclenche une recherche de duplication, pas une deuxième fois.

export const CellType = {
  VOID: "void", // hors-grille: bloque la lumière blanche, transparent aux lasers colorés
  WALL: "wall", // mur: bloque la lumière blanche ET les lasers colorés
  EMPTY: "empty", // case vide, peut recevoir une lumière
  CLUE: "clue", // obstacle plein "case à charge" (1 à 4 lumières adjacentes)
  FORBIDDEN: "forbidden", // obstacle plein: aucune lumière adjacente autorisée
  MIRROR: "mirror", // dévie un laser de charge colorée de 90°, opaque au reste
  FILTER: "filter", // ne garde qu'un canal fixe d'un laser coloré qui le traverse
  PRISM: "prism", // colore ses 4 voisins directs, rotation selon lumières adjacentes
  MIRROR_NEURON: "mirror_neuron", // [expérimental] duplique en symétrie toute lumière qui l'éclaire
  PYRA: "pyra", // neurone pyramidal: activé dès 1 lumière adjacente (jusqu'à 3), surcharge à 4
};

// Ordre fixe des directions pour le prisme (gauche, bas, droite, haut) et
// séquence fixe de couleurs qui leur est assignée, avant rotation. Exportés
// pour que render.js puisse reconstruire les couleurs "de base" (rotation
// 0) et les faire pivoter visuellement lui-même (voir prismIcon).
export const PRISM_DIRECTIONS = [
  [0, -1], // gauche
  [1, 0], // bas
  [0, 1], // droite
  [-1, 0], // haut
];
export const PRISM_COLOR_SEQUENCE = ["r", "g", "b", "w"];

// Une case vide peut porter une couleur cible : la lumière blanche de base
// (r,g,b tous vrais) doit ressortir exactement dans cette combinaison une
// fois arrivée sur la case (après mélange éventuel de plusieurs rayons).
const TARGET_CODES = {
  r: { r: true, g: false, b: false },
  g: { r: false, g: true, b: false },
  b: { r: false, g: false, b: true },
  y: { r: true, g: true, b: false }, // jaune = rouge + vert
  c: { r: false, g: true, b: true }, // cyan = vert + bleu
  m: { r: true, g: false, b: true }, // magenta = rouge + bleu
  w: { r: true, g: true, b: true }, // blanc = les trois
};

// Une case à charge ne peut porter qu'une couleur primaire pure.
const CHARGE_COLOR_CODES = { r: "r", g: "g", b: "b" };

// Les tokens d'une rangée sont séparés par des espaces (voir levels.js), ce
// qui permet des tokens à 2 caractères ("2r" = charge 2, couleur rouge)
// sans ambiguïté avec une case-cible seule ("r").
function parseCellToken(token) {
  if (token === "X" || token === "#") return { type: CellType.VOID };
  if (token === "W") return { type: CellType.WALL };
  if (token === ".") return { type: CellType.EMPTY, target: null };
  if (token === "0") return { type: CellType.FORBIDDEN };
  if (token === "/" || token === "\\") return { type: CellType.MIRROR, orientation: token };
  if (TARGET_CODES[token]) return { type: CellType.EMPTY, target: { ...TARGET_CODES[token] } };

  const f = /^F([rgb])$/.exec(token);
  if (f) return { type: CellType.FILTER, filterColor: f[1] };

  const p = /^P([rgbw])?$/.exec(token);
  if (p) return { type: CellType.PRISM, firstColor: p[1] || "r" };

  if (token === "M") return { type: CellType.MIRROR_NEURON };
  if (token === "Y") return { type: CellType.PYRA };

  const m = /^([1-4])([rgb])?$/.exec(token);
  if (m) {
    return {
      type: CellType.CLUE,
      number: Number(m[1]),
      color: m[2] ? CHARGE_COLOR_CODES[m[2]] : null,
    };
  }
  throw new Error(`Code de case inconnu: "${token}"`);
}

const DIRECTIONS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

const WHITE = { r: true, g: true, b: true };

function sameColor(a, b) {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/** Convertit une couleur de charge (lettre unique "r"/"g"/"b") en objet de
 * canaux {r,g,b}, pour pouvoir la faire évoluer (union) au fil des miroirs
 * traversés — une seule lettre ne peut plus représenter un mélange. */
function channelColor(ch) {
  return { r: ch === "r", g: ch === "g", b: ch === "b" };
}

function hasAnyChannel(c) {
  return c.r || c.g || c.b;
}

export class LightUpGrid {
  constructor(level) {
    this.rows = level.rows;
    this.cols = level.cols;
    this.cells = level.cells.map((row) => {
      // Une rangée peut être une chaîne concaténée classique ("2....#",
      // un caractère = une case) ou, si elle contient un espace, une liste de
      // tokens espacés (permet des tokens à 2 caractères comme "2r").
      const tokens = Array.isArray(row)
        ? row
        : row.includes(" ")
        ? row.trim().split(/\s+/)
        : row.split("");
      return tokens.map(parseCellToken);
    });
    this.lights = new Set(); // clés "r,c"
    this.lasers = []; // [{ from:[r,c], to:[r,c], color }] pour le rendu
    // Neurone miroir [expérimental]: graphe non-orienté des paires de
    // lumières liées par une duplication (clé -> Set des clés liées).
    // Retirer une lumière retire toute sa composante connexe (voir
    // toggleLight). Persiste tant que les lumières existent, indépendant
    // de recompute().
    this._mirrorLinks = new Map();
    // Dernier ensemble de cellules affectées par le tout dernier appel à
    // toggleLight/setLightRaw ([{r, c, action}]) — permet à l'appelant
    // (main.js, editor.js) de savoir qu'UN clic a pu poser/retirer
    // PLUSIEURS lumières à la fois (l'origine + ses duplicatas) et de
    // traiter ce groupe comme une seule action atomique (historique
    // d'annulation, persistance des lumières de test dans l'éditeur).
    this._lastAffected = [];
    this.recompute();
  }

  /** Voir `_lastAffected` ci-dessus. */
  getLastAffectedCells() {
    return this._lastAffected;
  }

  key(r, c) {
    return `${r},${c}`;
  }

  inBounds(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  cellAt(r, c) {
    return this.inBounds(r, c) ? this.cells[r][c] : null;
  }

  hasLight(r, c) {
    return this.lights.has(this.key(r, c));
  }

  /**
   * Essaie de poser ou retirer une lumière sur la case (r,c).
   * Retourne "placed", "removed", ou false si l'action est invalide
   * (case non vide, déjà illuminée par une autre lumière, ou — neurone
   * miroir [expérimental] — si une duplication requise est impossible).
   * Voir `getLastAffectedCells()` pour la liste complète des cases
   * effectivement modifiées (peut être plus d'une, voir neurone miroir).
   */
  toggleLight(r, c) {
    const cell = this.cellAt(r, c);
    if (!cell || cell.type !== CellType.EMPTY) return false;

    const k = this.key(r, c);
    if (this.lights.has(k)) {
      const group = this._collectLinkedGroup(k);
      this._lastAffected = [];
      for (const gk of group) {
        this.lights.delete(gk);
        this._mirrorLinks.delete(gk);
        const [gr, gc] = gk.split(",").map(Number);
        this._lastAffected.push({ r: gr, c: gc, action: "removed" });
      }
      for (const links of this._mirrorLinks.values()) {
        for (const gk of group) links.delete(gk);
      }
      this.recompute();
      return "removed";
    }

    if (cell._illuminated) {
      return false; // règle: pas de pose sur une case déjà illuminée
    }

    // Neurone miroir [expérimental]: si poser ici illumine un ou plusieurs
    // neurones miroirs, chacun EXIGE sa duplication symétrique — tout ou
    // rien (voir le commentaire en tête de fichier).
    const duplicates = this._computeMirrorDuplicates(r, c);
    if (duplicates === null) return false;

    this.lights.add(k);
    this._lastAffected = [{ r, c, action: "placed" }];
    if (duplicates.length > 0) {
      const group = [k, ...duplicates];
      for (const dk of duplicates) {
        this.lights.add(dk);
        const [dr, dc] = dk.split(",").map(Number);
        this._lastAffected.push({ r: dr, c: dc, action: "placed" });
      }
      for (const gk of group) {
        const existing = this._mirrorLinks.get(gk) || new Set();
        for (const other of group) if (other !== gk) existing.add(other);
        this._mirrorLinks.set(gk, existing);
      }
    }
    this.recompute();
    return "placed";
  }

  /**
   * Cherche, pour une lumière qu'on voudrait poser en (r,c), tous les
   * neurones miroirs qu'elle illumine directement (premier obstacle
   * rencontré dans chacune des 4 directions) et calcule leur duplicata
   * symétrique (même distance, direction opposée, de l'autre côté du
   * neurone). Retourne la liste des clés "r,c" à dupliquer, ou `null` si
   * au moins une duplication est impossible — dans ce cas l'appelant doit
   * annuler tout le mouvement, pas seulement la duplication en échec.
   */
  _computeMirrorDuplicates(r, c) {
    const duplicates = [];
    const originKey = this.key(r, c);
    for (const [dr, dc] of DIRECTIONS) {
      let nr = r + dr;
      let nc = c + dc;
      while (this.inBounds(nr, nc)) {
        const nCell = this.cells[nr][nc];
        if (nCell.type !== CellType.EMPTY) {
          if (nCell.type === CellType.MIRROR_NEURON) {
            const tr = 2 * nr - r;
            const tc = 2 * nc - c;
            const tk = this.key(tr, tc);
            if (tk !== originKey) {
              const target = this.cellAt(tr, tc);
              if (!target || target.type !== CellType.EMPTY || this.hasLight(tr, tc) || target._illuminated) {
                return null; // case déjà éclairée/occupée, vide (void) ou mur: mouvement impossible
              }
              duplicates.push(tk);
            }
          }
          break; // premier obstacle rencontré dans cette direction
        }
        nr += dr;
        nc += dc;
      }
    }
    return duplicates;
  }

  /** Composante connexe de `k` dans le graphe `_mirrorLinks` (k inclus). */
  _collectLinkedGroup(k) {
    const seen = new Set([k]);
    const stack = [k];
    while (stack.length) {
      const cur = stack.pop();
      const links = this._mirrorLinks.get(cur);
      if (!links) continue;
      for (const other of links) {
        if (!seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    return seen;
  }

  /**
   * Pose ou retire une lumière SANS repasser par les règles de validation
   * de toggleLight (ex: "pas de pose sur une case déjà illuminée", ni la
   * duplication du neurone miroir). Utilisé par l'historique d'annulation:
   * on restaure un état par lequel le joueur est déjà passé (r,c) fait
   * partie d'un groupe déjà entièrement reproduit cellule par cellule par
   * l'appelant, donc on n'a pas à re-vérifier qu'il est atteignable —
   * seulement à le reproduire fidèlement.
   */
  setLightRaw(r, c, on) {
    const k = this.key(r, c);
    if (on) this.lights.add(k);
    else this.lights.delete(k);
    this._lastAffected = [{ r, c, action: on ? "placed" : "removed" }];
    this.recompute();
  }

  /** Compte les lumières/directions libres adjacentes à (r,c) parmi les 4 directions. */
  _adjacentLightCount(r, c) {
    let count = 0;
    for (const [dr, dc] of DIRECTIONS) {
      const nCell = this.cellAt(r + dr, c + dc);
      if (nCell && nCell.type === CellType.EMPTY && this.hasLight(r + dr, c + dc)) count++;
    }
    return count;
  }

  /** Recalcule états des indices/interdictions, lasers de couleur, puis illumination. */
  recompute() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.type === CellType.EMPTY) {
          cell._litColor = { r: false, g: false, b: false };
          cell._litWhite = false;
          cell._hits = 0; // nombre de rayons distincts qui touchent cette case (intersection si >= 2)
        } else if (cell.type === CellType.MIRROR) {
          // Couleurs actuellement en train de traverser ce miroir (rendu:
          // "miroir actif"), recalculé à chaque passe donc jamais périmé.
          cell._mirrorColor = { r: false, g: false, b: false };
        }
      }
    }

    // 1) États des cases à charge / interdites (dépend seulement des positions
    //    des lumières, pas encore de l'illumination).
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];

        if (cell.type === CellType.FORBIDDEN) {
          cell._adjacentLights = this._adjacentLightCount(r, c);
          cell._state = cell._adjacentLights === 0 ? "success" : "error";
          continue;
        }

        if (cell.type === CellType.PYRA) {
          // Pyra n'a pas de quantité fixe à atteindre (contrairement à
          // CLUE) : "activé" dès 1 lumière adjacente, jusqu'à 3 — au-delà
          // c'est la surcharge (4, comme n'importe quelle charge). La
          // couleur du laser qu'il tire dépend du nombre de lumières
          // adjacentes: 1=rouge, 2=vert, 3=bleu (identité tricolore
          // instable qui se "stabilise" sur un canal selon combien de
          // lumières le touchent).
          const adjacentLights = this._adjacentLightCount(r, c);
          cell._adjacentLights = adjacentLights;
          if (adjacentLights === 0) {
            cell._state = "neutral";
            cell._activeColor = null;
          } else if (adjacentLights <= 3) {
            cell._state = "success";
            cell._activeColor = adjacentLights === 1 ? "r" : adjacentLights === 2 ? "g" : "b";
          } else {
            cell._state = "error"; // surcharge à 4
            cell._activeColor = null;
          }
          continue;
        }

        if (cell.type !== CellType.CLUE) continue;

        let adjacentLights = 0;
        let adjacentEmptyFree = 0;
        for (const [dr, dc] of DIRECTIONS) {
          const nCell = this.cellAt(r + dr, c + dc);
          if (!nCell || nCell.type !== CellType.EMPTY) continue;
          if (this.hasLight(r + dr, c + dc)) adjacentLights++;
          else adjacentEmptyFree++;
        }

        // Exposé pour le rendu (pastilles vides/remplies/en surcharge, sans
        // afficher le chiffre lui-même).
        cell._adjacentLights = adjacentLights;

        if (adjacentLights === cell.number) {
          cell._state = "success";
        } else if (adjacentLights > cell.number) {
          cell._state = "error";
        } else if (adjacentEmptyFree === 0) {
          cell._state = "error"; // plus aucune case libre pour atteindre le chiffre
        } else {
          cell._state = "neutral";
        }
      }
    }

    // 2) Lasers de couleur: pour chaque case à charge colorée et satisfaite,
    //    chaque direction qui ne pointe pas vers une lumière tire un laser
    //    jusqu'à la première case-lumière rencontrée sur sa ligne/colonne —
    //    sauf s'il traverse un miroir, qui le dévie de 90° au lieu de
    //    l'arrêter (voir CellType.MIRROR). Le tracé complet (départ +
    //    chaque coude + arrivée) est conservé dans `points` pour le rendu.
    //
    //    Deux passes sont nécessaires pour gérer le mélange de couleurs à
    //    un miroir partagé: si un laser bleu arrive par un côté et un
    //    rouge par l'autre, le miroir devient violet (déjà le cas) ET les
    //    DEUX déviations qui en repartent doivent elles aussi devenir
    //    violettes — pas garder chacune sa couleur d'origine. Or au
    //    moment où on trace le premier rayon, on ne sait pas encore que le
    //    second va aussi traverser ce miroir. Passe A: on trace tous les
    //    rayons (géométrie + accumulation de `_mirrorColor` par miroir,
    //    comme avant) sans encore figer de couleur de rendu. Passe B: une
    //    fois tous les miroirs "vus" par tous les rayons, on rejoue chaque
    //    tracé et sa couleur évolue (union de canaux, jamais de retrait) à
    //    chaque miroir traversé, avec la couleur COMPLÈTE de ce miroir —
    //    pas juste la contribution de ce rayon.
    this.lasers = [];
    const tints = new Map(); // clé lumière -> {r,g,b} accumulé (mélange additif)
    const maxBounces = this.rows * this.cols * 4 + 8; // garde-fou anti-boucle (miroirs en cycle)
    const rawRays = []; // passe A: géométrie brute, couleur pas encore résolue

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        const clueReady = cell.type === CellType.CLUE && cell.color && cell._state === "success";
        const pyraReady = cell.type === CellType.PYRA && cell._state === "success";
        if (!clueReady && !pyraReady) continue;
        // Une charge colorée classique a une couleur fixe ; Pyra la
        // recalcule à chaque passe selon son nombre de lumières
        // adjacentes (voir _activeColor ci-dessus).
        const baseColor = pyraReady ? cell._activeColor : cell.color;

        for (const [dr, dc] of DIRECTIONS) {
          const neighbor = this.cellAt(r + dr, c + dc);
          if (!neighbor) continue; // hors grille: pas de direction à tirer
          if (neighbor.type === CellType.EMPTY && this.hasLight(r + dr, c + dc)) continue; // direction "utilisée"

          let curDr = dr;
          let curDc = dc;
          let nr = r + dr;
          let nc = c + dc;
          const points = [[r, c]];
          let segmentEmpty = null; // dernière case vide du segment courant (reset à chaque coude)
          let hitLight = null;
          let bounces = 0;

          while (this.inBounds(nr, nc)) {
            const nCell = this.cells[nr][nc];

            if (nCell.type === CellType.EMPTY && this.hasLight(nr, nc)) {
              hitLight = [nr, nc];
              break;
            }

            if (nCell.type === CellType.VOID) {
              // Hors-grille: transparent aux lasers colorés (contrairement
              // à la lumière blanche de base, qui elle s'arrête toujours
              // sur toute case non-EMPTY, voir plus bas) — on continue tout
              // droit sans ajouter de point ni casser le segment courant.
              nr += curDr;
              nc += curDc;
              continue;
            }

            if (nCell.type === CellType.MIRROR) {
              points.push([nr, nc]);
              bounces += 1;
              if (bounces > maxBounces) break; // cycle de miroirs: on abandonne ce tracé
              // "/" renvoie (dr,dc) -> (-dc,-dr) ; "" renvoie (dr,dc) -> (dc,dr).
              [curDr, curDc] = nCell.orientation === "/" ? [-curDc, -curDr] : [curDc, curDr];
              nCell._mirrorColor[baseColor] = true; // union des couleurs qui traversent ce miroir
              segmentEmpty = null;
              nr += curDr;
              nc += curDc;
              continue;
            }

            if (nCell.type === CellType.FILTER) {
              // Ne dévie pas (contrairement au miroir) mais marque un point
              // de rupture de couleur dans `points`, pour que la Passe B
              // puisse appliquer le masque de canal à partir d'ici.
              points.push([nr, nc]);
              segmentEmpty = null;
              nr += curDr;
              nc += curDc;
              continue;
            }

            if (nCell.type !== CellType.EMPTY) break; // obstacle opaque: le laser s'arrête ici
            segmentEmpty = [nr, nc];
            nr += curDr;
            nc += curDc;
          }

          if (hitLight) points.push(hitLight);
          else if (segmentEmpty) points.push(segmentEmpty);

          if (points.length > 1) {
            // `points` garde toujours: départ, puis chaque miroir/filtre
            // traversé (dans l'ordre), puis l'arrivée (lumière ou dernière
            // case vide) — jamais de miroir/filtre en dernière position.
            rawRays.push({ points, baseColor, hitLight });
          }
        }
      }
    }

    for (const ray of rawRays) {
      const { points, baseColor, hitLight } = ray;
      let current = channelColor(baseColor);
      const segCount = points.length - 1;
      const colors = new Array(segCount);

      for (let i = 0; i < segCount; i++) {
        colors[i] = current;
        // Le point d'arrivée de ce segment est un miroir ou un filtre sauf
        // s'il s'agit du tout dernier point du tracé (lumière atteinte ou
        // bout de segment vide): un miroir mélange (union) avec TOUT ce qui
        // le traverse actuellement ; un filtre masque (ne garde que son
        // propre canal, quel que soit ce qui entre).
        if (i < segCount - 1) {
          const [wr, wc] = points[i + 1];
          const waypoint = this.cells[wr][wc];
          if (waypoint.type === CellType.MIRROR) {
            const mirrorColor = waypoint._mirrorColor;
            current = {
              r: current.r || mirrorColor.r,
              g: current.g || mirrorColor.g,
              b: current.b || mirrorColor.b,
            };
          } else if (waypoint.type === CellType.FILTER) {
            current = {
              r: current.r && waypoint.filterColor === "r",
              g: current.g && waypoint.filterColor === "g",
              b: current.b && waypoint.filterColor === "b",
            };
          }
        }
      }

      this.lasers.push({ points, colors, connected: !!hitLight });

      if (hitLight) {
        const tk = this.key(hitLight[0], hitLight[1]);
        const t = tints.get(tk) || { r: false, g: false, b: false };
        t.r = t.r || current.r;
        t.g = t.g || current.g;
        t.b = t.b || current.b;
        tints.set(tk, t);
      }
    }

    // 2b) Prismes: case fixe qui colore directement ses 4 voisins (sans
    //     routage ni miroir, juste un contact direct) selon l'ordre fixe
    //     gauche/bas/droite/haut, décalé d'un cran (90°) par lumière
    //     actuellement adjacente au prisme. Alimente le même `tints` que
    //     les lasers de charge (mélange additif identique si une case est
    //     ausside atteinte par un laser par ailleurs), et ajoute un petit
    //     segment "laser" visuel vers chaque voisin actuellement éclairé.
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.type !== CellType.PRISM) continue;

        const adjacentLights = this._adjacentLightCount(r, c);
        cell._prismAdjacentCount = adjacentLights; // lu par render.js pour l'angle de rotation visuel
        const baseIndex = PRISM_COLOR_SEQUENCE.indexOf(cell.firstColor);
        // Deux rotations distinctes:
        // - "appliquée": celle qui a réellement teinté les lumières déjà
        //   posées (la 1ère lumière adjacente ne pivote pas, chaque
        //   lumière SUIVANTE pivote d'un cran de plus) — sert au calcul
        //   du tint, ne doit jamais changer rétroactivement la couleur
        //   d'une lumière déjà posée.
        // - "affichée" sur l'icône: en avance d'un cran sur l'appliquée,
        //   pour montrer où IRA la prochaine couleur plutôt que de
        //   simplement suivre ce qui vient de se passer (le joueur
        //   anticipe, il ne constate pas).
        const appliedRotation = (baseIndex + Math.max(0, adjacentLights - 1)) % PRISM_COLOR_SEQUENCE.length;
        const displayRotation = (baseIndex + adjacentLights) % PRISM_COLOR_SEQUENCE.length;

        const appliedColors = PRISM_DIRECTIONS.map((_, i) => PRISM_COLOR_SEQUENCE[(appliedRotation + i) % 4]);
        cell._prismColors = PRISM_DIRECTIONS.map((_, i) => PRISM_COLOR_SEQUENCE[(displayRotation + i) % 4]);

        PRISM_DIRECTIONS.forEach(([dr, dc], i) => {
          const nr = r + dr;
          const nc = c + dc;
          const neighbor = this.cellAt(nr, nc);
          if (!neighbor || neighbor.type !== CellType.EMPTY || !this.hasLight(nr, nc)) return;

          const letter = appliedColors[i];
          const contributed = TARGET_CODES[letter];
          const tk = this.key(nr, nc);
          const t = tints.get(tk) || { r: false, g: false, b: false };
          t.r = t.r || contributed.r;
          t.g = t.g || contributed.g;
          t.b = t.b || contributed.b;
          tints.set(tk, t);

          this.lasers.push({
            points: [[r, c], [nr, nc]],
            colors: [{ ...contributed }],
            connected: true,
          });
        });
      }
    }

    // 3) Illumination : chaque lumière diffuse sa couleur effective (teinte
    //    reçue par laser, ou blanc par défaut) sur elle-même et ses 4 directions.
    //    Une lumière colorée prend le dessus sur une lumière blanche qui
    //    atteindrait la même case: on accumule donc les contributions
    //    colorées et blanches séparément (un simple OU ferait "avaler" toute
    //    couleur par le blanc, puisque blanc = les trois canaux à vrai).
    for (const k of this.lights) {
      const [r, c] = k.split(",").map(Number);
      const tint = tints.get(k);
      const effective = tint && hasAnyChannel(tint) ? tint : WHITE;
      const colored = effective !== WHITE;

      const mark = (cell) => {
        if (colored) {
          cell._litColor.r = cell._litColor.r || effective.r;
          cell._litColor.g = cell._litColor.g || effective.g;
          cell._litColor.b = cell._litColor.b || effective.b;
        } else {
          cell._litWhite = true;
        }
        cell._hits += 1;
      };

      const selfCell = this.cellAt(r, c);
      if (selfCell) mark(selfCell);

      for (const [dr, dc] of DIRECTIONS) {
        let nr = r + dr;
        let nc = c + dc;
        while (this.inBounds(nr, nc)) {
          const nCell = this.cells[nr][nc];
          if (nCell.type !== CellType.EMPTY) break; // obstacle opaque: le rayon s'arrête
          mark(nCell);
          nr += dr;
          nc += dc;
        }
      }
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.type !== CellType.EMPTY) continue;
        cell._lit = hasAnyChannel(cell._litColor)
          ? cell._litColor
          : cell._litWhite
          ? { ...WHITE }
          : { r: false, g: false, b: false };
        cell._illuminated = cell._lit.r || cell._lit.g || cell._lit.b;
        cell._colorMatch = cell.target ? sameColor(cell._lit, cell.target) : null;
      }
    }
  }

  clueState(r, c) {
    const cell = this.cellAt(r, c);
    return cell && (cell.type === CellType.CLUE || cell.type === CellType.FORBIDDEN)
      ? cell._state
      : null;
  }

  /**
   * `ignoreColor` (utilisé par le solveur pour évaluer l'ambiguïté "sans
   * la couleur") : une case-cible n'a alors besoin que d'être illuminée,
   * sans exiger la couleur exacte. Sert à vérifier qu'un niveau a
   * plusieurs solutions en lumière blanche mais une seule en couleur.
   */
  isWon({ ignoreColor = false } = {}) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.cells[r][c];
        if (cell.type === CellType.EMPTY) {
          if (cell.target && !ignoreColor) {
            if (!cell._colorMatch) return false;
          } else if (!cell._illuminated) {
            return false;
          }
        }
        if (cell.type === CellType.CLUE && cell._state !== "success") return false;
        if (cell.type === CellType.FORBIDDEN && cell._state !== "success") return false;
        if (cell.type === CellType.PYRA && cell._state !== "success") return false;
      }
    }
    return true;
  }
}
