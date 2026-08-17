// Éditeur de niveaux : peinture d'une grille case par case, test en direct
// (bascule vers un vrai LightUpGrid jouable sans quitter l'éditeur),
// sauvegarde locale (localStorage) et export du code à coller dans
// levels.js. Réutilise le même rendu que le jeu (game/render.js) pour que
// l'aperçu et le test ressemblent exactement au jeu final.
import { LightUpGrid } from "./game/grid.js";
import { createBoardRenderer } from "./game/render.js";
import { findSolution } from "./game/solver.js";
import {
  playPlace,
  playRemove,
  playError,
  playWin,
  playTargetSuccess,
  playTargetLost,
  playSynapseBreak,
  playSynapseRestore,
  playChargeFull,
  playChargeEmptied,
  playChargeOverload,
} from "./game/sound.js";

const STORAGE_KEY = "lightup_custom_levels";
const MAX_SIZE = 16;
const MIN_SIZE = 1;

const sounds = {
  targetSuccess: playTargetSuccess,
  targetLost: playTargetLost,
  synapseBreak: playSynapseBreak,
  synapseRestore: playSynapseRestore,
  chargeFull: playChargeFull,
  chargeEmptied: playChargeEmptied,
  chargeOverload: playChargeOverload,
};

function tokenizeRow(row) {
  if (Array.isArray(row)) return row.slice();
  return row.includes(" ") ? row.trim().split(/\s+/) : row.split("");
}

function blankCells(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => "."));
}

