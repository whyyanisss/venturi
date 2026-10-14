(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VenturiLayout = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
"use strict";
/**
 * Géométrie des blocs et des ports sur une grille de 20 px (logique pure, sans DOM).
 *
 * Règle : si un bloc est posé sur la grille, TOUS ses ports tombent sur la grille. Deux blocs posés sur la grille
 * se relient donc par un fil droit dès que leurs ports sont à la même hauteur, sans « aimant » approximatif.
 * Les hauteurs de blocs sont des multiples de 40 pour que le port unique d'un côté soit exactement au centre.
 */
const G = 20;
const up = (v, m) => Math.ceil(v / m) * m;

/** Côté d'un port : clk/rst et `side:"bottom"` en bas, `side:"top"` en haut, sinon gauche (entrée) / droite (sortie). */
const sideOf = p => (p.role === "clk" || p.role === "rst" || p.side === "bottom" ? "bottom" : p.side === "top" ? "top" : p.dir === "in" ? "left" : "right");

/**
 * Positions (multiples de 20 depuis le début du bord) de n ports le long d'un bord de longueur `total`.
 * Ports répartis symétriquement ; trop de ports → lignes consécutives (le bloc doit alors être agrandi).
 */
function slots(n, total) {
  if (n <= 0) return [];
  const L = Math.max(1, Math.floor(total / G) - 1);          // lignes disponibles : 20, 40, … , L·20
  if (n >= L) return Array.from({ length: n }, (_, i) => (i + 1) * G);
  if (n === 1) return [Math.floor((L + 1) / 2) * G];
  const M = L + 1, half = Math.floor(n / 2), idx = [];
  for (let i = 0; i < half; i++) idx.push(Math.max(1, Math.floor((i + 1) * M / (n + 1))));
  const res = [...idx, ...(n % 2 ? [Math.floor(M / 2)] : []), ...idx.slice().reverse().map(v => M - v)];
  if (res.every((v, i) => v >= 1 && v <= L && (i === 0 || v > res[i - 1]))) return res.map(v => v * G);
  const start = Math.floor((L - n) / 2) + 1;
  return Array.from({ length: n }, (_, i) => (start + i) * G);
}

/** Hauteur d'un bloc : multiple de 40, assez grand pour ses ports (n = max de ports sur un côté gauche/droit). */
function height(kind, n, { compact = false, width = 100 } = {}) {
  if (kind === "in" || kind === "out") return 40;
  const need = G * (Math.max(1, n) + 1);
  if (compact && kind === "const") return 40;                  // une constante n'a qu'une sortie : petit bloc
  if (compact) return up(Math.max(80, need), 40);
  if (kind === "adder") return up(Math.max(width, need), 40);
  const base = kind === "mux" ? 160 : 120;
  return up(Math.max(base, need, width + 20), 40);
}

/** Pente des bords d'un mux (trapèze) : un port du haut descend, un port du bas remonte de `SLANT · h · (x − x0) / w`. */
const SLANT = 0.27;

/**
 * Position de chaque port de `b` (même ordre que b.ports) : { x, y, side }.
 * @param {{bw:(b:any)=>number, bh:(b:any)=>number}} geo
 */
function portPositions(b, geo) {
  const w = geo.bw(b), h = geo.bh(b), sides = b.ports.map(sideOf), out = new Array(b.ports.length);
  ["left", "right", "top", "bottom"].forEach(s => {
    const ids = b.ports.map((_, j) => j).filter(j => sides[j] === s);
    const sl = slots(ids.length, s === "left" || s === "right" ? h : w);
    ids.forEach((j, k) => {
      if (s === "left" || s === "right") out[j] = { x: b.x + (s === "right" ? w : 0), y: b.y + sl[k], side: s };
      else {
        const x = b.x + sl[k];
        const slope = b.kind === "mux" ? Math.round(h * SLANT) * (x - b.x) / w : 0;     // trapèze symétrique : haut et bas s'inclinent
        out[j] = { x, y: s === "top" ? b.y + slope : b.y + h - slope, side: s };
      }
    });
  });
  return out;
}

const split = r => { const k = String(r).indexOf("."); return [String(r).slice(0, k), String(r).slice(k + 1)]; };

/**
 * Redresse les fils : chaque bloc de `idxs` (tous par défaut) est décalé verticalement pour que ses entrées de gauche
 * soient à la hauteur de leurs sources (médiane s'il y a plusieurs sources), de gauche à droite pour que
 * l'alignement se propage le long d'un pipeline. Modifie `blocks`. Retourne le nombre de blocs déplacés.
 */
function straighten(blocks, links, idxs, geo, minY = 0) {
  const set = new Set(idxs && idxs.length ? idxs : blocks.map((_, i) => i));
  const byInst = new Map(blocks.map((b, i) => [b.inst, i]));
  let moved = 0;
  [...set].sort((a, b) => blocks[a].x - blocks[b].x).forEach(i => {
    const b = blocks[i], mine = portPositions(b, geo), deltas = [];
    links.forEach(l => {
      const [ti, tp] = split(l.to);
      if (byInst.get(ti) !== i) return;
      const t = b.ports.findIndex(p => p.name === tp);
      const fi = byInst.get(split(l.from)[0]);
      if (t < 0 || fi === undefined || mine[t].side !== "left") return;
      const fb = blocks[fi], f = fb.ports.findIndex(p => p.name === split(l.from)[1]);
      if (f < 0) return;
      const fp = portPositions(fb, geo)[f];
      if (fp.side === "right") deltas.push(fp.y - mine[t].y);
    });
    if (!deltas.length) return;
    deltas.sort((p, q) => p - q);
    const d = deltas[Math.floor((deltas.length - 1) / 2)];
    if (Math.abs(d) < 0.5) return;
    b.y = Math.max(minY, Math.round(b.y + d));
    moved++;
  });
  return moved;
}

/**
 * Guides d'alignement pendant le déplacement du bloc `mi` : lignes horizontales (ports gauche/droite à la même
 * hauteur qu'un port d'un autre bloc) et verticales (ports haut/bas à la même abscisse).
 * @returns {{h:{y:number,x0:number,x1:number}[], v:{x:number,y0:number,y1:number}[]}}
 */
function guides(blocks, mi, geo) {
  const me = portPositions(blocks[mi], geo), res = { h: [], v: [] };
  blocks.forEach((o, i) => {
    if (i === mi) return;
    const their = portPositions(o, geo);
    me.forEach(a => their.forEach(c => {
      if ((a.side === "left" || a.side === "right") && (c.side === "left" || c.side === "right") && Math.abs(a.y - c.y) < 0.5)
        res.h.push({ y: a.y, x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x) });
      if ((a.side === "top" || a.side === "bottom") && (c.side === "top" || c.side === "bottom") && Math.abs(a.x - c.x) < 0.5)
        res.v.push({ x: a.x, y0: Math.min(a.y, c.y), y1: Math.max(a.y, c.y) });
    }));
  });
  return res;
}

/** Aligne tous les blocs sur la grille de 20 px. Retourne le nombre de blocs modifiés. */
function snapAll(blocks) {
  let n = 0;
  blocks.forEach(b => {
    const x = Math.round(b.x / G) * G, y = Math.round(b.y / G) * G;
    if (x !== b.x || y !== b.y) { b.x = x; b.y = y; n++; }
  });
  return n;
}

const offGrid = blocks => blocks.some(b => b.x % G !== 0 || b.y % G !== 0);

return { G, up, sideOf, slots, height, SLANT, portPositions, straighten, guides, snapAll, offGrid };
});
