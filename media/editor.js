(function () {
"use strict";
const vscode = acquireVsCodeApi();
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const id = s => String(s).replace(/\W/g, "_");
const snap = v => Math.round(v / 20) * 20;
const HINT = $("#hint").textContent;

// État de l'éditeur
let topName = "chain", lite = false, rstLow = true, sel = null, drag = null, tmp = null, clip = null;
let lastText = null, pending = null, locked = false;

// État pour undo/redo
let history = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

// État pour zoom/pan
let zoomLevel = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let dragStart = { x: 0, y: 0 };

// État pour sélection multiple
let selectedBlocks = new Set();
let selectionBox = null;
let selectionStart = null;

/* ---------- Types de blocs ---------- */
const P = (name, dir, width, role = "", side = "") => ({ name, dir, width, role, side });
const muxPorts = (n, w) => [...Array(n)].map((_, i) => P("i" + i, "in", w)).concat(P("sel", "in", Math.max(1, Math.ceil(Math.log2(n))), "", "bottom"), P("y", "out", w));
const PRE = { 
  register: "r", 
  adder: "a", 
  mux: "m", 
  custom: "u", 
  in: "in", 
  out: "out",
  const: "c",
  slice: "s",
  concat: "cat",
  and: "and",
  or: "or",
  xor: "xor",
  nand: "nand",
  nor: "nor",
  xnor: "xnor",
  not: "not",
  shl: "shl",
  shr: "shr",
  eq: "eq",
  neq: "neq",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  counter: "cnt"
};
const COL = { 
  register: "#065b07", 
  adder: "#f97316", 
  mux: "#112f5f", 
  custom: "#a855f7", 
  in: "#0d9488", 
  out: "#db2777",
  const: "#7c3aed",
  slice: "#0891b2",
  concat: "#1e40af",
  and: "#ea580c",
  or: "#f59e0b",
  xor: "#eab308",
  nand: "#92400e",
  nor: "#78350f",
  xnor: "#591c08",
  not: "#374151",
  shl: "#059669",
  shr: "#047857",
  eq: "#10b981",
  neq: "#059669",
  gt: "#0891b2",
  gte: "#0284c7",
  lt: "#1e40af",
  lte: "#1e3a8a",
  counter: "#7c2d12"
};

const rgb = c => [1, 3, 5].map(i => parseInt(c.substr(i, 2), 16));
const ink = c => { const [r, g, b] = rgb(c); return .299 * r + .587 * g + .114 * b > 200 ? "#000" : "#fff"; };
const dark = (c, f = .35) => "#" + rgb(c).map(v => Math.round(v * (1 - f)).toString(16).padStart(2, "0")).join("");

// Définitions des ports par défaut pour chaque type de bloc
const defPorts = k => ({
  register: [P("clk", "in", 1, "clk"), P("rst", "in", 1, "rst"), P("d", "in", 8), P("q", "out", 8)],
  adder: [P("a", "in", 8), P("b", "in", 8), P("s", "out", 8)],
  mux: muxPorts(2, 8),
  custom: [P("a", "in", 1), P("y", "out", 1)],
  in: [P("p", "out", 8)],
  out: [P("p", "in", 8)],
  const: [P("out", "out", 8)],
  slice: [P("in", "in", 8), P("out", "out", 4)],
  concat: [P("a", "in", 4), P("b", "in", 4), P("out", "out", 8)],
  and: [P("a", "in", 1), P("b", "in", 1), P("out", "out", 1)],
  or: [P("a", "in", 1), P("b", "in", 1), P("out", "out", 1)],
  xor: [P("a", "in", 1), P("b", "in", 1), P("out", "out", 1)],
  nand: [P("a", "in", 1), P("b", "in", 1), P("out", "out", 1)],
  nor: [P("a", "in", 1), P("b", "in", 1), P("out", "out", 1)],
  xnor: [P("a", "in", 1), P("b", "in", 1), P("out", "out", 1)],
  not: [P("a", "in", 1), P("out", "out", 1)],
  shl: [P("in", "in", 8), P("out", "out", 8)],
  shr: [P("in", "in", 8), P("out", "out", 8)],
  eq: [P("a", "in", 8), P("b", "in", 8), P("out", "out", 1)],
  neq: [P("a", "in", 8), P("b", "in", 8), P("out", "out", 1)],
  gt: [P("a", "in", 8), P("b", "in", 8), P("out", "out", 1)],
  gte: [P("a", "in", 8), P("b", "in", 8), P("out", "out", 1)],
  lt: [P("a", "in", 8), P("b", "in", 8), P("out", "out", 1)],
  lte: [P("a", "in", 8), P("b", "in", 8), P("out", "out", 1)],
  counter: [P("clk", "in", 1, "clk"), P("rst", "in", 1, "rst"), P("enable", "in", 1), P("load", "in", 1), P("load_val", "in", 8), P("q", "out", 8)]
}[k]);

const defMod = (k, n) => ({
  register: "reg8", 
  adder: "add8", 
  mux: "mux2", 
  custom: "bloc" + n, 
  in: "", 
  out: "",
  const: "const",
  slice: "slice",
  concat: "concat",
  and: "and_gate",
  or: "or_gate",
  xor: "xor_gate",
  nand: "nand_gate",
  nor: "nor_gate",
  xnor: "xnor_gate",
  not: "not_gate",
  shl: "shl",
  shr: "shr",
  eq: "eq",
  neq: "neq",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  counter: "counter"
}[k]);

const mk = (kind, x, y, n) => ({ 
  inst: PRE[kind] + n, 
  mod: defMod(kind, n), 
  kind, 
  x, 
  y, 
  color: "",
  ports: defPorts(kind),
  parameters: {}
});

const col = b => b.color || COL[b.kind];
const isIO = b => b.kind == "in" || b.kind == "out";
const pn = p => p.role == "rst" ? id(p.name).replace(/_n$/, "") + (rstLow ? "_n" : "") : id(p.name);
const lab = (b, p) => b.kind == "mux" && p.dir == "in" && !p.side ? p.name.slice(1) : p.role == "rst" ? pn(p) : p.name;

const bw = b => {
  if (isIO(b)) return Math.max(80, Math.ceil((b.inst.length * 7.4 + (b.ports[0].width > 1 ? 14 : 0) + 40) / 10) * 10);
  if (lite) return Math.max(80, Math.ceil((b.inst.length * 7.4 + 36) / 10) * 10);
  const n = g => Math.max(0, ...g.map(p => lab(b, p).length + (p.width > 1 ? 2 : 0)));
  const cw = Math.max(b.inst.length * 7.4, b.mod.length * 6.2) + 10;
  return Math.max(100, Math.ceil((n(grp(b, "left")) * 6.6 + n(grp(b, "right")) * 6.6 + 28 + cw) / 10) * 10);
};

const bh = b => {
  if (isIO(b)) return 34;
  if (b.kind == "adder") return bw(b);
  let h = Math.max(130, 56 + 26 * Math.max(1, grp(b, "left").length, grp(b, "right").length));
  if (b.kind == "mux") h = Math.max(h, 150);
  return Math.max(h, bw(b) + 20);
};

const mi = b => Math.round(bh(b) * .27);
let blocks = [], links = [];

const defaults = () => {
  const i = mk("in", 20, 168, 1), o = mk("out", 620, 168, 1); 
  i.inst = "din"; o.inst = "dout";
  blocks = [i, mk("register", 160, 120, 1), mk("register", 440, 120, 2), o];
  links = [{ from: "din.p", to: "r1.d" }, { from: "r1.q", to: "r2.d" }, { from: "r2.q", to: "dout.p" }];
};

const find = r => {
  const k = r.indexOf("."), bi = blocks.findIndex(x => x.inst == r.slice(0, k));
  const pj = bi < 0 ? -1 : blocks[bi].ports.findIndex(p => p.name == r.slice(k + 1));
  return pj < 0 ? null : { bi, pj, b: blocks[bi], p: blocks[bi].ports[pj] };
};

const side = p => p.role == "clk" || p.role == "rst" || p.side == "bottom" ? "bottom" : p.side == "top" ? "top" : p.dir == "in" ? "left" : "right";
const grp = (b, s) => b.ports.filter(p => side(p) == s);
const step = () => 26;

function pp(bi, pj) {
  const b = blocks[bi], p = b.ports[pj], s = side(p), g = grp(b, s), n = g.indexOf(p);
  if (s == "left" || s == "right") return [b.x + (s == "right" ? bw(b) : 0), b.y + bh(b) / 2 + (n - (g.length - 1) / 2) * step(b)];
  const x = b.x + bw(b) * (n + 1) / (g.length + 1);
  return s == "top" ? [x, b.y] : [x, b.y + bh(b) - (b.kind == "mux" ? mi(b) * (x - b.x) / bw(b) : 0)];
}

/* ---------- Historique (Undo/Redo) ---------- */

/**
 * Sauvegarde l'état actuel dans l'historique
 */
function saveToHistory() {
  // Si on est au milieu de l'historique, on supprime tout ce qui vient après
  if (historyIndex < history.length - 1) {
    history = history.slice(0, historyIndex + 1);
  }
  
  const state = {
    blocks: JSON.parse(JSON.stringify(blocks)),
    links: JSON.parse(JSON.stringify(links)),
    topName,
    rstLow
  };
  
  history.push(state);
  historyIndex = history.length - 1;
  
  // Limiter la taille de l'historique
  if (history.length > MAX_HISTORY) {
    history.shift();
    historyIndex--;
  }
  
  updateUndoRedoButtons();
}

/**
 * Annule la dernière action
 */
function undo() {
  if (historyIndex <= 0) return;
  
  historyIndex--;
  const state = history[historyIndex];
  
  blocks = JSON.parse(JSON.stringify(state.blocks));
  links = JSON.parse(JSON.stringify(state.links));
  topName = state.topName;
  rstLow = state.rstLow;
  
  sel = null;
  selectedBlocks.clear();
  
  $("#top").value = topName;
  $("#rp").value = rstLow ? "low" : "high";
  
  renderProps();
  draw();
  
  updateUndoRedoButtons();
}

/**
 * Rétablit la dernière action annulée
 */
function redo() {
  if (historyIndex >= history.length - 1) return;
  
  historyIndex++;
  const state = history[historyIndex];
  
  blocks = JSON.parse(JSON.stringify(state.blocks));
  links = JSON.parse(JSON.stringify(state.links));
  topName = state.topName;
  rstLow = state.rstLow;
  
  sel = null;
  selectedBlocks.clear();
  
  $("#top").value = topName;
  $("#rp").value = rstLow ? "low" : "high";
  
  renderProps();
  draw();
  
  updateUndoRedoButtons();
}

/**
 * Met à jour l'état des boutons Undo/Redo
 */
function updateUndoRedoButtons() {
  const undoBtn = document.querySelector('[data-a="undo"]');
  const redoBtn = document.querySelector('[data-a="redo"]');
  
  if (undoBtn) {
    undoBtn.disabled = historyIndex <= 0;
    undoBtn.style.opacity = historyIndex <= 0 ? '0.5' : '1';
  }
  
  if (redoBtn) {
    redoBtn.disabled = historyIndex >= history.length - 1;
    redoBtn.style.opacity = historyIndex >= history.length - 1 ? '0.5' : '1';
  }
}

/* ---------- Sélection multiple ---------- */

/**
 * Sélectionne un bloc
 * @param {number} index - Index du bloc
 * @param {boolean} multi - Si true, ajoute à la sélection, sinon remplace
 */
function selectBlock(index, multi = false) {
  if (!multi) {
    selectedBlocks.clear();
  }
  
  if (selectedBlocks.has(index)) {
    selectedBlocks.delete(index);
  } else {
    selectedBlocks.add(index);
  }
  
  sel = { t: "b", i: index };
  renderProps();
  draw();
}

/**
 * Sélectionne tous les blocs
 */
function selectAll() {
  selectedBlocks.clear();
  blocks.forEach((_, index) => selectedBlocks.add(index));
  sel = null;
  renderProps();
  draw();
}

/**
 * Désélectionne tous les blocs
 */
function clearSelection() {
  selectedBlocks.clear();
  sel = null;
  renderProps();
  draw();
}

/**
 * Supprime tous les blocs sélectionnés
 */
function deleteSelected() {
  if (selectedBlocks.size === 0) return;
  
  // Sauvegarder avant suppression
  saveToHistory();
  
  // Supprimer les liens liés aux blocs sélectionnés
  const instancesToRemove = new Set();
  selectedBlocks.forEach(index => {
    instancesToRemove.add(blocks[index].inst);
  });
  
  links = links.filter(l => {
    const fromInst = l.from.split('.')[0];
    const toInst = l.to.split('.')[0];
    return !instancesToRemove.has(fromInst) && !instancesToRemove.has(toInst);
  });
  
  // Supprimer les blocs (dans l'ordre inverse pour ne pas affecter les indices)
  const indicesToDelete = Array.from(selectedBlocks).sort((a, b) => b - a);
  indicesToDelete.forEach(index => {
    blocks.splice(index, 1);
  });
  
  selectedBlocks.clear();
  sel = null;
  renderProps();
  sync();
}

/**
 * Déplace les blocs sélectionnés
 * @param {number} dx - Déplacement en X
 * @param {number} dy - Déplacement en Y
 */
function moveSelectedBlocks(dx, dy) {
  selectedBlocks.forEach(index => {
    blocks[index].x = Math.max(0, snap(blocks[index].x + dx));
    blocks[index].y = Math.max(40, snap(blocks[index].y + dy));
  });
  
  // Mettre à jour le point de départ pour le drag
  if (drag && selectedBlocks.size > 0) {
    drag.ox = blocks[Array.from(selectedBlocks)[0]].x - dragStart.x;
    drag.oy = blocks[Array.from(selectedBlocks)[0]].y - dragStart.y;
  }
  
  sync();
}

/**
 * Copie les blocs sélectionnés
 */
function copySelected() {
  if (selectedBlocks.size === 0) return;
  
  const selected = Array.from(selectedBlocks).map(index => blocks[index]);
  clip = JSON.parse(JSON.stringify(selected));
}

/**
 * Coupe les blocs sélectionnés
 */
function cutSelected() {
  copySelected();
  deleteSelected();
}

/**
 * Colle les blocs copiés
 */
function pasteSelected() {
  if (!clip || clip.length === 0) return;
  
  saveToHistory();
  
  const newBlocks = JSON.parse(JSON.stringify(clip));
  const offset = 40;
  
  newBlocks.forEach((b, i) => {
    // Trouver un nom unique
    let n = 1;
    let prefix = PRE[b.kind];
    while (blocks.some(x => x.inst === prefix + n)) n++;
    
    b.inst = prefix + n;
    b.x += offset * (i + 1);
    b.y += offset * (i + 1);
    
    blocks.push(b);
    selectedBlocks.add(blocks.length - 1);
  });
  
  sel = { t: "b", i: blocks.length - 1 };
  renderProps();
  sync();
}

/**
 * Duplique les blocs sélectionnés
 */
function duplicateSelected() {
  copySelected();
  pasteSelected();
}

/* ---------- Zoom/Pan ---------- */

/**
 * Applique le zoom
 * @param {number} level - Niveau de zoom (1.0 = 100%)
 */
function setZoom(level) {
  zoomLevel = Math.max(0.1, Math.min(3, level));
  draw();
  updateZoomDisplay();
}

/**
 * Zoom avant
 */
function zoomIn() {
  setZoom(zoomLevel + 0.1);
}

/**
 * Zoom arrière
 */
function zoomOut() {
  setZoom(zoomLevel - 0.1);
}

/**
 * Réinitialise le zoom
 */
function resetZoom() {
  setZoom(1);
  panX = 0;
  panY = 0;
  draw();
}

/**
 * Met à jour l'affichage du niveau de zoom
 */
function updateZoomDisplay() {
  const zoomDisplay = document.getElementById('zoomDisplay');
  if (zoomDisplay) {
    zoomDisplay.textContent = `${Math.round(zoomLevel * 100)}%`;
  }
}

/**
 * Commence le pan (déplacement de la vue)
 * @param {number} x - Position X de la souris
 * @param {number} y - Position Y de la souris
 */
function startPan(x, y) {
  isPanning = true;
  dragStart.x = x;
  dragStart.y = y;
  cv.style.cursor = 'grabbing';
}

/**
 * Déplace la vue (pan)
 * @param {number} x - Position X de la souris
 * @param {number} y - Position Y de la souris
 */
function panTo(x, y) {
  const dx = (x - dragStart.x) / zoomLevel;
  const dy = (y - dragStart.y) / zoomLevel;
  
  panX += dx;
  panY += dy;
  
  dragStart.x = x;
  dragStart.y = y;
  
  draw();
}

/**
 * Termine le pan
 */
function endPan() {
  isPanning = false;
  cv.style.cursor = '';
}

/**
 * Centre la vue sur un bloc ou la sélection
 */
function centerView() {
  if (selectedBlocks.size > 0) {
    // Centrer sur la sélection
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selectedBlocks.forEach(index => {
      const b = blocks[index];
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + bw(b));
      maxY = Math.max(maxY, b.y + bh(b));
    });
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const viewportWidth = cv.clientWidth / zoomLevel;
    const viewportHeight = cv.clientHeight / zoomLevel;
    
    panX = viewportWidth / 2 - centerX;
    panY = viewportHeight / 2 - centerY;
  } else if (blocks.length > 0) {
    // Centrer sur tous les blocs
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    blocks.forEach(b => {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + bw(b));
      maxY = Math.max(maxY, b.y + bh(b));
    });
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const viewportWidth = cv.clientWidth / zoomLevel;
    const viewportHeight = cv.clientHeight / zoomLevel;
    
    panX = viewportWidth / 2 - centerX;
    panY = viewportHeight / 2 - centerY;
  } else {
    // Réinitialiser
    panX = 0;
    panY = 0;
  }
  
  draw();
}

