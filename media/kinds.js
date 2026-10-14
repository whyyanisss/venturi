(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VenturiKinds = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
"use strict";
/**
 * Blocs prêts à l'emploi : constante, logique, comparateur, compteur, décaleur, extraction de bits, concaténation, RAM.
 * Logique pure : ports par défaut, nom de module automatique, symbole dessiné, ports dérivés (largeur d'une sortie).
 * Les corps Verilog correspondants sont dans src/gen.js.
 */
const P = (name, dir, width, role = "", side = "") => ({ name, dir, width, role, side });

const KINDS = ["const", "logic", "cmp", "counter", "shift", "slice", "concat", "ram"];
const META = {
  const: { pre: "k", col: "#64748b", label: "Constante" },
  logic: { pre: "g", col: "#7c3aed", label: "Logique" },
  cmp: { pre: "c", col: "#0891b2", label: "Comparateur" },
  counter: { pre: "ct", col: "#16a34a", label: "Compteur" },
  shift: { pre: "sh", col: "#ca8a04", label: "Décaleur" },
  slice: { pre: "sl", col: "#be185d", label: "Extraction de bits" },
  concat: { pre: "cc", col: "#9333ea", label: "Concaténation" },
  ram: { pre: "ram", col: "#b45309", label: "RAM" }
};
const OPS = {
  logic: [["and", "ET  (&)"], ["or", "OU  (|)"], ["xor", "OU exclusif  (^)"], ["nand", "NON-ET"], ["nor", "NON-OU"], ["xnor", "NON-OU exclusif"], ["not", "NON  (~)"]],
  cmp: [["eq", "égal  (==)"], ["ne", "différent  (!=)"], ["lt", "inférieur  (<)"], ["le", "inférieur ou égal  (<=)"], ["gt", "supérieur  (>)"], ["ge", "supérieur ou égal  (>=)"]],
  shift: [["shl", "à gauche  (<<)"], ["shr", "à droite, logique  (>>)"], ["sra", "à droite, arithmétique  (>>>)"]],
  counter: [["up", "compte"], ["down", "décompte"]]
};
const SYM = { and: "&", or: "|", xor: "^", nand: "~&", nor: "~|", xnor: "~^", not: "~", eq: "==", ne: "!=", lt: "<", le: "<=", gt: ">", ge: ">=", shl: "<<", shr: ">>", sra: ">>>" };
const letter = i => String.fromCharCode(97 + i);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(+v) || lo));
const dataIns = b => b.ports.filter(p => p.dir === "in" && !p.role && !p.side);
const find = (b, name) => b.ports.find(p => p.name === name);

/** Ports d'un bloc d'après ses réglages (o : op, n, w, aw, hi, lo, widths). */
function ports(kind, o = {}) {
  const w = clamp(o.w ?? 8, 1, 4096);
  switch (kind) {
    case "const": return [P("y", "out", w)];
    case "logic": { const n = o.op === "not" ? 1 : clamp(o.n ?? 2, 2, 8); return [...Array(n)].map((_, i) => P(letter(i), "in", w)).concat(P("y", "out", w)); }
    case "cmp": return [P("a", "in", w), P("b", "in", w), P("y", "out", 1)];
    case "counter": return [P("clk", "in", 1, "clk"), P("rst", "in", 1, "rst"), P("en", "in", 1), P("q", "out", w)];
    case "shift": return [P("a", "in", w), P("y", "out", w)];
    case "slice": { const hi = clamp(o.hi ?? 3, 0, 4095), lo = clamp(o.lo ?? 0, 0, hi); return [P("a", "in", Math.max(w, hi + 1)), P("y", "out", hi - lo + 1)]; }
    case "concat": { const n = clamp(o.n ?? 2, 2, 8), ws = o.widths || []; const ins = [...Array(n)].map((_, i) => P(letter(i), "in", clamp(ws[i] ?? 4, 1, 4096))); return [...ins, P("y", "out", ins.reduce((s, p) => s + p.width, 0))]; }
    case "ram": return [P("clk", "in", 1, "clk"), P("we", "in", 1), P("addr", "in", clamp(o.aw ?? 4, 1, 24)), P("din", "in", w), P("dout", "out", w)];
    default: return null;
  }
}

/** Réglages lus dans un bloc existant (pour reconstruire ses ports après une modification). */
function opts(b) {
  const o = { op: b.op, hi: b.hi, lo: b.lo };
  const ins = dataIns(b), out = b.ports.find(p => p.dir === "out");
  switch (b.kind) {
    case "const": o.w = out.width; break;
    case "logic": o.n = ins.length; o.w = ins[0] ? ins[0].width : 8; break;
    case "cmp": case "shift": o.w = ins[0] ? ins[0].width : 8; break;
    case "counter": o.w = out.width; break;
    case "slice": o.w = ins[0] ? ins[0].width : 8; break;
    case "concat": o.n = ins.length; o.widths = ins.map(p => p.width); break;
    case "ram": o.w = (find(b, "din") || out).width; o.aw = (find(b, "addr") || { width: 4 }).width; break;
  }
  return o;
}

