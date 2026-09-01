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
import {
  validatePlayableLevel,
  publishLevel,
  isDuplicatePublication,
  DEFAULT_AVATAR,
  getAvatarSvg,
} from "./game/community-store.js";
import { loadProfile } from "./game/storage.js";

const STORAGE_KEY = "lightup_custom_levels";
const MAX_SIZE = 16;
const MIN_SIZE = 1;

// Icônes du bouton Tester/Éditer (voir index.html: markup initial identique
// à PLAY_ICON) — permutées via innerHTML plutôt que deux <svg> imbriqués,
// même approche que #btn-infinite-next/#btn-reset (voir main.js) pour rester
// cohérent avec le reste de l'appli.
const PLAY_ICON = '<svg viewBox="0 0 24 24" class="icon-svg" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>';
const EDIT_ICON = '<svg viewBox="0 0 24 24" class="icon-svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>';

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
  // Conteneur dont dépend le layout plein écran mobile (voir style.css:
  // #editor-view.editor--testing) — bascule entre "panneau d'onglets +
  // plateau borné" (édition) et "plateau plein écran" (test), exactement
  // comme le vrai plateau de jeu.
  const editorViewEl = document.getElementById("editor-view");
  const nameInput = document.getElementById("ed-name");
  // ed-rows/ed-cols: <input type="hidden"> depuis le round 17 (retour
  // utilisateur: retrait du formulaire Lignes/Colonnes tapable + bouton
  // Appliquer) — gardés uniquement comme mémoire technique pour le code
  // ci-dessous qui continue d'y écrire après chaque insertion/retrait de
  // ligne/colonne, sans plus jamais être affichés (voir index.html).
  const rowsInput = document.getElementById("ed-rows");
  const colsInput = document.getElementById("ed-cols");
  const sizeReadoutEl = document.getElementById("ed-size-readout");
  const tabBtns = document.querySelectorAll(".editor-tab-btn");
  const tabSections = document.querySelectorAll(".editor-tab");
  // Round 17: les tuiles "expérimentales" ont été fusionnées dans la même
  // palette #ed-tools (plus d'onglet séparé, voir index.html) — un seul
  // sélecteur suffit désormais.
  const toolBtns = document.querySelectorAll("#ed-tools .tool-btn");
  const chargeOptions = document.getElementById("ed-charge-options");
  const chargeNumberSel = document.getElementById("ed-charge-number");
  const chargeColorSel = document.getElementById("ed-charge-color");
  const targetOptions = document.getElementById("ed-target-options");
  const targetColorSel = document.getElementById("ed-target-color");
  const mirrorOptions = document.getElementById("ed-mirror-options");
  const mirrorOrientationSel = document.getElementById("ed-mirror-orientation");
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
  const publishBtn = document.getElementById("ed-publish");
  const publishModal = document.getElementById("editor-publish-modal");
  const publishAuthorPreviewEl = document.getElementById("editor-publish-author-preview");
  const publishTitleInput = document.getElementById("editor-publish-title");
  const publishStatusEl = document.getElementById("editor-publish-status");
  const publishConfirmBtn = document.getElementById("btn-editor-publish-confirm");
  const importBtn = document.getElementById("ed-import");
  const importPanel = document.getElementById("ed-import-panel");
  const importInput = document.getElementById("ed-import-input");
  const importConfirmBtn = document.getElementById("ed-import-confirm");
  const importCancelBtn = document.getElementById("ed-import-cancel");
  const levelListSel = document.getElementById("ed-level-list");
  const exportOutput = document.getElementById("ed-export-output");
  const importStatusEl = document.getElementById("ed-import-status");

  const renderer = createBoardRenderer(boardEl);

  let customLevels = loadCustomLevels();
  // Un niveau tout neuf n'a pas de nom par défaut. Round 19 (retour
  // utilisateur): le nom n'est plus obligatoire pour Sauvegarder (il le
  // reste pour Exporter — le code généré a besoin d'un vrai nom pour
  // levels.js) — voir saveBtn: un niveau sauvegardé sans nom obtient un ID +
  // une date, affichés comme nom généré dans "Mes niveaux" (voir
  // refreshLevelList/autoLevelName), sans jamais écrire cette valeur dans
  // `name` lui-même.
  let editLevel = { name: "", rows: 5, cols: 5, cells: blankCells(5, 5) };
  let selectedTool = "empty";
  let testMode = false;
  let testGrid = null;
  let testLights = new Set(); // clés "r,c", persistantes entre bascules Édition/Test
  let currentCustomIndex = -1; // index dans customLevels si un niveau sauvegardé est chargé

  /** Nom affiché dans "Mes niveaux" pour un niveau SANS vrai nom — dérivé de
   * sa date de création (voir saveBtn: `createdAt` posé au tout premier
   * enregistrement). Jamais stocké dans `lvl.name` lui-même (retour
   * utilisateur: "pas de vrai nom enregistré [...] c'est comme si il
   * n'existait aucun nom") — recalculé à chaque affichage de la liste. */
  function autoLevelName(lvl) {
    if (!lvl.createdAt) return "Niveau sans nom";
    const d = new Date(lvl.createdAt);
    const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `Niveau du ${date} ${time}`;
  }

  // Round 18 (retour utilisateur): #ed-status ("juste un texte de la
  // dernière action effectuée") est retiré — la plupart des actions de
  // l'éditeur sont déjà visibles directement dans la grille/le panneau
  // (une ligne ajoutée, une solution qui s'affiche...), ce texte ne faisait
  // que dupliquer ce qui se voit déjà. Les deux cas où une action pouvait
  // échouer SILENCIEUSEMENT sans lui (nom manquant à l'export, import
  // invalide) ont chacun leur propre remplacement ciblé : markNameError()
  // ci-dessous pour le premier, importStatusEl pour le second (voir plus
  // bas).
  function markNameError(shake = true) {
    nameInput.classList.add("input-error");
    if (shake) {
      nameInput.classList.remove("input-error--shake");
      // eslint-disable-next-line no-unused-expressions
      nameInput.offsetWidth; // force un reflow pour rejouer l'animation même si elle vient déjà de tourner
      nameInput.classList.add("input-error--shake");
      nameInput.focus();
    }
  }

  function clearNameError() {
    nameInput.classList.remove("input-error", "input-error--shake");
  }

  // Onglets du bas (Format grille / Features / Expérimentales / Options,
  // voir index.html: .editor-tabbar) : un seul visible à la fois, purement
  // de la présentation — aucun état de l'édition elle-même n'en dépend.
  function setActiveTab(tab) {
    tabBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.tabTarget === tab));
    tabSections.forEach((section) => section.classList.toggle("hidden", section.dataset.tab !== tab));
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tabTarget));
  });

  function updateSizeReadout() {
    sizeReadoutEl.textContent = `${editLevel.rows}×${editLevel.cols}`;
  }

  function refreshLevelList() {
    levelListSel.innerHTML = '<option value="">— nouveau —</option>';
    customLevels.forEach((lvl, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = lvl.name?.trim() || autoLevelName(lvl);
      levelListSel.appendChild(opt);
    });
    levelListSel.value = currentCustomIndex >= 0 ? String(currentCustomIndex) : "";
    // Round 18 (retour utilisateur): bouton Supprimer désactivé plutôt que
    // message d'échec — currentCustomIndex est toujours à jour juste avant
    // chaque appel à refreshLevelList (voir loadLevelIntoEditor/saveBtn/
    // deleteBtn), donc un seul endroit suffit à garder l'état du bouton
    // synchronisé.
    deleteBtn.disabled = currentCustomIndex < 0;
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
    updateSizeReadout();
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
      // Voir main.js: même animation éphémère de neurone miroir
      // [expérimental] en test qu'en jeu normal.
      if (result === "placed") {
        const links = testGrid.getLastMirrorLinks();
        if (links.length) renderer.playMirrorSuccess(links);
      } else if (result === false) {
        const failure = testGrid.getLastMirrorFailure();
        if (failure) renderer.playMirrorFailure(failure);
      }
      if (testGrid.isWon()) {
        playWin();
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
    prismOptions.classList.toggle("hidden", tool !== "prism");
  }

  toolBtns.forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });
  chargeNumberSel.addEventListener("change", () => setTool("charge"));
  chargeColorSel.addEventListener("change", () => setTool("charge"));
  targetColorSel.addEventListener("change", () => setTool("target"));
  mirrorOrientationSel.addEventListener("change", () => setTool("mirror"));
  prismFirstColorSel.addEventListener("change", () => setTool("prism"));

  function guardStructureEdit() {
    return !testMode;
  }

  // Ces 4 actions permettent d'insérer
  // ou de retirer une ligne/colonne en haut/à gauche sans devoir tout
  // redessiner : elles décalent le contenu existant plutôt que de le
  // laisser en place.
  insertRowTopBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.rows >= MAX_SIZE) return;
    editLevel.cells.unshift(Array.from({ length: editLevel.cols }, () => "."));
    editLevel.rows += 1;
    rowsInput.value = editLevel.rows;
    testLights.clear();
    rebuildEditGrid();
  });

  removeRowTopBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.rows <= MIN_SIZE) return;
    editLevel.cells.shift();
    editLevel.rows -= 1;
    rowsInput.value = editLevel.rows;
    testLights.clear();
    rebuildEditGrid();
  });

  insertColLeftBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.cols >= MAX_SIZE) return;
    editLevel.cells.forEach((row) => row.unshift("."));
    editLevel.cols += 1;
    colsInput.value = editLevel.cols;
    testLights.clear();
    rebuildEditGrid();
  });

  removeColLeftBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.cols <= MIN_SIZE) return;
    editLevel.cells.forEach((row) => row.shift());
    editLevel.cols -= 1;
    colsInput.value = editLevel.cols;
    testLights.clear();
    rebuildEditGrid();
  });

  // Symétriques des 4 actions ci-dessus, pour bas/droite (jusqu'ici seul
  // le redimensionnement du bouton "Redimensionner" pouvait agrandir de
  // ce côté, sans pouvoir RETIRER une ligne/colonne bas/droite sans tout
  // redessiner).
  insertRowBottomBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.rows >= MAX_SIZE) return;
    editLevel.cells.push(Array.from({ length: editLevel.cols }, () => "."));
    editLevel.rows += 1;
    rowsInput.value = editLevel.rows;
    testLights.clear();
    rebuildEditGrid();
  });

  removeRowBottomBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.rows <= MIN_SIZE) return;
    editLevel.cells.pop();
    editLevel.rows -= 1;
    rowsInput.value = editLevel.rows;
    testLights.clear();
    rebuildEditGrid();
  });

  insertColRightBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.cols >= MAX_SIZE) return;
    editLevel.cells.forEach((row) => row.push("."));
    editLevel.cols += 1;
    colsInput.value = editLevel.cols;
    testLights.clear();
    rebuildEditGrid();
  });

  removeColRightBtn.addEventListener("click", () => {
    if (!guardStructureEdit()) return;
    if (editLevel.cols <= MIN_SIZE) return;
    editLevel.cells.forEach((row) => row.pop());
    editLevel.cols -= 1;
    colsInput.value = editLevel.cols;
    testLights.clear();
    rebuildEditGrid();
  });

  testResetBtn.addEventListener("click", () => {
    testLights.clear();
    if (testMode) rebuildEditGrid();
  });

  nameInput.addEventListener("input", () => {
    // Le nom est obligatoire pour sauvegarder/exporter/publier (voir
    // saveBtn/exportBtn/publishBtn) : on laisse le champ vide tel quel
    // plutôt que de retomber sur un nom générique qui masquerait
    // l'obligation. Dès que le joueur tape quelque chose, l'état d'erreur
    // (voir markNameError) n'a plus lieu d'être.
    editLevel.name = nameInput.value;
    if (nameInput.value.trim()) clearNameError();
  });

  // Centralise tout ce qui dépend du mode Test (icône Play/Edit du header,
  // visibilité de Résoudre/Réinitialiser le test, et la classe qui fait
  // passer le plateau en plein écran — voir style.css:
  // #editor-view.editor--testing) : un seul endroit à mettre à jour plutôt
  // que de dupliquer ces 5 effets à chaque appelant (toggle manuel, retour
  // au mode édition via loadLevelIntoEditor, etc.).
  function setTestMode(active) {
    testMode = active;
    testBtn.innerHTML = testMode ? EDIT_ICON : PLAY_ICON;
    testBtn.setAttribute("aria-label", testMode ? "Éditer" : "Tester");
    testBtn.setAttribute("title", testMode ? "Éditer" : "Tester");
    // Le solveur n'a de sens qu'en mode test : cette icône n'apparaît même
    // pas en édition, pour éviter de suggérer qu'il modifierait le niveau
    // lui-même.
    solveBtn.classList.toggle("hidden", !testMode);
    solveBtn.disabled = !testMode;
    testResetBtn.classList.toggle("hidden", !testMode);
    editorViewEl.classList.toggle("editor--testing", testMode);
  }

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
    testLights = new Set();
    setTestMode(false);
    exportOutput.classList.add("hidden");
    importPanel.classList.add("hidden");
    // Round 19 (retour utilisateur): le nom n'est plus obligatoire en
    // général (voir saveBtn) — un niveau chargé sans nom n'est donc plus
    // signalé en erreur par défaut ; l'état d'erreur ne sert plus qu'à
    // Exporter, qui le pose lui-même à son propre clic si besoin.
    clearNameError();
    rebuildEditGrid();
    refreshLevelList();
  }

  newBtn.addEventListener("click", () => {
    loadLevelIntoEditor({ name: "", rows: 5, cols: 5, cells: blankCells(5, 5) });
  });

  testBtn.addEventListener("click", () => {
    setTestMode(!testMode);
    rebuildEditGrid();
  });

  solveBtn.addEventListener("click", () => {
    if (!testMode) return;
    const solution = findSolution(buildLevelObject(), 300_000);
    if (!solution) return;
    testLights = new Set(solution.map(([r, c]) => `${r},${c}`));
    rebuildEditGrid();
    if (testGrid.isWon()) playWin();
  });

  // Round 19 (retour utilisateur): "le champ 'nom' n'est plus obligatoire et
  // si on enregistre sans, on enregistre avec un ID et on garde une date
  // dont on se sert pour le nommer automatiquement dans la liste [...] mais
  // pas de vrai nom enregistré". `id`/`createdAt` sont posés une seule fois
  // (au tout premier enregistrement) et conservés tels quels aux
  // enregistrements suivants du même niveau — seuls name/rows/cols/cells
  // changent à chaque re-sauvegarde.
  saveBtn.addEventListener("click", () => {
    const toSave = buildLevelObject();
    toSave.cells = editLevel.cells.map((row) => row.join(" "));
    if (currentCustomIndex >= 0) {
      const existing = customLevels[currentCustomIndex];
      toSave.id = existing.id;
      toSave.createdAt = existing.createdAt;
      customLevels[currentCustomIndex] = toSave;
    } else {
      toSave.id = `custom-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      toSave.createdAt = new Date().toISOString();
      customLevels.push(toSave);
      currentCustomIndex = customLevels.length - 1;
    }
    saveCustomLevels(customLevels);
    refreshLevelList();
  });

  // Round 18 (retour utilisateur): plutôt qu'un message succès/échec, le
  // bouton Supprimer est simplement désactivé quand il n'y a rien à
  // supprimer (aucun niveau sauvegardé chargé) — voir refreshLevelList
  // ci-dessus, qui tient deleteBtn.disabled à jour à chaque appel.
  deleteBtn.addEventListener("click", () => {
    if (currentCustomIndex < 0) return;
    customLevels.splice(currentCustomIndex, 1);
    saveCustomLevels(customLevels);
    currentCustomIndex = -1;
    refreshLevelList();
  });

  exportBtn.addEventListener("click", () => {
    if (!editLevel.name.trim()) {
      markNameError();
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
    navigator.clipboard?.writeText(code).catch(() => {});
  });

  // Publier: envoie le niveau courant dans la Communauté (voir
  // community-store.js). Round 19 (retour utilisateur): "on demande le nom
  // du niveau plutôt que le nom/emote du joueur (qui ne sera pas modifiable
  // autrement que dans le profil)" — l'identité de l'auteur vient TOUJOURS
  // du profil déjà enregistré (voir main.js: Mon profil), simplement
  // prévisualisée en lecture seule ; le seul champ demandé ici est le titre
  // du niveau, obligatoire uniquement à CE moment précis (voir
  // markPublishTitleError ci-dessous — même logique que markNameError, sur
  // un champ différent).
  function markPublishTitleError() {
    publishTitleInput.classList.remove("input-error--shake");
    void publishTitleInput.offsetWidth;
    publishTitleInput.classList.add("input-error", "input-error--shake");
    publishTitleInput.focus();
  }

  publishTitleInput.addEventListener("input", () => {
    if (publishTitleInput.value.trim()) publishTitleInput.classList.remove("input-error", "input-error--shake");
  });

  function openPublishModal() {
    const profile = loadProfile();
    publishAuthorPreviewEl.innerHTML = "";
    const avatarEl = document.createElement("span");
    avatarEl.className = "badge-frame-avatar";
    avatarEl.innerHTML = getAvatarSvg(profile?.avatar ?? DEFAULT_AVATAR);
    const pseudoEl = document.createElement("span");
    pseudoEl.className = "badge-frame-pseudo";
    pseudoEl.textContent = profile?.pseudo?.trim() || "(pseudo non configuré)";
    const frame = document.createElement("span");
    frame.className = "badge-frame" + (profile?.activeBadge ? ` badge-frame--tier-${profile.activeBadge}` : "");
    frame.append(avatarEl, pseudoEl);
    publishAuthorPreviewEl.appendChild(frame);
    // Pré-remplit avec le nom local du niveau s'il en a déjà un — sinon
    // vide: le nom auto (ID+date, voir refreshLevelList) n'est PAS un vrai
    // nom, donc c'est comme si aucun nom n'existait encore à cet instant.
    publishTitleInput.value = editLevel.name || "";
    publishTitleInput.classList.remove("input-error", "input-error--shake");
    publishStatusEl.textContent = "";
    publishModal.classList.remove("hidden");
  }

  function closePublishModal() {
    publishModal.classList.add("hidden");
  }

  publishBtn.addEventListener("click", openPublishModal);

  document.querySelectorAll("[data-editor-publish-close]").forEach((el) => (el.onclick = closePublishModal));

  publishConfirmBtn.addEventListener("click", () => {
    const profile = loadProfile();
    const pseudo = profile?.pseudo?.trim();
    if (!pseudo) {
      publishStatusEl.textContent = "Configure d'abord ton pseudo dans Mon profil avant de publier.";
      return;
    }
    const title = publishTitleInput.value.trim();
    if (!title) {
      markPublishTitleError();
      return;
    }
    if (isDuplicatePublication(title, pseudo)) {
      publishStatusEl.textContent = "Tu as déjà publié un niveau du même nom sous ce pseudo.";
      return;
    }
    const levelObj = buildLevelObject();
    const check = validatePlayableLevel(levelObj);
    if (check.error) {
      publishStatusEl.textContent = `Publication impossible : ${check.error}`;
      return;
    }
    publishLevel({
      title,
      rows: levelObj.rows,
      cols: levelObj.cols,
      cells: levelObj.cells,
      author: { pseudo, avatar: profile.avatar ?? DEFAULT_AVATAR, badge: profile.activeBadge ?? null },
      difficulty: check.difficulty,
    });
    closePublishModal();
  });

  // Importer: colle le code d'un niveau (typiquement le résultat
  // d'Exporter, ou une entrée copiée depuis levels.js) et le charge dans
  // l'éditeur comme point de départ — pas encore sauvegardé : currentCustomIndex
  // reste à -1 tant que le joueur n'a pas cliqué "Sauvegarder" lui-même,
  // pour ne jamais écraser silencieusement un niveau existant du même nom.
  importBtn.addEventListener("click", () => {
    importPanel.classList.remove("hidden");
    exportOutput.classList.add("hidden");
    importInput.value = "";
    importInput.focus();
    importStatusEl.textContent = "";
  });

  importCancelBtn.addEventListener("click", () => {
    importPanel.classList.add("hidden");
    importInput.value = "";
    importStatusEl.textContent = "";
  });

  importConfirmBtn.addEventListener("click", () => {
    const { level, note, error } = parseLevelFromCode(importInput.value);
    if (error) {
      importStatusEl.textContent = `Import impossible : ${error}`;
      return;
    }
    loadLevelIntoEditor(level, -1);
    importPanel.classList.add("hidden");
    importInput.value = "";
    importStatusEl.textContent = "";
    if (note) importStatusEl.textContent = note.trim();
  });

  levelListSel.addEventListener("change", () => {
    const val = levelListSel.value;
    if (val === "") {
      newBtn.click();
      return;
    }
    const idx = parseInt(val, 10);
    loadLevelIntoEditor(customLevels[idx], idx);
  });

  setTool("empty");
  setActiveTab("grid");
  refreshLevelList();
  updateSizeReadout();

  return {
    onShow() {
      refreshLevelList();
      rebuildEditGrid();
    },
  };
}