/**
 * Déplace la vue avec les flèches du clavier
 * @param {number} dx - Déplacement en X
 * @param {number} dy - Déplacement en Y
 */
function panBy(dx, dy) {
  panX += dx / zoomLevel;
  panY += dy / zoomLevel;
  draw();
}

/* ---------- Boîte de sélection ---------- */

/**
 * Commence la sélection par boîte
 * @param {number} x - Position X de la souris
 * @param {number} y - Position Y de la souris
 */
function startSelectionBox(x, y) {
  selectionStart = { x, y };
  
  if (!selectionBox) {
    selectionBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    selectionBox.setAttribute('class', 'selection-box');
    selectionBox.setAttribute('fill', 'rgba(0, 100, 255, 0.2)');
    selectionBox.setAttribute('stroke', '#0064ff');
    selectionBox.setAttribute('stroke-width', '2');
    selectionBox.setAttribute('stroke-dasharray', '5,5');
    cv.appendChild(selectionBox);
  }
  
  selectionBox.setAttribute('x', x);
  selectionBox.setAttribute('y', y);
  selectionBox.setAttribute('width', 0);
  selectionBox.setAttribute('height', 0);
  selectionBox.style.display = 'block';
}

/**
 * Met à jour la boîte de sélection
 * @param {number} x - Position X de la souris
 * @param {number} y - Position Y de la souris
 */