/** Nouveau bloc : ports, module, réglages facultatifs. */
function defaults(kind) {
  const f = { const: { value: "0" }, logic: { op: "and" }, cmp: { op: "eq" }, counter: { op: "up" }, shift: { op: "shl", amount: 1 }, slice: { hi: 3, lo: 0 } }[kind] || {};
  const b = { kind, ...f };
  b.ports = ports(kind, opts({ kind, ...f, ports: ports(kind, f) }));
  b.mod = modFor(b);
  return { ...f, ports: b.ports, mod: b.mod, compact: kind !== "ram" };
}

/** Nouveaux ports après une modification (patch = { op, n, w, aw, hi, lo, widths }). */
function rebuild(b, patch = {}) {
  const o = { ...opts(b), ...patch };
  if (b.kind === "slice") { o.hi = clamp(o.hi ?? 3, 0, 4095); o.lo = clamp(o.lo ?? 0, 0, o.hi); }
  return ports(b.kind, o);
}

/** Nom de module automatique d'un bloc. */
function modFor(b) {
  const n = dataIns(b).length;
  switch (b.kind) {
    case "const": return "constn";
    case "logic": return b.op === "not" ? "inv" : `${b.op || "and"}${n}`;
    case "cmp": return `cmp_${b.op || "eq"}`;
    case "counter": return `counter_${b.op || "up"}`;
    case "shift": return `shift_${b.op || "shl"}`;
    case "slice": return "slice";
    case "concat": return `concat${n}`;
    case "ram": return "ram";
    default: return b.mod;
  }
}

const AUTO = {
  const: /^constn(_\d+)?$/, logic: /^((and|or|xor|nand|nor|xnor)\d+|inv)(_\d+)?$/, cmp: /^cmp_(eq|ne|lt|le|gt|ge)(_\d+)?$/,
  counter: /^counter_(up|down)(_\d+)?$/, shift: /^shift_(shl|shr|sra)(_\d+)?$/, slice: /^slice(_\d+)?$/, concat: /^concat\d+(_\d+)?$/, ram: /^ram(_\d+)?$/
};
/** Vrai si le nom de module de `b` est un nom automatique (il peut suivre les réglages du bloc). */
const isAuto = b => !!AUTO[b.kind] && AUTO[b.kind].test(b.mod || "");

/** Texte dessiné au centre d'un bloc compact (null = rien de particulier). */
function symbol(b) {
  switch (b.kind) {
    case "const": { const v = String(b.value ?? "0"); return v.length > 6 ? v.slice(0, 5) + "…" : v; }
    case "logic": case "cmp": return SYM[b.op || (b.kind === "logic" ? "and" : "eq")];
    case "shift": return `${SYM[b.op || "shl"]}${Math.max(0, Math.floor(b.amount) || 0)}`;
    case "slice": return `[${b.hi ?? 3}:${b.lo ?? 0}]`;
    case "concat": return "{ }";
    case "counter": return b.op === "down" ? "−1" : "+1";
    default: return null;
  }
}

/** Ports calculés par le bloc lui-même (largeur d'une sortie). Retourne true si quelque chose a changé. */
function syncDerived(b) {
  const y = find(b, "y");
  let want = null;
  if (b.kind === "cmp") want = 1;
  else if (b.kind === "slice") want = Math.max(1, (b.hi ?? 3) - (b.lo ?? 0) + 1);
  else if (b.kind === "concat") want = dataIns(b).reduce((s, p) => s + p.width, 0);
  if (!y || want === null || y.width === want) return false;
  y.width = want;
  return true;
}

/** Valeur d'une constante en Verilog (`8'd255`, `8'hFF`, `8'b1010`), ou null si elle est invalide. */
function valueLiteral(raw, w) {
  const s = String(raw ?? "0").trim().replace(/_/g, "");
  let m;
  if ((m = s.match(/^0x([0-9a-f]+)$/i))) return `${w}'h${m[1]}`;
  if ((m = s.match(/^0b([01]+)$/i))) return `${w}'b${m[1]}`;
  if (/^\d+$/.test(s)) return `${w}'d${s}`;
  return null;
}
/** Valeur numérique d'une constante (BigInt) ou null. */
function valueNumber(raw) {
  const s = String(raw ?? "0").trim().replace(/_/g, "");
  if (/^0x[0-9a-f]+$/i.test(s) || /^0b[01]+$/i.test(s) || /^\d+$/.test(s)) return BigInt(s);
  return null;
}

return { KINDS, META, OPS, SYM, ports, opts, defaults, rebuild, modFor, isAuto, symbol, syncDerived, valueLiteral, valueNumber, dataIns, clamp };
});
