(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VenturiGroup = factory();
})(typeof self !== "undefined" ? self : globalThis, function () {
"use strict";
/**
 * Sélection multiple : sélection par rectangle, alignement, répartition, copier-coller avec les liens
 * internes. Logique pure ; la taille des blocs est fournie par l'éditeur (`geo.bw`, `geo.bh`).
 */
const clone = o => JSON.parse(JSON.stringify(o));
const inst = ref => String(ref).split(".")[0];

/** Indices des blocs qui touchent le rectangle {x0,y0,x1,y1} (coins quelconques). */
function hit(blocks, rect, geo) {
  const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1), y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
  const out = [];
  blocks.forEach((b, i) => { if (b.x < x1 && b.x + geo.bw(b) > x0 && b.y < y1 && b.y + geo.bh(b) > y0) out.push(i); });
  return out;
}

/** Aligne les blocs idxs : left | right | top | bottom | hcenter | vcenter. Modifie `blocks`. */
function align(blocks, idxs, mode, geo) {
  if (idxs.length < 2) return;
  const B = idxs.map(i => blocks[i]);
  const minX = Math.min(...B.map(b => b.x)), maxR = Math.max(...B.map(b => b.x + geo.bw(b)));
  const minY = Math.min(...B.map(b => b.y)), maxB = Math.max(...B.map(b => b.y + geo.bh(b)));
  B.forEach(b => {
    if (mode === "left") b.x = minX;
    else if (mode === "right") b.x = maxR - geo.bw(b);
    else if (mode === "hcenter") b.x = Math.round((minX + maxR) / 2 - geo.bw(b) / 2);
    else if (mode === "top") b.y = minY;
    else if (mode === "bottom") b.y = maxB - geo.bh(b);
    else if (mode === "vcenter") b.y = Math.round((minY + maxB) / 2 - geo.bh(b) / 2);
  });
}

/** Répartit les blocs idxs à intervalles égaux ("h" horizontalement, "v" verticalement). Les extrémités restent en place. */
function distribute(blocks, idxs, axis, geo) {
  if (idxs.length < 3) return;
  const h = axis === "h", pos = b => (h ? b.x : b.y), size = b => (h ? geo.bw(b) : geo.bh(b));
  const B = idxs.map(i => blocks[i]).sort((a, b) => pos(a) - pos(b));
  const first = pos(B[0]), last = pos(B[B.length - 1]) + size(B[B.length - 1]);
  const gap = (last - first - B.reduce((s, b) => s + size(b), 0)) / (B.length - 1);
  let cur = first;
  B.forEach(b => { if (h) b.x = Math.round(cur); else b.y = Math.round(cur); cur += size(b) + gap; });
}

/** Copie les blocs idxs et les liens dont les deux extrémités sont dans la sélection. */
function copyGroup(blocks, links, idxs) {
  const sorted = [...idxs].sort((a, b) => a - b), names = new Set(sorted.map(i => blocks[i].inst));
  return { blocks: sorted.map(i => clone(blocks[i])), links: links.filter(l => names.has(inst(l.from)) && names.has(inst(l.to))).map(clone) };
}

/**
 * Prépare le collage : nouveaux noms d'instance libres (préfixe `pre(kind)`), décalage (dx, dy),
 * liens internes renommés. Ne modifie ni `blocks` ni `links`.
 */
function pasteGroup(blocks, links, clip, dx, dy, pre) {
  const taken = new Set(blocks.map(b => b.inst)), map = {};
  const nb = clip.blocks.map(src => {
    const b = clone(src), p = pre(b.kind);
    let n = 1;
    while (taken.has(p + n)) n++;
    b.inst = p + n; taken.add(b.inst); map[src.inst] = b.inst;
    b.x += dx; b.y += dy;
    return b;
  });
  const ren = r => { const k = r.indexOf("."); const o = r.slice(0, k); return (map[o] !== undefined ? map[o] : o) + r.slice(k); };
  const nl = clip.links.map(l => { const c = { from: ren(l.from), to: ren(l.to) }; if (typeof l.mx === "number") c.mx = l.mx + dx; return c; });
  return { blocks: nb, links: nl };
}

return { hit, align, distribute, copyGroup, pasteGroup };
});