function updateSelectionBox(x, y) {
  if (!selectionStart || !selectionBox) return;
  
  const startX = selectionStart.x;
  const startY = selectionStart.y;
  const width = x - startX;
  const height = y - startY;
  
  selectionBox.setAttribute('x', Math.min(startX, x));
  selectionBox.setAttribute('y', Math.min(startY, y));
  selectionBox.setAttribute('width', Math.abs(width));
  selectionBox.setAttribute('height', Math.abs(height));
}

/**
 * Termine la sélection par boîte
 */
function endSelectionBox() {
  if (!selectionStart || !selectionBox) return;
  
  const startX = selectionStart.x;
  const startY = selectionStart.y;
  const endX = parseFloat(selectionBox.getAttribute('x')) + parseFloat(selectionBox.getAttribute('width'));
  const endY = parseFloat(selectionBox.getAttribute('y')) + parseFloat(selectionBox.getAttribute('height'));
  
  const minX = Math.min(startX, endX);
  const maxX = Math.max(startX, endX);
  const minY = Math.min(startY, endY);
  const maxY = Math.max(startY, endY);
  
  // Sélectionner les blocs dans la boîte
  clearSelection();
  
  blocks.forEach((b, index) => {
    const blockRight = b.x + bw(b);
    const blockBottom = b.y + bh(b);
    
    if (blockRight >= minX && b.x <= maxX && blockBottom >= minY && b.y <= maxY) {
      selectedBlocks.add(index);
    }
  });
  
  if (selectedBlocks.size > 0) {
    sel = { t: "b", i: Array.from(selectedBlocks)[0] };
  } else {
    sel = null;
  }
  
  selectionBox.style.display = 'none';
  selectionStart = null;
  
  renderProps();
  draw();
}