function loadCustomLevels() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomLevels(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/**
 * Échappe une chaîne pour l'insérer telle quelle dans un littéral JS entre
 * guillemets doubles. Indispensable pour le miroir ("\\"): sans ça, un
 * antislash brut juste avant un caractère (ou pire, juste avant le
 * guillemet fermant) crée une séquence d'échappement involontaire, qui
 * corrompt silencieusement le token au ré-import — ou casse carrément la
 * chaîne si l'antislash tombe juste avant le "` fermant.
 */
function escapeJsString(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function levelToCode(level) {
  const rowsCode = level.cells
    .map((tokens) => `      "${escapeJsString(tokens.join(" "))}",`)
    .join("\n");
  const name = escapeJsString(level.name);
  return `  {\n    name: "${name}",\n    rows: ${level.rows},\n    cols: ${level.cols},\n    cells: [\n${rowsCode}\n    ],\n  },`;
}

/**
 * Inverse de levelToCode(): évalue le code collé (objet JS littéral, tel que
 * généré par Exporter — pas du JSON strict, d'où l'usage de `Function`
 * plutôt que `JSON.parse`) et le valide. Retourne `{ level }` en cas de
 * succès (avec `note` optionnelle si le collage contenait un tableau de
 * plusieurs niveaux — seul le premier est importé) ou `{ error }` sinon.
 * N'écrit rien dans l'éditeur: c'est à l'appelant de décider quoi faire du
 * résultat (voir le bouton "Charger ce niveau").
 */
function parseLevelFromCode(rawText) {
  const text = rawText.trim().replace(/,\s*$/, "");
  if (!text) return { error: "Rien à importer : colle d'abord le code d'un niveau." };

  let parsed;
  try {
    // eslint-disable-next-line no-new-func
    parsed = new Function(`"use strict"; return (\n${text}\n);`)();
  } catch (e) {
    return { error: `Code JS invalide : ${e.message}` };
  }

  let note = "";
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { error: "Le tableau collé ne contient aucun niveau." };
    if (parsed.length > 1) note = ` (${parsed.length} niveaux collés, seul le premier a été importé)`;
    parsed = parsed[0];
  }

  if (!parsed || typeof parsed !== "object") {
    return { error: "Le code collé ne décrit pas un objet de niveau." };
  }
  const { name, rows, cols, cells } = parsed;
  if (typeof name !== "string") return { error: 'Champ "name" manquant ou invalide (doit être une chaîne).' };
  if (!Number.isInteger(rows) || rows < 1) return { error: 'Champ "rows" manquant ou invalide (entier positif attendu).' };
  if (!Number.isInteger(cols) || cols < 1) return { error: 'Champ "cols" manquant ou invalide (entier positif attendu).' };
  if (!Array.isArray(cells) || cells.length !== rows) {
    return { error: `Champ "cells" invalide : attendu un tableau de ${rows} ligne${rows === 1 ? "" : "s"}, trouvé ${Array.isArray(cells) ? cells.length : "rien"}.` };
  }

  const tokenRows = cells.map((row) => tokenizeRow(row));
  for (let r = 0; r < tokenRows.length; r++) {
    if (tokenRows[r].length !== cols) {
      return { error: `Ligne ${r + 1} : ${tokenRows[r].length} case${tokenRows[r].length === 1 ? "" : "s"} au lieu de ${cols} attendues.` };
    }
  }

  // Valide que chaque token est un code de case reconnu, en construisant
  // une vraie grille jouable (LightUpGrid lève une erreur explicite sur un
  // token inconnu — on récupère ce message tel quel plutôt que de
  // dupliquer la liste des codes valides ici).
  try {
    new LightUpGrid({ name, rows, cols, cells: tokenRows.map((tokens) => tokens.join(" ")) });
  } catch (e) {
    return { error: `Case invalide dans la grille : ${e.message}` };
  }

  return { level: { name, rows, cols, cells: tokenRows }, note };
}

export function initEditor({ levels }) {
  const boardEl = document.getElementById("editor-board");
  const nameInput = document.getElementById("ed-name");
  const rowsInput = document.getElementById("ed-rows");
  const colsInput = document.getElementById("ed-cols");
  const resizeBtn = document.getElementById("ed-resize");
  // Deux groupes de boutons-outils (courants + expérimentaux, voir
  // index.html): on les traite comme un seul ensemble pour le câblage des
  // clics et la mise en surbrillance de l'outil actif.
  const toolBtns = document.querySelectorAll("#ed-tools .tool-btn, #ed-tools-experimental .tool-btn");
  const chargeOptions = document.getElementById("ed-charge-options");
  const chargeNumberSel = document.getElementById("ed-charge-number");
  const chargeColorSel = document.getElementById("ed-charge-color");
  const targetOptions = document.getElementById("ed-target-options");
  const targetColorSel = document.getElementById("ed-target-color");
  const mirrorOptions = document.getElementById("ed-mirror-options");
  const mirrorOrientationSel = document.getElementById("ed-mirror-orientation");
  const filterOptions = document.getElementById("ed-filter-options");
  const filterColorSel = document.getElementById("ed-filter-color");
  const prismOptions = document.getElementById("ed-prism-options");
  const prismFirstColorSel = document.getElementById("ed-prism-first-color");
  const testBtn = document.getElementById("ed-test");
  const testResetBtn = document.getElementById("ed-test-reset");
  const insertRowTopBtn = document.getElementById("ed-insert-row-top");
  const removeRowTopBtn = document.getElementById("ed-remove-row-top");
  const insertRowBottomBtn = document.getElementById("ed-insert-row-bottom");
  const removeRowBottomBtn = document.getElementById("ed-remove-row-bottom");
  const insertColLeftBtn = document.getElementById("ed-insert-col-left");
  const removeColLeftBtn = document.getElementById("ed-remove-col-left");
  const insertColRightBtn = document.getElementById("ed-insert-col-right");
  const removeColRightBtn = document.getElementById("ed-remove-col-right");
  const solveBtn = document.getElementById("ed-solve");
  const newBtn = document.getElementById("ed-new");
  const saveBtn = document.getElementById("ed-save");
  const deleteBtn = document.getElementById("ed-delete");
  const exportBtn = document.getElementById("ed-export");
  const importBtn = document.getElementById("ed-import");
  const importPanel = document.getElementById("ed-import-panel");
  const importInput = document.getElementById("ed-import-input");
  const importConfirmBtn = document.getElementById("ed-import-confirm");
  const importCancelBtn = document.getElementById("ed-import-cancel");
  const levelListSel = document.getElementById("ed-level-list");
  const templateListSel = document.getElementById("ed-template-list");
  const exportOutput = document.getElementById("ed-export-output");
  const statusEl = document.getElementById("ed-status");

  const renderer = createBoardRenderer(boardEl);

  let customLevels = loadCustomLevels();
  // Un niveau tout neuf n'a pas de nom par défaut: le champ est
  // obligatoire pour sauvegarder/exporter (voir saveBtn/exportBtn), donc
  // pas la peine de pré-remplir un nom générique qu'on oublierait de
  // changer.
  let editLevel = { name: "", rows: 5, cols: 5, cells: blankCells(5, 5) };
  let selectedTool = "empty";
  let testMode = false;
  let testGrid = null;
  let testLights = new Set(); // clés "r,c", persistantes entre bascules Édition/Test
  let currentCustomIndex = -1; // index dans customLevels si un niveau sauvegardé est chargé

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function refreshLevelList() {
    levelListSel.innerHTML = '<option value="">— nouveau —</option>';
    customLevels.forEach((lvl, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = lvl.name;
      levelListSel.appendChild(opt);
    });
    levelListSel.value = currentCustomIndex >= 0 ? String(currentCustomIndex) : "";
  }

  function refreshTemplateList() {
    templateListSel.innerHTML = '<option value="">— charger un niveau du jeu —</option>';
    levels.forEach((lvl, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `${i + 1}. ${lvl.name}`;
      templateListSel.appendChild(opt);
    });
  }

  function tokenAt(r, c) {
    return editLevel.cells[r][c];
  }

  function setTokenAt(r, c, token) {
    editLevel.cells[r][c] = token;
  }

  function toolToToken() {
    switch (selectedTool) {
      case "empty":
        return ".";
      case "void":
        return "X";
      case "wall":
        return "W";
      case "forbidden":
        return "0";
      case "charge": {
        const n = chargeNumberSel.value;
        const col = chargeColorSel.value;
        return col ? `${n}${col}` : n;
      }
      case "target":
        return targetColorSel.value;
      case "mirror":
        return mirrorOrientationSel.value;
      case "filter":
        return `F${filterColorSel.value}`;
      case "prism":
        return `P${prismFirstColorSel.value}`;
      case "mirror_neuron":
        return "M";
      case "pyra":
        return "Y";
      default:
        return ".";
    }
  }

  function buildLevelObject() {
    return {
      name: editLevel.name,
      rows: editLevel.rows,
      cols: editLevel.cols,
      cells: editLevel.cells.map((row) => row.join(" ")),
    };
  }

  function rebuildEditGrid() {
    const grid = new LightUpGrid(buildLevelObject());
    boardEl.classList.toggle("board--paint", !testMode);
    if (testMode) {
      for (const k of Array.from(testLights)) {
        const [r, c] = k.split(",").map(Number);
        // Une case déjà allumée par une entrée précédente de CE MÊME
        // replay (neurone miroir [expérimental]: son duplicata a pu être
        // posé automatiquement par une autre clé de testLights juste
        // avant) ne doit pas être re-togglée: ça l'éteindrait au lieu de
        // confirmer son état.
        if (grid.hasLight(r, c)) continue;
        if (!grid.toggleLight(r, c)) testLights.delete(k);
      }
    }
    renderer.build(grid, {
      onCellClick: handleCellClick,
      sounds: testMode ? sounds : {},
      clickableAll: !testMode,
    });
    if (testMode) testGrid = grid;
  }

  function handleCellClick(r, c) {
    if (testMode) {
      const result = testGrid.toggleLight(r, c);
      if (result === "placed" || result === "removed") {
        // Voir main.js: un clic peut affecter plusieurs cases à la fois
        // (neurone miroir [expérimental]) — il faut TOUTES les refléter
        // dans testLights pour que la persistance Édition/Test (voir
        // rebuildEditGrid) reproduise fidèlement le duplicata, pas
        // seulement la case cliquée.
        for (const cell of testGrid.getLastAffectedCells()) {
          const k = `${cell.r},${cell.c}`;
          if (cell.action === "placed") testLights.add(k);
          else testLights.delete(k);
        }
      }
      if (result === "placed") playPlace();
      else if (result === "removed") playRemove();
      else playError();
      renderer.render();
      if (testGrid.isWon()) {
        playWin();
        setStatus("Résolu ! Repasse en édition pour continuer à ajuster ce niveau.");
      }
      return;
    }
    setTokenAt(r, c, toolToToken());
    rebuildEditGrid();
  }

  function setTool(tool) {
    selectedTool = tool;
    toolBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    chargeOptions.classList.toggle("hidden", tool !== "charge");
    targetOptions.classList.toggle("hidden", tool !== "target");
    mirrorOptions.classList.toggle("hidden", tool !== "mirror");
    filterOptions.classList.toggle("hidden", tool !== "filter");
    prismOptions.classList.toggle("hidden", tool !== "prism");
  }

  toolBtns.forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });
  chargeNumberSel.addEventListener("change", () => setTool("charge"));
  chargeColorSel.addEventListener("change", () => setTool("charge"));
  targetColorSel.addEventListener("change", () => setTool("target"));
  mirrorOrientationSel.addEventListener("change", () => setTool("mirror"));
  filterColorSel.addEventListener("change", () => setTool("filter"));
  prismFirstColorSel.addEventListener("change", () => setTool("prism"));

  function guardStructureEdit() {
    if (testMode) {
      setStatus("Repasse en édition pour modifier la grille.");
      return false;
    }
    return true;
  }

  resizeBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    const rows = Math.min(MAX_SIZE, Math.max(MIN_SIZE, parseInt(rowsInput.value, 10) || editLevel.rows));
    const cols = Math.min(MAX_SIZE, Math.max(MIN_SIZE, parseInt(colsInput.value, 10) || editLevel.cols));
    const next = blankCells(rows, cols);
    for (let r = 0; r < Math.min(rows, editLevel.rows); r++) {
      for (let c = 0; c < Math.min(cols, editLevel.cols); c++) {
        next[r][c] = editLevel.cells[r][c];
      }
    }
    editLevel.rows = rows;
    editLevel.cols = cols;
    editLevel.cells = next;
    rowsInput.value = rows;
    colsInput.value = cols;
    testLights.clear();
    rebuildEditGrid();
    setStatus(`Grille redimensionnée en ${rows}×${cols}.`);
  });

  // Le redimensionnement ci-dessus n'ajoute/retire de l'espace qu'en bas et
  // à droite (ancré en haut-à-gauche). Ces 4 actions permettent d'insérer
  // ou de retirer une ligne/colonne en haut/à gauche sans devoir tout
  // redessiner : elles décalent le contenu existant plutôt que de le
  // laisser en place.
  insertRowTopBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.rows >= MAX_SIZE) {
      setStatus("Taille maximale atteinte.");
      return;
    }
    editLevel.cells.unshift(Array.from({ length: editLevel.cols }, () => "."));
    editLevel.rows += 1;
    rowsInput.value = editLevel.rows;
    testLights.clear();
    rebuildEditGrid();
    setStatus("Ligne ajoutée en haut.");
  });

  removeRowTopBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.rows <= MIN_SIZE) {
      setStatus("Impossible de retirer la dernière ligne.");
      return;
    }
    editLevel.cells.shift();
    editLevel.rows -= 1;
    rowsInput.value = editLevel.rows;
    testLights.clear();
    rebuildEditGrid();
    setStatus("Ligne du haut retirée.");
  });

  insertColLeftBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.cols >= MAX_SIZE) {
      setStatus("Taille maximale atteinte.");
      return;
    }
    editLevel.cells.forEach((row) => row.unshift("."));
    editLevel.cols += 1;
    colsInput.value = editLevel.cols;
    testLights.clear();
    rebuildEditGrid();
    setStatus("Colonne ajoutée à gauche.");
  });

  removeColLeftBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.cols <= MIN_SIZE) {
      setStatus("Impossible de retirer la dernière colonne.");
      return;
    }
    editLevel.cells.forEach((row) => row.shift());
    editLevel.cols -= 1;
    colsInput.value = editLevel.cols;
    testLights.clear();
    rebuildEditGrid();
    setStatus("Colonne de gauche retirée.");
  });

  // Symétriques des 4 actions ci-dessus, pour bas/droite (jusqu'ici seul
  // le redimensionnement du bouton "Redimensionner" pouvait agrandir de
  // ce côté, sans pouvoir RETIRER une ligne/colonne bas/droite sans tout
  // redessiner).
  insertRowBottomBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.rows >= MAX_SIZE) {
      setStatus("Taille maximale atteinte.");
      return;
    }
    editLevel.cells.push(Array.from({ length: editLevel.cols }, () => "."));
    editLevel.rows += 1;
    rowsInput.value = editLevel.rows;
    testLights.clear();
    rebuildEditGrid();
    setStatus("Ligne ajoutée en bas.");
  });

  removeRowBottomBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.rows <= MIN_SIZE) {
      setStatus("Impossible de retirer la dernière ligne.");
      return;
    }
    editLevel.cells.pop();
    editLevel.rows -= 1;
    rowsInput.value = editLevel.rows;
    testLights.clear();
    rebuildEditGrid();
    setStatus("Ligne du bas retirée.");
  });

  insertColRightBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.cols >= MAX_SIZE) {
      setStatus("Taille maximale atteinte.");
      return;
    }
    editLevel.cells.forEach((row) => row.push("."));
    editLevel.cols += 1;
    colsInput.value = editLevel.cols;
    testLights.clear();
    rebuildEditGrid();
    setStatus("Colonne ajoutée à droite.");
  });

  removeColRightBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.cols <= MIN_SIZE) {
      setStatus("Impossible de retirer la dernière colonne.");
      return;
    }
    editLevel.cells.forEach((row) => row.pop());
    editLevel.cols -= 1;
    colsInput.value = editLevel.cols;
    testLights.clear();
    rebuildEditGrid();
    setStatus("Colonne de droite retirée.");
  });

  testResetBtn.addEventListener("click", () => {
    testLights.clear();
    if (testMode) {
      rebuildEditGrid();
      setStatus("Test réinitialisé : toutes les lumières ont été retirées.");
    } else {
      setStatus("L'avancée du test a été réinitialisée.");
    }
  });

  nameInput.addEventListener("input", () => {
    // Le nom est obligatoire pour sauvegarder/exporter (voir saveBtn et
    // exportBtn) : on laisse le champ vide tel quel plutôt que de
    // retomber sur un nom générique qui masquerait l'obligation.
    editLevel.name = nameInput.value;
  });

  function loadLevelIntoEditor(level, customIndex = -1) {
    editLevel = {
      name: level.name,
      rows: level.rows,
      cols: level.cols,
      cells: level.cells.map((row) => tokenizeRow(row)),
    };
    currentCustomIndex = customIndex;
    nameInput.value = editLevel.name;
    rowsInput.value = editLevel.rows;
    colsInput.value = editLevel.cols;
    testMode = false;
    testLights = new Set();
    testBtn.textContent = "Tester";
    solveBtn.disabled = true;
    exportOutput.classList.add("hidden");
    importPanel.classList.add("hidden");
    rebuildEditGrid();
    refreshLevelList();
  }

  newBtn.addEventListener("click", () => {
    loadLevelIntoEditor({ name: "", rows: 5, cols: 5, cells: blankCells(5, 5) });
    setStatus("Nouveau niveau vierge. Donne-lui un nom avant de le sauvegarder ou de l'exporter.");
  });

  testBtn.addEventListener("click", () => {
    testMode = !testMode;
    testBtn.textContent = testMode ? "Éditer" : "Tester";
    // Le solveur n'a de sens qu'en mode test (voir solveBtn ci-dessous):
    // grisé en édition pour éviter de suggérer qu'il modifierait le
    // niveau lui-même.
    solveBtn.disabled = !testMode;
    setStatus(testMode ? "Mode test : clique pour poser/retirer une lumière." : "Mode édition.");
    rebuildEditGrid();
  });

  solveBtn.addEventListener("click", () => {
    if (!testMode) return;
    setStatus("Recherche d'une solution…");
    const solution = findSolution(buildLevelObject(), 300_000);
    if (!solution) {
      setStatus("Aucune solution trouvée (niveau insoluble en l'état, ou trop complexe pour le solveur).");
      return;
    }
    testLights = new Set(solution.map(([r, c]) => `${r},${c}`));
    rebuildEditGrid();
    setStatus(`Solution posée automatiquement : ${solution.length} lumière${solution.length === 1 ? "" : "s"}.`);
    if (testGrid.isWon()) playWin();
  });

  saveBtn.addEventListener("click", () => {
    if (!editLevel.name.trim()) {
      setStatus("Donne un nom au niveau avant de sauvegarder.");
      return;
    }
    const toSave = buildLevelObject();
    toSave.cells = editLevel.cells.map((row) => row.join(" "));
    if (currentCustomIndex >= 0) {
      customLevels[currentCustomIndex] = toSave;
    } else {
      customLevels.push(toSave);
      currentCustomIndex = customLevels.length - 1;
    }
    saveCustomLevels(customLevels);
    refreshLevelList();
    setStatus(`Niveau "${toSave.name}" sauvegardé.`);
  });

  deleteBtn.addEventListener("click", () => {
    if (currentCustomIndex < 0) {
      setStatus("Ce niveau n'est pas sauvegardé, rien à supprimer.");
      return;
    }
    const removed = customLevels.splice(currentCustomIndex, 1)[0];
    saveCustomLevels(customLevels);
    currentCustomIndex = -1;
    refreshLevelList();
    setStatus(`Niveau "${removed.name}" supprimé.`);
  });

  exportBtn.addEventListener("click", () => {
    if (!editLevel.name.trim()) {
      setStatus("Donne un nom au niveau avant de l'exporter.");
      return;
    }
    // levelToCode attend des cellules en tableaux de tokens (comme
    // editLevel.cells), pas les chaînes déjà jointes que renvoie
    // buildLevelObject() pour LightUpGrid.
    const code = levelToCode({
      name: editLevel.name,
      rows: editLevel.rows,
      cols: editLevel.cols,
      cells: editLevel.cells,
    });
    exportOutput.value = code;
    exportOutput.classList.remove("hidden");
    importPanel.classList.add("hidden");
    exportOutput.focus();
    exportOutput.select();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(
        () => setStatus("Code copié dans le presse-papiers (et affiché ci-dessous)."),
        () => setStatus("Code affiché ci-dessous — copie-le manuellement.")
      );
    } else {
      setStatus("Code affiché ci-dessous — copie-le manuellement.");
    }
  });

  // Importer: colle le code d'un niveau (typiquement le résultat
  // d'Exporter, ou une entrée copiée depuis levels.js) et le charge dans
  // l'éditeur comme point de départ — pas encore sauvegardé, exactement
  // comme "Repartir d'un niveau du jeu" (voir templateListSel ci-dessous):
  // currentCustomIndex reste à -1 tant que le joueur n'a pas cliqué
  // "Sauvegarder" lui-même, pour ne jamais écraser silencieusement un
  // niveau existant du même nom.
  importBtn.addEventListener("click", () => {
    importPanel.classList.remove("hidden");
    exportOutput.classList.add("hidden");
    importInput.value = "";
    importInput.focus();
    setStatus("Colle le code d'un niveau ci-dessous, puis clique \"Charger ce niveau\".");
  });

  importCancelBtn.addEventListener("click", () => {
    importPanel.classList.add("hidden");
    importInput.value = "";
    setStatus("Import annulé.");
  });

  importConfirmBtn.addEventListener("click", () => {
    const { level, note, error } = parseLevelFromCode(importInput.value);
    if (error) {
      setStatus(`Import impossible : ${error}`);
      return;
    }
    loadLevelIntoEditor(level, -1);
    importPanel.classList.add("hidden");
    importInput.value = "";
    setStatus(`Niveau "${level.name || "(sans nom)"}" importé — pas encore sauvegardé.${note || ""}`);
  });

  levelListSel.addEventListener("change", () => {
    const val = levelListSel.value;
    if (val === "") {
      newBtn.click();
      return;
    }
    const idx = parseInt(val, 10);
    loadLevelIntoEditor(customLevels[idx], idx);
    setStatus(`Niveau "${customLevels[idx].name}" chargé.`);
  });

  templateListSel.addEventListener("change", () => {
    const val = templateListSel.value;
    if (val === "") return;
    const idx = parseInt(val, 10);
    const lvl = levels[idx];
    loadLevelIntoEditor({ name: `${lvl.name} (copie)`, rows: lvl.rows, cols: lvl.cols, cells: lvl.cells }, -1);
    setStatus(`Niveau "${lvl.name}" chargé comme point de départ (pas encore sauvegardé).`);
    templateListSel.value = "";
  });

  setTool("empty");
  refreshTemplateList();
  refreshLevelList();

  return {
    onShow() {
      refreshLevelList();
      rebuildEditGrid();
    },
  };
}
