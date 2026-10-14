(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory(require("./kinds"));
  else root.VenturiPipeline = factory(root.VenturiKinds);
})(typeof self !== "undefined" ? self : globalThis, function (K) {
"use strict";
/**
 * Logique pure des registres de pipeline (sans DOM, sans VS Code).
 * Chargée dans la webview avant editor.js, et testée directement avec `node --test`.
 */

const idOf = s => String(s).replace(/\W/g, "_");
const P = (name, dir, width, role = "", side = "") => ({ name, dir, width, role, side });

/** Ports standard d'un registre : clk, rst, d, q (largeur w). */
const regPorts = w => [P("clk", "in", 1, "clk"), P("rst", "in", 1, "rst"), P("d", "in", w), P("q", "out", w)];

/** Empreinte des ports, identique à celle de la validation (gen.js) : mêmes ports = module partageable. */
const sigOf = ports => ports.map(p => `${p.dir}:${p.width}:${p.role || ""}:${p.side || ""}:${idOf(p.name)}`).join("|");

const depthOf = b => Math.max(1, Math.floor(b.depth) || 1);
/**
 * Structure d'un module : noms, sens, rôles et côtés des ports. Les largeurs et la profondeur n'en font pas partie :
 * ce sont des paramètres Verilog propres à chaque instance (un seul fichier .v pour toutes les tailles).
 */
const structSig = ports => ports.map(p => `${p.dir}:${p.role || ""}:${p.side ? "S" : ""}:${idOf(p.name)}`).join("|");
const modSig = b => structSig(b.ports);

/**
 * Module d'un nouveau registre : on réutilise celui d'un registre standard déjà présent (quelle que soit sa largeur,
 * la taille est un paramètre de l'instance), sinon `regn` ; suffixe `_2`… si `regn` est déjà pris par d'autres ports.
 */
function regModule(blocks) {
  const std = structSig(regPorts(1));
  const ex = blocks.find(b => b.kind === "register" && structSig(b.ports) === std);
  if (ex) return ex.mod;
  const clash = m => blocks.some(b => b.kind !== "in" && b.kind !== "out" && idOf(b.mod) === m && structSig(b.ports) !== std);
  let m = "regn", n = 2;      // « reg » est un mot réservé en Verilog
  while (clash(m)) m = `regn_${n++}`;
  return m;
}

/** Premier nom d'instance libre `<prefix><n>`. */
function freeInst(blocks, prefix) {
  let n = 1;
  while (blocks.some(b => b.inst === prefix + n)) n++;
  return prefix + n;
}

/** Premier nom de port libre `p<k>` d'un bloc (jamais un doublon, même après des suppressions). */
function freePort(b) {
  const names = new Set(b.ports.map(p => p.name));
  let k = b.ports.length;
  while (names.has("p" + k)) k++;
  return "p" + k;
}

const isIO = b => b.kind === "in" || b.kind === "out";

/**
 * Nom de module attendu pour un bloc d'après ses ports, quand le nom est un nom automatique de mux (mux2, mux4…) :
 * le nombre d'entrées fait partie de la structure. Les tailles n'entrent plus dans les noms (ce sont des paramètres),
 * et un nom choisi à la main n'est jamais touché.
 */
function wantedMod(b) {
  if (b.kind === "mux" && /^mux\d+(w\d+)?(_\d+)?$/.test(b.mod)) return "mux" + b.ports.filter(p => p.dir === "in" && !p.side).length;
  if (K && K.isAuto(b)) return K.modFor(b);          // blocs prêts à l'emploi : le nom suit l'opération et le nombre d'entrées
  return b.mod;
}

/**
 * Nom de module à donner à `b` après une modification de ses ports : jamais un nom déjà pris par un autre bloc dont
 * la STRUCTURE de ports est différente (sinon la génération échoue). Suffixe _2, _3… si besoin. Changer seulement une
 * largeur ne renomme rien : c'est un paramètre de l'instance.
 */
function adaptModule(blocks, b) {
  if (isIO(b)) return b.mod;
  const want = wantedMod(b), base = want.replace(/_\d+$/, "");
  const clash = m => blocks.some(o => o !== b && !isIO(o) && idOf(o.mod) === idOf(m) && modSig(o) !== modSig(b));
  let m = want, n = 2;
  while (clash(m)) m = `${base}_${n++}`;
  return m;
}

/** Nouveau registre compact de largeur w (position à fixer par l'appelant). */
function makeRegister(blocks, w) {
  w = Math.max(1, Math.floor(w) || 1);
  return { inst: freeInst(blocks, "r"), mod: regModule(blocks), kind: "register", x: 0, y: 0, color: "", compact: true, ports: regPorts(w) };
}

/**
 * Remplace le lien k (A → B) par A → reg.d et reg.q → B.
 * @returns {{from:string,to:string}[]} nouvelle liste de liens (l'originale n'est pas modifiée)
 */
function spliceLink(links, k, reg) {
  const l = links[k];
  if (!l) return links.slice();
  const out = links.slice();
  out[k] = { from: l.from, to: `${reg.inst}.d` };
  out.push({ from: `${reg.inst}.q`, to: l.to });
  return out;
}

/** Décale vers la droite (de dx) tous les blocs dont x >= cutX. Modifie `blocks`. */
function makeRoom(blocks, cutX, dx) {
  blocks.forEach(b => { if (b.x >= cutX) b.x += dx; });
}

/* ---------- Ligne de coupe : un étage de pipeline en un geste ---------- */
/*
 * `geo` fournit la géométrie de l'éditeur (sans quoi cette logique resterait liée au DOM) :
 *   geo.port(ref) → { b, p, x, y, side } | null     position et côté d'un port ("inst.port")
 *   geo.bw(b), geo.bh(b)                            taille d'un bloc
 */

/** Écarte la coupe des blocs qu'elle traverserait : on la repousse juste à droite du bloc. */
function adjustCut(blocks, X, geo) {
  for (let n = 0; n < 50; n++) {
    const hit = blocks.filter(b => b.x < X && X < b.x + geo.bw(b));
    if (!hit.length) return X;
    X = Math.max(...hit.map(b => b.x + geo.bw(b))) + 20;
  }
  return X;
}

/**
 * Indices des liens qui traversent X de gauche à droite : sortie à gauche de X, entrée à droite de X.
 * L'entrée peut être sur n'importe quel côté (gauche, mais aussi haut/bas : sel d'un mux, par exemple).
 */
function crossing(links, X, geo) {
  const out = [];
  links.forEach((l, k) => {
    const f = geo.port(l.from), t = geo.port(l.to);
    if (f && t && f.p.dir === "out" && t.p.dir === "in" && f.side === "right" && t.side !== "right" && f.x < X && X < t.x) out.push(k);
  });
  return out;
}

/**
 * Insère un registre sur chaque signal qui traverse la ligne X. Un signal qui alimente plusieurs blocs
 * à droite n'est enregistré qu'une fois (un seul registre, qui se ramifie). Les blocs à droite de la ligne
 * sont décalés pour faire de la place. Modifie `blocks` (décalage + ajout des registres).
 * @returns {{links:any[], regs:any[], count:number, x:number}}
 */
function insertCut(blocks, links, X, geo) {
  X = adjustCut(blocks, X, geo);
  const idx = crossing(links, X, geo);
  if (!idx.length) return { links, regs: [], count: 0, x: X };
  const groups = new Map();
  idx.forEach(k => {
    const l = links[k], f = geo.port(l.from);
    if (!groups.has(l.from)) groups.set(l.from, { from: l.from, y: f.y, w: f.p.width, ks: [] });
    groups.get(l.from).ks.push(k);
  });
  const gs = [...groups.values()].sort((a, b) => a.y - b.y);
  const regs = [];
  gs.forEach(g => { g.reg = makeRegister(blocks.concat(regs), g.w); regs.push(g.reg); });
  const rw = Math.max(...regs.map(r => geo.bw(r))), D = Math.ceil((rw + 40) / 20) * 20;
  blocks.forEach(b => { if (b.x >= X) b.x += D; });
  let bottom = -Infinity;
  gs.forEach(g => {
    const r = g.reg, h = geo.bh(r);
    r.x = X + Math.round((D - geo.bw(r)) / 2);
    r.y = Math.max(Math.round(g.y - (geo.center ? geo.center(r) : h / 2)), bottom + 20);
    bottom = r.y + h;
  });
  const drop = new Set(idx), nl = links.filter((_, k) => !drop.has(k));
  gs.forEach(g => {
    nl.push({ from: g.from, to: g.reg.inst + ".d" });
    g.ks.forEach(k => nl.push({ from: g.reg.inst + ".q", to: links[k].to }));
  });
  regs.forEach(r => blocks.push(r));
  return { links: nl, regs, count: regs.length, x: X };
}

/* ---------- Latence ---------- */

/**
 * Latence en cycles : plus long chemin entrée → sortie, en comptant la profondeur de chaque registre
 * traversé (registre simple = 1, registre ×N = N). Les boucles (rétroaction) sont ignorées et signalées.
 * @returns {{cycles:number|null, cyclic:boolean}}  cycles = null si aucune entrée n'atteint une sortie
 */
function latency(blocks, links) {
  const idx = new Map(blocks.map((b, i) => [b.inst, i]));
  const adj = blocks.map(() => []);
  links.forEach(l => {
    const a = idx.get(String(l.from).split(".")[0]), b = idx.get(String(l.to).split(".")[0]);
    if (a !== undefined && b !== undefined) adj[a].push(b);
  });
  const wt = b => (b.kind === "register" ? depthOf(b) : b.kind === "counter" || b.kind === "ram" ? 1 : 0);   // compteur et RAM : sortie enregistrée
  const state = blocks.map(() => 0), memo = blocks.map(() => null);
  let cyclic = false;
  const visit = i => {
    if (state[i] === 2) return memo[i];
    if (state[i] === 1) { cyclic = true; return -Infinity; }
    state[i] = 1;
    let best = blocks[i].kind === "out" ? 0 : -Infinity;
    adj[i].forEach(j => { best = Math.max(best, visit(j)); });
    state[i] = 2;
    return (memo[i] = best === -Infinity ? -Infinity : best + wt(blocks[i]));
  };
  let cycles = -Infinity;
  blocks.forEach((b, i) => { if (b.kind === "in") cycles = Math.max(cycles, visit(i)); });
  blocks.forEach((_, i) => visit(i));
  return { cycles: cycles === -Infinity ? null : cycles, cyclic };
}

return { freePort, wantedMod, adaptModule, structSig, idOf, regPorts, sigOf, regModule, freeInst, makeRegister, spliceLink, makeRoom, adjustCut, crossing, insertCut, latency, depthOf };
});