/* ---------- Canevas ---------- */

function route(f, t) {
  const [x1, y1] = pp(f.bi, f.pj), [x2, y2] = pp(t.bi, t.pj);
  if (side(t.p) == "bottom") { const ye = y2 + 7; return `M${x1} ${y1}H${x1 + 24}V${ye + 30}H${x2}V${ye}`; }
  if (side(t.p) == "top") {
    const ye = y2 - 7;
    return x2 > x1 + 24 && y1 < ye - 12 ? `M${x1} ${y1}H${x2}V${ye}` : `M${x1} ${y1}H${x1 + 24}V${ye - 30}H${x2}V${ye}`;
  }
  const e = x2 - 7;
  if (x2 - x1 >= 50) return `M${x1} ${y1}H${Math.round((x1 + x2) / 2)}V${y2}H${e}`;
  const yt = Math.min(blocks[f.bi].y, blocks[t.bi].y) - 28;
  return `M${x1} ${y1}H${x1 + 24}V${yt}H${x2 - 24}V${y2}H${e}`;
}

function draw() {
  // Appliquer le zoom et le pan au conteneur SVG
  const transform = `translate(${panX * zoomLevel}, ${panY * zoomLevel}) scale(${zoomLevel})`;
  cv.setAttribute('transform', transform);
  
  const mark = (i, c) => `<marker id="${i}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`;
  let s = `<defs>${mark("ar", "#fff")}${mark("as", "#ffd24a")}</defs>`;
  
  // Dessiner les liens
  links.forEach((l, k) => {
    const f = find(l.from), t = find(l.to); 
    if (!f || !t) return;
    const on = sel && sel.t == "l" && sel.i == k;
    const dd = route(f, t);
    s += `<path class="hit" data-l="${k}" d="${dd}"/><path class="wire${on ? " on" : ""}" d="${dd}" marker-end="url(#${on ? "as" : "ar"})"/>`;
  });
  
  // Dessiner le lien temporaire (en cours de création)
  if (tmp) {
    s += `<path class="tmp" d="M${tmp.x} ${tmp.y}L${tmp.mx} ${tmp.my}"/>`;
    if (tmp.hov) { 
      const [x, y] = pp(tmp.hov.bi, tmp.hov.pj); 
      s += `<circle class="ring" cx="${x}" cy="${y}" r="9"/>`; 
    }
  }
  
  // Dessiner les blocs
  blocks.forEach((b, i) => {
    const on = selectedBlocks.has(i) || (sel && sel.t == "b" && sel.i == i);
    const c = col(b), k = ink(c), dk = dark(c), kd = ink(dk);
    const w = bw(b), h = bh(b), m = mi(b), cx = b.x + w / 2, cy = b.y + h / 2, clk = b.ports.some(p => p.role == "clk");
    const a = `class="bx${on ? " on" : ""}" data-b="${i}" fill="${c}"`;
    
    // Forme du bloc
    s += b.kind == "mux"
      ? `<polygon ${a} points="${b.x},${b.y} ${b.x + w},${b.y + m} ${b.x + w},${b.y + h - m} ${b.x},${b.y + h}"/>`
      : isIO(b)
        ? `<polygon ${a} points="${b.x},${b.y} ${b.x + w - 14},${b.y} ${b.x + w},${cy} ${b.x + w - 14},${b.y + h} ${b.x},${b.y + h}"/>`
        : `<rect ${a} x="${b.x}" y="${b.y}" width="${w}" height="${h}" rx="2"/>`;
    
    if (clk) s += `<polygon data-b="${i}" fill="${dk}" points="${b.x},${b.y + h} ${b.x + w},${b.y + h} ${cx},${b.y + h - 44}"/>`;
    
    // Texte du bloc
    const io = isIO(b), one = io || lite;
    const ny = io ? cy + 4 : b.kind == "adder" ? b.y + h - 22 : (one ? cy + 4 : cy - 1) - (clk ? 13 : 0);
    s += `<text class="t" style="fill:${k}" x="${io ? cx - 7 : cx}" y="${ny}" text-anchor="middle">${esc(b.inst)}${io && b.ports[0].width > 1 ? `<tspan class="w" dx="3">${b.ports[0].width}</tspan>` : ""}</text>`
      + (one ? "" : `<text class="m" style="fill:${k}" x="${cx}" y="${ny + 13}" text-anchor="middle">${esc(b.mod)}</text>`);
    
    // Symbole spécial pour certains blocs
    if (b.kind == "adder") s += `<text style="fill:${k};font-size:46px;font-weight:300" x="${cx}" y="${cy + 10}" text-anchor="middle">+</text>`;
    if (b.kind == "and") s += `<text style="fill:${k};font-size:40px;font-weight:300" x="${cx}" y="${cy + 8}" text-anchor="middle">&amp;</text>`;
    if (b.kind == "or") s += `<text style="fill:${k};font-size:40px;font-weight:300" x="${cx}" y="${cy + 8}" text-anchor="middle">|</text>`;
    if (b.kind == "xor") s += `<text style="fill:${k};font-size:40px;font-weight:300" x="${cx}" y="${cy + 8}" text-anchor="middle">^</text>`;
    if (b.kind == "not") s += `<text style="fill:${k};font-size:40px;font-weight:300" x="${cx}" y="${cy + 8}" text-anchor="middle">~</text>`;
    if (b.kind == "const") s += `<text style="fill:${k};font-size:30px;font-weight:300" x="${cx}" y="${cy + 8}" text-anchor="middle">C</text>`;
    if (b.kind == "slice") s += `<text style="fill:${k};font-size:30px;font-weight:300" x="${cx}" y="${cy + 8}" text-anchor="middle">[ ]</text>`;
    if (b.kind == "concat") s += `<text style="fill:${k};font-size:30px;font-weight:300" x="${cx}" y="${cy + 8}" text-anchor="middle">{ }</text>`;
    if (b.kind == "counter") s += `<text style="fill:${k};font-size:30px;font-weight:300" x="${cx}" y="${cy + 8}" text-anchor="middle">++</text>`;
    
    // Dessiner les ports
    b.ports.forEach((p, j) => {
      const [x, y] = pp(i, j), sd = side(p);
      if (p.role == "clk") { 
        if (!lite) s += `<text style="fill:${kd}" x="${x}" y="${y - 9}" text-anchor="middle">clk</text>`; 
        return; 
      }
      if (!p.role) s += `<circle class="pv" cx="${x}" cy="${y}" r="4"/>`;
      const [tx, ty, an] = sd == "left" ? [x + 10, y + 4, "start"] : sd == "right" ? [x - 10, y + 4, "end"] : sd == "top" ? [x, y + 15, "middle"] : [x, y - 9, "middle"];
      if (!io && !lite) s += `<text style="fill:${p.role == "rst" ? kd : k}" x="${tx}" y="${ty}" text-anchor="${an}">${esc(lab(b, p))}${p.width > 1 ? `<tspan class="w" dx="3">${p.width}</tspan>` : ""}</text>`;
      if (!p.role) s += `<circle class="ph2" data-pt="${i}:${j}" cx="${x}" cy="${y}" r="12"><title>${esc((io ? b.inst : b.inst + "." + p.name) + (p.width > 1 ? ` [${p.width - 1}:0]` : ""))}</title></circle>`;
    });
  });
  
  // Dessiner la boîte de sélection si active
  if (selectionBox && selectionBox.style.display === 'block') {
    s += `<rect class="selection-box" x="${selectionBox.getAttribute('x')}" y="${selectionBox.getAttribute('y')}" width="${selectionBox.getAttribute('width')}" height="${selectionBox.getAttribute('height')}" fill="rgba(0, 100, 255, 0.2)" stroke="#0064ff" stroke-width="2" stroke-dasharray="5,5"/>`;
  }
  
  $("#cv").innerHTML = s;
}

function nearest(mx, my, a) {
  const fd = blocks[a.bi].ports[a.pj].dir; 
  let best = null, bd = 24;
  blocks.forEach((b, i) => b.ports.forEach((p, j) => {
    if (p.role || p.dir == fd) return;
    const [x, y] = pp(i, j), dd = Math.hypot(x - mx, y - my);
    if (dd < bd) { bd = dd; best = { bi: i, pj: j }; }
  }));
  return best;
}

const cv = $("#cv"), pos = e => { 
  const r = cv.getBoundingClientRect(); 
  return { 
    x: (e.clientX - r.left - panX * zoomLevel) / zoomLevel, 
    y: (e.clientY - r.top - panY * zoomLevel) / zoomLevel 
  }; 
};

// Gestion des événements de la souris avec zoom/pan
cv.addEventListener("pointerdown", e => {
  if (locked) return;
  
  const p = pos(e);
  const t = e.target;
  const pe = t.closest("[data-pt]");
  const be = t.closest("[data-b]");
  const le = t.closest("[data-l]");
  
  // Si on clique sur un port
  if (pe) {
    const [bi, pj] = pe.dataset.pt.split(":").map(Number);
    const [x, y] = pp(bi, pj);
    
    // Vérifier si c'est une sélection multiple (avec Shift ou Ctrl)
    const multiSelect = e.shiftKey || e.ctrlKey || e.metaKey;
    
    if (multiSelect && !selectedBlocks.has(bi)) {
      selectBlock(bi, true);
    } else if (!multiSelect || selectedBlocks.size === 0) {
      selectBlock(bi);
    }
    
    sel = { t: "b", i: bi };
    tmp = { bi, pj, x, y, mx: p.x, my: p.y, hov: null };
    
  // Si on clique sur un bloc
  } else if (be) {
    const i = +be.dataset.b;
    const multiSelect = e.shiftKey || e.ctrlKey || e.metaKey;
    
    if (multiSelect) {
      selectBlock(i, true);
    } else {
      selectBlock(i);
    }
    
    drag = { 
      i: i, 
      ox: p.x - blocks[i].x, 
      oy: p.y - blocks[i].y,
      startX: p.x,
      startY: p.y
    };
    
    // Si on clique sur un lien
  } else if (le) {
    const i = +le.dataset.l;
    sel = { t: "l", i };
    
    // Si on clique sur le canevas vide (sélection par boîte ou pan)
  } else {
    // Vérifier si on appuie sur la touche Ctrl pour le pan
    if (e.ctrlKey || e.metaKey) {
      startPan(e.clientX, e.clientY);
      e.preventDefault();
    } else {
      // Commencer une sélection par boîte
      startSelectionBox(p.x, p.y);
    }
    sel = null;
    clearSelection();
  }
  
  renderProps();
  draw();
  e.preventDefault();
});

cv.addEventListener("dblclick", e => {
  const be = e.target.closest("[data-b]"); 
  if (!be) return;
  const b = blocks[+be.dataset.b]; 
  if (b && !isIO(b)) cmd("openModule", id(b.mod));
});

// Gestion du drag avec zoom/pan
addEventListener("pointermove", e => {
  if (!drag && !tmp && !isPanning && !selectionStart) return;
  
  const p = pos(e);
  
  if (isPanning) {
    panTo(e.clientX, e.clientY);
  } else if (selectionStart) {
    updateSelectionBox(p.x, p.y);
  } else if (drag) {
    // Déplacer les blocs sélectionnés
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    
    if (selectedBlocks.size > 1) {
      moveSelectedBlocks(dx, dy);
    } else {
      const b = blocks[drag.i];
      b.x = Math.max(0, snap(p.x - drag.ox));
      b.y = Math.max(40, snap(p.y - drag.oy));
      magnet(drag.i);
    }
    
    drag.startX = p.x;
    drag.startY = p.y;
  } else if (tmp) {
    tmp.mx = p.x;
    tmp.my = p.y;
    tmp.hov = nearest(p.x, p.y, tmp);
  }
  
  draw();
});

addEventListener("pointerup", e => {
  if (isPanning) {
    endPan();
  }
  
  if (selectionStart) {
    endSelectionBox();
  }
  
  if (tmp) {
    if (tmp.hov) connect(tmp, tmp.hov);
    tmp = null;
    sync();
  }
  
  if (drag) {
    saveToHistory();
    drag = null;
    commit();
  }
});

// Gestion du zoom avec la molette de la souris
cv.addEventListener("wheel", e => {
  if (locked) return;
  
  // Zoom avec Ctrl + molette
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(0.1, Math.min(3, zoomLevel + delta));
    
    // Zoomer vers le centre de la souris
    const rect = cv.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculer la position avant zoom
    const beforeX = (mouseX - panX * zoomLevel) / zoomLevel;
    const beforeY = (mouseY - panY * zoomLevel) / zoomLevel;
    
    // Appliquer le zoom
    setZoom(newZoom);
    
    // Calculer la position après zoom et ajuster le pan
    const afterX = (mouseX - panX * zoomLevel) / zoomLevel;
    const afterY = (mouseY - panY * zoomLevel) / zoomLevel;
    
    panX += (beforeX - afterX) * zoomLevel;
    panY += (beforeY - afterY) * zoomLevel;
    
    draw();
  } else {
    // Défilement normal (pan)
    e.preventDefault();
    panBy(-e.deltaX, -e.deltaY);
  }
}, { passive: false });

// Gestion des touches du clavier
addEventListener("keydown", e => {
  if (locked || e.target.matches("input,select")) return;
  
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const blk = sel && sel.t == "b";
  
  // Undo/Redo
  if (mod && k == "z") {
    undo();
    e.preventDefault();
  } else if (mod && k == "y") {
    redo();
    e.preventDefault();
  }
  // Sélection multiple
  else if (mod && k == "a") {
    selectAll();
    e.preventDefault();
  }
  // Copier/Coller/Couper
  else if (mod && k == "c") {
    if (selectedBlocks.size > 0) {
      copySelected();
    } else if (blk) {
      clip = JSON.parse(JSON.stringify(blocks[sel.i]));
    }
    e.preventDefault();
  } else if (mod && k == "v") {
    if (selectedBlocks.size > 0) {
      pasteSelected();
    } else if (clip) {
      paste();
    }
    e.preventDefault();
  } else if (mod && k == "x") {
    if (selectedBlocks.size > 0) {
      cutSelected();
    }
    e.preventDefault();
  } else if (mod && k == "d") {
    if (selectedBlocks.size > 0) {
      duplicateSelected();
    } else if (blk) {
      dupBlock();
    }
    e.preventDefault();
  }
  // Suppression
  else if (["Delete", "Backspace"].includes(e.key)) {
    if (selectedBlocks.size > 0) {
      deleteSelected();
    } else if (sel && sel.t == "l") {
      links.splice(sel.i, 1);
      sel = null;
      renderProps();
      sync();
    } else if (blk) {
      delBlock();
    }
  }
  // Déplacement avec les flèches
  else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    if (selectedBlocks.size > 0) {
      e.preventDefault();
      const step = e.shiftKey ? 20 : 5;
      const dx = (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0);
      const dy = (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0);
      moveSelectedBlocks(dx, dy);
      saveToHistory();
    } else if (blk) {
      e.preventDefault();
      const b = blocks[sel.i];
      const step = e.shiftKey ? 20 : 5;
      if (e.key === "ArrowRight") b.x = Math.max(0, snap(b.x + step));
      else if (e.key === "ArrowLeft") b.x = Math.max(0, snap(b.x - step));
      else if (e.key === "ArrowDown") b.y = Math.max(40, snap(b.y + step));
      else if (e.key === "ArrowUp") b.y = Math.max(40, snap(b.y - step));
      magnet(sel.i);
      sync();
    }
  }
  // Zoom avec + et -
  else if (k == "+" || k == "=") {
    zoomIn();
    e.preventDefault();
  } else if (k == "-" || k == "_") {
    zoomOut();
    e.preventDefault();
  }
  // Réinitialiser le zoom
  else if (k == "0") {
    resetZoom();
    e.preventDefault();
  }
  // Centrer la vue
  else if (k == "c") {
    centerView();
    e.preventDefault();
  }
});

function magnet(bi) {
  const b = blocks[bi]; 
  let dy = null;
  links.forEach(l => {
    const f = find(l.from), t = find(l.to);
    if (!f || !t || f.bi == t.bi || (f.bi != bi && t.bi != bi) || side(f.p) != "right" || side(t.p) != "left") return;
    const me = f.bi == bi ? f : t, ot = f.bi == bi ? t : f, d = pp(ot.bi, ot.pj)[1] - pp(me.bi, me.pj)[1];
    if (Math.abs(d) <= 14 && (dy === null || Math.abs(d) < Math.abs(dy))) dy = d;
  });
  if (dy) b.y += dy;
}

function connect(a, b) {
  if (blocks[a.bi].ports[a.pj].dir == "in") [a, b] = [b, a];
  const ref = x => `${blocks[x.bi].inst}.${blocks[x.bi].ports[x.pj].name}`;
  const to = ref(b);
  links = links.filter(l => l.to != to); 
  links.push({ from: ref(a), to }); 
  magnet(b.bi);
}

/* ---------- Panneau de propriétés ---------- */

function renderProps() {
  const el = $("#props");
  if (locked || !sel || sel.t != "b" || !blocks[sel.i]) { 
    el.hidden = true; 
    return; 
  }
  el.hidden = false;
  
  const b = blocks[sel.i];
  const o = (a, c) => a.map(([v, t]) => `<option value="${v}"${v == c ? " selected" : ""}>${t}</option>`).join("");
  
  if (isIO(b)) {
    el.innerHTML = `<div class="ph">${b.kind == "in" ? "Entrée" : "Sortie"} du top</div>
      <label>Nom <input data-a="b:inst" value="${esc(b.inst)}"></label>
      <label>Largeur <input type="number" min="1" data-a="p:0:width" value="${b.ports[0].width}"></label>
      <label>Couleur <input type="color" data-a="b:color" value="${col(b)}"></label>
      <div class="pr" style="margin-top:8px"><button data-a="dup">Dupliquer</button><button class="x" data-a="del">Supprimer</button></div>`;
    return;
  }
  
  // Gestion des paramètres pour les blocs qui les supportent
  let paramsHtml = '';
  if (['const', 'slice', 'concat', 'counter', 'register'].includes(b.kind)) {
    paramsHtml = '<div class="ph">Paramètres</div>';
    
    switch (b.kind) {
      case 'const':
        paramsHtml += `
          <label>Valeur <input type="text" data-a="param:VALUE" value="${b.parameters?.VALUE || '0'}" placeholder="8'hFF"></label>
        `;
        break;
      case 'slice':
        paramsHtml += `
          <label>MSB <input type="number" data-a="param:MSB" value="${b.parameters?.MSB || (b.ports.find(p => p.dir === 'in')?.width || 8) - 1}"></label>
          <label>LSB <input type="number" data-a="param:LSB" value="${b.parameters?.LSB || 0}"></label>
        `;
        break;
      case 'counter':
        paramsHtml += `
          <label>Largeur <input type="number" min="1" data-a="param:WIDTH" value="${b.parameters?.WIDTH || 8}"></label>
        `;
        break;
      case 'register':
        paramsHtml += `
          <label>Valeur reset <input type="text" data-a="param:RESET_VAL" value="${b.parameters?.RESET_VAL || '0'}" placeholder="0"></label>
        `;
        break;
    }
  }
  
  const ports = b.kind == "mux"
    ? `<label>Entrées <input type="number" min="2" max="8" data-a="mux:n" value="${b.ports.filter(p => p.dir == "in" && !p.side).length}"></label>
       <label>Largeur <input type="number" min="1" data-a="mux:w" value="${b.ports[0].width}"></label>`
    : `<div class="ph">Ports</div>` + b.ports.map((p, j) => `<div class="pr">
      <input type="text" data-a="p:${j}:name" value="${esc(p.name)}">
      <select data-a="p:${j}:dir">${o([["in", "in"], ["out", "out"]], p.dir)}</select>
      <input type="number" min="1" data-a="p:${j}:width" value="${p.width}">
      <select data-a="p:${j}:role">${o([["", "data"], ["clk", "clk"], ["rst", "rst"]], p.role)}</select>
      <button class="x" data-a="delPort:${j}">\u2715</button></div>`).join("") + `<div class="pr"><button data-a="addPort">+ port</button></div>`;
  
  // Liste de tous les types de blocs
  const allKinds = [
    ["register", "registre"],
    ["adder", "adder"],
    ["mux", "mux"],
    ["custom", "custom"],
    ["const", "constante"],
    ["slice", "découpage"],
    ["concat", "concaténation"],
    ["and", "ET"],
    ["or", "OU"],
    ["xor", "OU Excl."],
    ["nand", "NON-ET"],
    ["nor", "NON-OU"],
    ["xnor", "Équivalence"],
    ["not", "NON"],
    ["shl", "décalage <<"],
    ["shr", "décalage >>"],
    ["eq", "égalité"],
    ["neq", "différent"],
    ["gt", "supérieur"],
    ["gte", "sup. ou égal"],
    ["lt", "inférieur"],
    ["lte", "inf. ou égal"],
    ["counter", "compteur"]
  ];
  
  el.innerHTML = `<div class="ph">Bloc</div>
    <label>Instance <input data-a="b:inst" value="${esc(b.inst)}"></label>
    <label>Module <input data-a="b:mod" value="${esc(b.mod)}"></label>
    <label>Type <select data-a="kind">${o(allKinds, b.kind)}</select></label>
    <label>Couleur <input type="color" data-a="b:color" value="${col(b)}"></label>
    ${paramsHtml}
    ${ports}
    <div class="pr" style="margin-top:8px"><button data-a="openMod">Ouvrir ${esc(id(b.mod))}.v</button></div>
    <div class="pr">
      <button data-a="dup">Dupliquer</button>
      <button class="x" data-a="del">Supprimer le bloc</button>
    </div>`;
}

function act(el) {
  const [a, x, y] = el.dataset.a.split(":"), v = el.value;
  
  if (a == "b") setB(x, v);
  else if (a == "p") setP(+x, y, v);
  else if (a == "mux") x == "n" ? setMux(+v, 0) : setMux(0, +v);
  else if (a == "kind") setKind(v);
  else if (a == "delPort") delPort(+x);
  else if (a == "addPort") addPort();
  else if (a == "dup") {
    if (selectedBlocks.size > 0) {
      duplicateSelected();
    } else {
      dupBlock();
    }
  }
  else if (a == "del") {
    if (selectedBlocks.size > 0) {
      deleteSelected();
    } else {
      delBlock();
    }
  }
  else if (a == "openMod") cmd("openModule", id(blocks[sel.i].mod));
  else if (a == "param") setParam(x, v);
}

function setParam(key, value) {
  const b = blocks[sel.i];
  if (!b.parameters) b.parameters = {};
  b.parameters[key] = value;
  sync();
}

const props = $("#props");
props.addEventListener("input", e => { 
  const t = e.target; 
  if (t.dataset.a && t.tagName != "SELECT" && t.tagName != "BUTTON") act(t); 
});
props.addEventListener("change", e => { 
  const t = e.target; 
  if (t.dataset.a && t.tagName == "SELECT") act(t); 
});
props.addEventListener("click", e => { 
  const t = e.target.closest("button[data-a]"); 
  if (t) act(t); 
});

function setB(k, v) {
  const b = blocks[sel.i];
  if (k == "inst") links.forEach(l => ["from", "to"].forEach(s => { 
    if (l[s].startsWith(b.inst + ".")) l[s] = v + l[s].slice(b.inst.length); 
  }));
  b[k] = v; 
  sync();
}

function setKind(v) {
  saveToHistory();
  const b = blocks[sel.i]; 
  b.kind = v; 
  b.ports = defPorts(v); 
  b.mod = defMod(v, sel.i + 1); 
  b.color = "";
  b.parameters = {};
  links = links.filter(l => find(l.from) && find(l.to)); 
  renderProps(); 
  sync();
}

function setMux(n, w) {
  saveToHistory();
  const b = blocks[sel.i]; 
  n = Math.min(8, Math.max(2, n || b.ports.filter(p => p.dir == "in" && !p.side).length)); 
  w = Math.max(1, w || b.ports[0].width);
  b.ports = muxPorts(n, w); 
  links = links.filter(l => find(l.from) && find(l.to)); 
  sync();
}

function setP(j, k, v) {
  saveToHistory();
  const b = blocks[sel.i], p = b.ports[j];
  if (k == "name") links.forEach(l => ["from", "to"].forEach(s => { 
    if (l[s] == `${b.inst}.${p.name}`) l[s] = `${b.inst}.${v}`; 
  }));
  p[k] = k == "width" ? Math.max(1, +v || 1) : v; 
  sync();
}

function addPort() {
  saveToHistory();
  const b = blocks[sel.i]; 
  b.ports.push(P("p" + b.ports.length, "in", 1)); 
  renderProps(); 
  sync();
}

function delPort(j) {
  saveToHistory();
  const b = blocks[sel.i], r = `${b.inst}.${b.ports[j].name}`;
  links = links.filter(l => l.from != r && l.to != r); 
  b.ports.splice(j, 1); 
  renderProps(); 
  sync();
}

function addBlock(kind) {
  saveToHistory();
  let n = 1; 
  while (blocks.some(b => b.inst == PRE[kind] + n)) n++;
  const k = 60 + 40 * (blocks.length % 8);
  blocks.push(mk(kind, k, k + 20, n)); 
  selectBlock(blocks.length - 1);
  sync();
}

function delBlock() {
  saveToHistory();
  const n = blocks[sel.i].inst;
  links = links.filter(l => !l.from.startsWith(n + ".") && !l.to.startsWith(n + "."));
  blocks.splice(sel.i, 1); 
  selectedBlocks.clear();
  sel = null; 
  renderProps(); 
  sync();
}

function paste() {
  saveToHistory();
  const b = JSON.parse(JSON.stringify(clip)); 
  let n = 1;
  while (blocks.some(x => x.inst == PRE[b.kind] + n)) n++;
  b.inst = PRE[b.kind] + n; 
  b.x += 40; 
  b.y += 40; 
  clip.x += 40; 
  clip.y += 40;
  blocks.push(b); 
  selectBlock(blocks.length - 1);
  sync();
}

const dupBlock = () => { 
  clip = JSON.parse(JSON.stringify(blocks[sel.i])); 
  paste(); 
};

/* ---------- Barre d'outils ---------- */

function toggleNom() { 
  lite = !lite; 
  $("#nom").textContent = "Nomenclature : " + (lite ? "allégée" : "normale"); 
  sync(); 
}

const tools = $("#tools");

// Ajouter les boutons pour les nouveaux types de blocs
tools.innerHTML += `
  <button data-a="add:const">+ Constante</button>
  <button data-a="add:slice">+ Découpage</button>
  <button data-a="add:concat">+ Concat</button>
  <button data-a="add:and">+ ET</button>
  <button data-a="add:or">+ OU</button>
  <button data-a="add:not">+ NON</button>
  <button data-a="add:counter">+ Compteur</button>
  <span class="sep"></span>
  <button data-a="undo" title="Annuler (Ctrl+Z)">↩ Undo</button>
  <button data-a="redo" title="Rétablir (Ctrl+Y)">↪ Redo</button>
  <button data-a="selectAll" title="Tout sélectionner (Ctrl+A)">🔲 Sélection</button>
  <span class="sep"></span>
  <button data-a="zoomIn" title="Zoom avant (Ctrl+Molette ou +)">+</button>
  <button data-a="zoomOut" title="Zoom arrière (Ctrl+Molette ou -)">−</button>
  <button data-a="resetZoom" title="Réinitialiser zoom (0)">100%</button>
  <button data-a="centerView" title="Centrer la vue (C)">⊞</button>
`;

// Ajouter l'affichage du zoom
tools.innerHTML += '<span id="zoomDisplay" class="zoom-display">100%</span>';

tools.addEventListener("click", e => {
  const el = e.target.closest("button[data-a]"); 
  if (!el || locked) return;
  const [a, x] = el.dataset.a.split(":");
  
  if (a == "add") addBlock(x);
  else if (a == "nom") toggleNom();
  else if (a == "cmd") cmd(x);
  else if (a == "svg") exportSvg();
  else if (a == "undo") undo();
  else if (a == "redo") redo();
  else if (a == "selectAll") selectAll();
  else if (a == "zoomIn") zoomIn();
  else if (a == "zoomOut") zoomOut();
  else if (a == "resetZoom") resetZoom();
  else if (a == "centerView") centerView();
});

tools.addEventListener("input", e => { 
  if (e.target.dataset.a == "top") { 
    topName = e.target.value; 
    sync(); 
  } 
});
tools.addEventListener("change", e => { 
  if (e.target.dataset.a == "rst") { 
    rstLow = e.target.value == "low"; 
    sync(); 
  } 
});

/* ---------- Synchronisation avec le document VS Code ---------- */

const projJson = () => JSON.stringify({ 
  version: 1, 
  topName, 
  rstLow, 
  blocks, 
  links,
  parameters: {},
  testbench: {}
}, null, 1);

function flush() {
  clearTimeout(pending); 
  pending = null;
  if (locked) return;
  const t = projJson();
  if (t === lastText) return;
  lastText = t; 
  vscode.postMessage({ type: "edit", text: t });
}

function commit() { 
  if (locked) return; 
  clearTimeout(pending); 
  pending = setTimeout(flush, 200); 
}

function sync() { 
  draw(); 
  commit(); 
}

function cmd(c, mod) { 
  flush(); 
  vscode.postMessage({ type: "cmd", cmd: c, mod }); 
}

function load(text) {
  if (text === lastText || pending !== null || drag || tmp) return;
  let j = null;
  if (text && text.trim()) {
    try { j = JSON.parse(text); }
    catch { 
      locked = true; 
      blocks = []; 
      links = []; 
      sel = null; 
      selectedBlocks.clear();
      renderProps(); 
      draw(); 
      setHint("JSON invalide : édition verrouillée.", true); 
      vscode.postMessage({ type: "invalid" }); 
      return; 
    }
  }
  locked = false; 
  setHint(HINT, false);
  
  if (j && Array.isArray(j.blocks) && Array.isArray(j.links)) {
    topName = j.topName ?? "top"; 
    blocks = j.blocks; 
    links = j.links; 
    rstLow = j.rstLow !== false;
    
    // Initialiser l'historique
    saveToHistory();
    
    blocks.forEach(b => { 
      if (!PRE[b.kind]) b.kind = "custom"; 
      b.ports = b.ports || []; 
      b.parameters = b.parameters || {};
    });
  } else defaults();
  
  lastText = text;
  if (sel && (sel.t == "b" ? !blocks[sel.i] : !links[sel.i])) sel = null;
  $("#top").value = topName; 
  $("#rp").value = rstLow ? "low" : "high";
  renderProps(); 
  draw();
  
  // Centrer la vue au chargement
  setTimeout(centerView, 100);
}

function setHint(t, err) { 
  const h = $("#hint"); 
  h.textContent = t; 
  h.classList.toggle("err", !!err); 
}

/* ---------- Export SVG ---------- */

function svgString() {
  if (!blocks.length) return null;
  
  // Sauvegarder l'état actuel
  const savedSel = sel;
  const savedSelectedBlocks = new Set(selectedBlocks);
  const savedPanX = panX;
  const savedPanY = panY;
  const savedZoom = zoomLevel;
  
  // Réinitialiser pour l'export
  sel = null;
  selectedBlocks.clear();
  panX = 0;
  panY = 0;
  zoomLevel = 1;
  
  draw();
  
  const c = cv.cloneNode(true);
  
  // Restaurer l'état
  sel = savedSel;
  selectedBlocks = savedSelectedBlocks;
  panX = savedPanX;
  panY = savedPanY;
  zoomLevel = savedZoom;
  
  draw();
  
  c.querySelectorAll(".ph2,.hit,.selection-box").forEach(e => e.remove());
  
  const allX = blocks.flatMap(b => [b.x, b.x + bw(b)]);
  const allY = blocks.flatMap(b => [b.y, b.y + bh(b)]);
  const x0 = Math.min(...allX) - 40, y0 = Math.min(...allY) - 70;
  const x1 = Math.max(...allX) + 40, y1 = Math.max(...allY) + 50;
  
  const css = 'text{font:11px "Cascadia Code",Consolas,"DejaVu Sans Mono",monospace;fill:#e8e8e8}.t{font-size:12px;font-weight:700}.m{font-size:10px;fill-opacity:.75}tspan.w{font-size:9px;fill-opacity:.65}.wire{stroke:#fff;stroke-width:1.8;fill:none}.pv{fill:#fff;stroke:#000;stroke-width:1.5}';
  c.setAttribute("width", x1 - x0); 
  c.setAttribute("height", y1 - y0);
  c.setAttribute("viewBox", `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  c.insertAdjacentHTML("afterbegin", `<style>${css}</style><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#000"/>`);
  
  return new XMLSerializer().serializeToString(c);
}

function exportSvg() { 
  const svg = svgString(); 
  if (svg) vscode.postMessage({ type: "svg", svg, name: (id(topName) || "top") + "_schema.svg" }); 
}

// Initialiser l'historique
saveToHistory();

addEventListener("message", e => { 
  if (e.data && e.data.type === "load") load(e.data.text); 
});

document.addEventListener("visibilitychange", flush);

vscode.postMessage({ type: "ready" });
})();
