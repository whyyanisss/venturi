(function () {
"use strict";
const vscode = acquireVsCodeApi();
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const id = s => String(s).replace(/\W/g, "_");
const snap = v => Math.round(v / 20) * 20;
const HINT = $("#hint").textContent;
let topName = "chain", lite = false, rstLow = true, sel = null, drag = null, tmp = null, clip = null;
let lastText = null, pending = null, locked = false, lastWire = { i: -1, t: 0 }, wdrag = null;
let msel = [], bands = [], box = null, pan = null, bdrag = null, rdrag = null, cutMode = false, cutX = null, spaceDown = false, zoom = 1;
const PL = window.VenturiPipeline, WR = window.VenturiWire, GP = window.VenturiGroup, LY = window.VenturiLayout, K = window.VenturiKinds;
const BAND_TOP = 30, MINY = 60;   // les bandes commencent sous le bord haut ; aucun bloc au-dessus de MINY
const BAND = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6"], BAND_NAMES = ["IF", "ID", "EX", "MEM", "WB"];

/* ---------- Types de blocs ---------- */
const P = (name, dir, width, role = "", side = "") => ({ name, dir, width, role, side });
const muxPorts = (n, w) => [...Array(n)].map((_, i) => P("i" + i, "in", w)).concat(P("sel", "in", Math.max(1, Math.ceil(Math.log2(n))), "", "bottom"), P("y", "out", w));
const PRE = { register: "r", adder: "a", mux: "m", custom: "u", in: "in", out: "out" };
const COL = { register: "#065b07", adder: "#f97316", mux: "#112f5f", custom: "#dc2626", in: "#0d9488", out: "#db2777" };
K.KINDS.forEach(k => { PRE[k] = K.META[k].pre; COL[k] = K.META[k].col; });      // constante, logique, comparateur, compteur…
const rgb = c => [1, 3, 5].map(i => parseInt(c.substr(i, 2), 16));
const ink = c => { const [r, g, b] = rgb(c); return .299 * r + .587 * g + .114 * b > 200 ? "#000" : "#fff"; };
const dark = (c, f = .35) => "#" + rgb(c).map(v => Math.round(v * (1 - f)).toString(16).padStart(2, "0")).join("");
const defPorts = k => K.KINDS.includes(k) ? K.defaults(k).ports : ({
  register: [P("clk", "in", 1, "clk"), P("rst", "in", 1, "rst"), P("d", "in", 8), P("q", "out", 8)],
  adder: [P("a", "in", 8), P("b", "in", 8), P("s", "out", 8)],
  mux: muxPorts(2, 8), custom: [P("a", "in", 1), P("y", "out", 1)], in: [P("p", "out", 8)], out: [P("p", "in", 8)] }[k]);
const defMod = (k, n) => K.KINDS.includes(k) ? K.defaults(k).mod : ({ register: "regn", adder: "addn", mux: "mux2", custom: "bloc" + n, in: "", out: "" }[k]);
const optsHtml = (arr, cur) => arr.map(([v, t]) => `<option value="${v}"${v == cur ? " selected" : ""}>${t}</option>`).join("");
const mk = (kind, x, y, n) => K.KINDS.includes(kind) ? (({ ports, mod, compact, ...rest }) => ({ inst: PRE[kind] + n, mod, kind, x, y, color: "", ...(compact ? { compact: true } : {}), ...rest, ports }))(K.defaults(kind)) : ({ inst: PRE[kind] + n, mod: defMod(kind, n), kind, x, y, color: "", ...(kind == "register" || kind == "adder" ? { compact: true } : {}), ports: defPorts(kind) });
const col = b => b.color || COL[b.kind];
const isIO = b => b.kind == "in" || b.kind == "out";
const pn = p => p.role == "rst" ? id(p.name).replace(/_n$/, "") + (rstLow ? "_n" : "") : id(p.name);
const lab = (b, p) => b.kind == "mux" && p.dir == "in" && !p.side ? p.name.slice(1) : p.role == "rst" ? pn(p) : p.name;
const dw = b => { const o = b.ports.find(p => p.dir == "out" && !p.role); return o ? o.width : 1; };
const sized = (b, k) => (b.kind == "custom" && typeof b[k] == "number" && b[k] >= 40 ? b[k] : null);
const bw = b => {
  if (sized(b, "w")) return b.w;
  if (b.compact && !isIO(b)) return 60;                         // taille fixe : un pipeline reste aligné quel que soit le nom
  if (isIO(b)) return Math.max(80, Math.ceil((b.inst.length * 7.4 + (b.ports[0].width > 1 ? 14 : 0) + 40) / 20) * 20);
  if (lite) return Math.max(80, Math.ceil((b.inst.length * 7.4 + 36) / 20) * 20);
  const n = g => Math.max(0, ...g.map(p => lab(b, p).length + (p.width > 1 ? 2 : 0)));
  const cw = Math.max(b.inst.length * 7.4, b.mod.length * 6.2) + 10;
  return Math.max(100, Math.ceil((n(grp(b, "left")) * 6.6 + n(grp(b, "right")) * 6.6 + 28 + cw) / 20) * 20);
};
/** Hauteur : multiple de 40 (voir layout.js), pour que les ports tombent sur la grille. */
const bh = b => {
  if (sized(b, "h")) return b.h;
  return LY.height(b.kind, Math.max(1, grp(b, "left").length, grp(b, "right").length), { compact: !!b.compact, width: bw(b) });
};
const mi = b => Math.round(bh(b) * .27);
let blocks = [], links = [];
const defaults = () => {
  const i = mk("in", 20, 140, 1), o = mk("out", 620, 140, 1); i.inst = "din"; o.inst = "dout";
  blocks = [i, mk("register", 160, 120, 1), mk("register", 440, 120, 2), o];
  links = [{ from: "din.p", to: "r1.d" }, { from: "r1.q", to: "r2.d" }, { from: "r2.q", to: "dout.p" }];
};

const find = r => {
  const k = r.indexOf("."), bi = blocks.findIndex(x => x.inst == r.slice(0, k));
  const pj = bi < 0 ? -1 : blocks[bi].ports.findIndex(p => p.name == r.slice(k + 1));
  return pj < 0 ? null : { bi, pj, b: blocks[bi], p: blocks[bi].ports[pj] };
};
const side = LY.sideOf;
const grp = (b, s) => b.ports.filter(p => side(p) == s);
function pp(bi, pj) { const q = LY.portPositions(blocks[bi], geo)[pj]; return [q.x, q.y]; }

/** Géométrie exposée à la logique pure (ligne de coupe, alignement…). */
const geo = {
  bw, bh,
  center: b => LY.slots(1, bh(b))[0],                 // ordonnée (depuis le haut) du port unique d'un côté : centre sur la grille
  port(ref) { const f = find(ref); if (!f) return null; const [x, y] = pp(f.bi, f.pj); return { b: f.b, p: f.p, x, y, side: side(f.p) }; }
};
function extent() {
  let w = 3000, h = 2000;
  blocks.forEach(b => { w = Math.max(w, b.x + bw(b) + 600); h = Math.max(h, b.y + bh(b) + 600); });
  bands.forEach(bd => { w = Math.max(w, bd.x + bd.w + 600); });
  return { w, h };
}
function updLat() {
  const r = PL.latency(blocks, links);
  $("#lat").textContent = r.cycles == null ? "Latence : —" : `Latence : ${r.cycles} cycle${r.cycles > 1 ? "s" : ""}${r.cyclic ? " (boucle)" : ""}`;
}

/* ---------- Canevas ---------- */
function route(f, t, l) {
  const [x1, y1] = pp(f.bi, f.pj), [x2, y2] = pp(t.bi, t.pj);
  if (side(t.p) == "bottom") {
    const ye = y2 + 7;
    return x2 > x1 + 24 && y1 > ye + 12 ? `M${x1} ${y1}H${x2}V${ye}` : `M${x1} ${y1}H${x1 + 24}V${WR.chanY(ye + 30, l && l.my, ye + 8, Infinity)}H${x2}V${ye}`;
  }
  if (side(t.p) == "top") {
    const ye = y2 - 7;
    return x2 > x1 + 24 && y1 < ye - 12 ? `M${x1} ${y1}H${x2}V${ye}` : `M${x1} ${y1}H${x1 + 24}V${WR.chanY(ye - 30, l && l.my, -Infinity, ye - 8)}H${x2}V${ye}`;
  }
  const e = x2 - 7;
  if (x2 - x1 >= 50) return `M${x1} ${y1}H${WR.midX(x1, x2, l && l.mx)}V${y2}H${e}`;
  const yt = WR.chanY(Math.min(blocks[f.bi].y, blocks[t.bi].y) - 28, l && l.my, 10, Infinity);
  return `M${x1} ${y1}H${x1 + 24}V${yt}H${x2 - 24}V${y2}H${e}`;
}
function draw() {
  const mark = (i, c) => `<marker id="${i}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`;
  const { w: W, h: H } = extent();
  let s = `<defs>${mark("ar", "#fff")}${mark("as", "#ffd24a")}${mark("ac", "#4cc9f0")}</defs>`;
  bands.forEach((bd, i) => {
    const on = sel && sel.t == "s" && sel.i == i, c = bd.color || BAND[i % BAND.length];
    s += `<rect class="band" x="${bd.x}" y="${BAND_TOP}" width="${bd.w}" height="${H - BAND_TOP}" fill="${c}" stroke="${c}"/>`
      + `<rect class="bh${on ? " on" : ""}" data-s="${i}" data-sm="move" x="${bd.x}" y="${BAND_TOP}" width="${bd.w}" height="26" fill="${c}"/>`
      + `<text class="bt" x="${bd.x + bd.w / 2}" y="${BAND_TOP + 17}" text-anchor="middle">${esc(bd.name)}</text>`
      + `<rect class="bg" data-s="${i}" data-sm="size" x="${bd.x + bd.w - 8}" y="${BAND_TOP}" width="8" height="26"/>`;
  });
  const cutIdx = cutMode && cutX != null ? new Set(PL.crossing(links, cutX, geo)) : null;
  links.forEach((l, k) => {
    const f = find(l.from), t = find(l.to); if (!f || !t) return;
    const on = sel && sel.t == "l" && sel.i == k, cut = cutIdx && cutIdx.has(k), dd = route(f, t, l);
    s += `<path class="hit" data-l="${k}" data-m="${wireMovable(l) || ""}" d="${dd}"/><path class="wire${on ? " on" : ""}${cut ? " cut" : ""}" d="${dd}" marker-end="url(#${on ? "as" : cut ? "ac" : "ar"})"/>`;
  });
  if (tmp) {
    s += `<path class="tmp" d="M${tmp.x} ${tmp.y}L${tmp.mx} ${tmp.my}"/>`;
    if (tmp.hov) { const [x, y] = pp(tmp.hov.bi, tmp.hov.pj); s += `<circle class="ring" cx="${x}" cy="${y}" r="9"/>`; }
  }
  blocks.forEach((b, i) => {
    const on = isSel(i), c = col(b), k = ink(c), dk = dark(c), kd = ink(dk), dep = b.kind == "register" ? PL.depthOf(b) : 1;
    const w = bw(b), h = bh(b), m = mi(b), cx = b.x + w / 2, cy = b.y + h / 2, clk = b.ports.some(p => p.role == "clk");
    const a = `class="bx${on ? " on" : ""}" data-b="${i}" fill="${c}"`;
    for (let q = Math.min(dep, 4) - 1; q >= 1; q--) s += `<rect class="st" data-b="${i}" x="${b.x}" y="${b.y - 7 * q}" width="${w}" height="${h}" rx="2" fill="${dark(c, .12 * q)}"/>`;
    s += b.kind == "mux"
      ? `<polygon ${a} points="${b.x},${b.y} ${b.x + w},${b.y + m} ${b.x + w},${b.y + h - m} ${b.x},${b.y + h}"/>`
      : isIO(b)
        ? `<polygon ${a} points="${b.x},${b.y} ${b.x + w - 14},${b.y} ${b.x + w},${cy} ${b.x + w - 14},${b.y + h} ${b.x},${b.y + h}"/>`
        : `<rect ${a} x="${b.x}" y="${b.y}" width="${w}" height="${h}" rx="${b.kind == "custom" ? Math.max(0, Math.min(typeof b.rx == "number" ? b.rx : 2, w / 2, h / 2)) : 2}"/>`;
    if (b.kind == "custom" && sel && sel.t == "b" && sel.i == i && !msel.length) s += `<rect class="rz" data-rz="${i}" x="${b.x + w - 9}" y="${b.y + h - 9}" width="9" height="9"><title>Redimensionner</title></rect>`;
    if (clk) s += b.compact
      ? `<polygon data-b="${i}" fill="${dk}" points="${b.x},${b.y + h} ${b.x + w},${b.y + h} ${cx},${b.y + h - Math.min(30, Math.round(w / 3))}"/>`
      : `<polygon data-b="${i}" fill="${dk}" points="${b.x},${b.y + h} ${b.x + w},${b.y + h} ${cx},${b.y + h - 44}"/>`;
    const io = isIO(b), one = io || lite || b.compact, sym = b.kind == "adder" ? "+" : b.compact ? K.symbol(b) : null, ny = io ? cy + 4 : b.compact ? (sym ? b.y + h - 10 : cy + 3) : b.kind == "adder" ? b.y + h - 22 : (one ? cy + 4 : cy - 1) - (clk ? 13 : 0);
    const ww = io ? b.ports[0].width : b.compact && b.kind != "const" ? dw(b) : 1;
    const lim = ww > 1 ? 5 : 7, nm = b.kind == "const" && b.compact ? "" : b.compact && b.inst.length > lim ? b.inst.slice(0, lim - 1) + "…" : b.inst;   // bloc compact de taille fixe : le nom est abrégé
    s += `<text class="t" style="fill:${k}" x="${io ? cx - 7 : cx}" y="${ny}" text-anchor="middle"><title>${esc(b.inst)}</title>${esc(nm)}${ww > 1 ? `<tspan class="w" dx="3">${ww}</tspan>` : ""}</text>`
      + (one ? "" : `<text class="m" style="fill:${k}" x="${cx}" y="${ny + 13}" text-anchor="middle">${esc(b.mod)}</text>`);
    if (dep > 1) s += `<text style="fill:${k};font-size:11px;font-weight:700" x="${b.x + w - 6}" y="${b.y + 15}" text-anchor="end">×${dep}</text>`;
    if (sym) s += `<text style="fill:${k};font-size:${sym.length <= 1 ? (b.compact ? 34 : 46) : sym.length == 2 ? 24 : sym.length <= 4 ? 17 : 13}px;font-weight:300" x="${cx}" y="${cy + (b.kind == "const" ? 5 : b.compact ? 9 : 10)}" text-anchor="middle"><title>${esc(b.inst)}</title>${esc(sym)}</text>`;
    b.ports.forEach((p, j) => {
      const [x, y] = pp(i, j), sd = side(p);
      if (p.role == "clk") { if (!lite && !b.compact) s += `<text style="fill:${kd}" x="${x}" y="${y - 9}" text-anchor="middle">clk</text>`; return; }
      if (!p.role) s += `<circle class="pv" cx="${x}" cy="${y}" r="4"/>`;
      const [tx, ty, an] = sd == "left" ? [x + 10, y + 4, "start"] : sd == "right" ? [x - 10, y + 4, "end"] : sd == "top" ? [x, y + 15, "middle"] : [x, y - 9, "middle"];
      if (!io && !lite && !b.compact) s += `<text style="fill:${p.role == "rst" ? kd : k}" x="${tx}" y="${ty}" text-anchor="${an}">${esc(lab(b, p))}${p.width > 1 ? `<tspan class="w" dx="3">${p.width}</tspan>` : ""}</text>`;
      if (!p.role) s += `<circle class="ph2" data-pt="${i}:${j}" cx="${x}" cy="${y}" r="12"><title>${esc((io ? b.inst : b.inst + "." + p.name) + (p.width > 1 ? ` [${p.width - 1}:0]` : ""))}</title></circle>`;
    });
  });
  if (drag && !drag.grp && blocks[drag.i]) {
    const gd = LY.guides(blocks, drag.i, geo);
    gd.h.forEach(g => { s += `<line class="guide" x1="${g.x0 - 12}" y1="${g.y}" x2="${g.x1 + 12}" y2="${g.y}"/>`; });
    gd.v.forEach(g => { s += `<line class="guide" x1="${g.x}" y1="${g.y0 - 12}" x2="${g.x}" y2="${g.y1 + 12}"/>`; });
  }
  if (cutIdx) s += `<line class="cutline" x1="${cutX}" y1="0" x2="${cutX}" y2="${H}"/><text class="cutlab" x="${cutX + 6}" y="${BAND_TOP + 44}">${cutIdx.size} fil${cutIdx.size > 1 ? "s" : ""}</text>`;
  if (box && box.moved) s += `<rect class="rb" x="${Math.min(box.x0, box.x1)}" y="${Math.min(box.y0, box.y1)}" width="${Math.abs(box.x1 - box.x0)}" height="${Math.abs(box.y1 - box.y0)}"/>`;
  cv.innerHTML = s;
  cv.setAttribute("viewBox", `0 0 ${W} ${H}`); cv.style.width = W * zoom + "px"; cv.style.height = H * zoom + "px";
  updLat();
}
function nearest(mx, my, a) {
  const fd = blocks[a.bi].ports[a.pj].dir; let best = null, bd = 24;
  blocks.forEach((b, i) => b.ports.forEach((p, j) => {
    if (p.role || p.dir == fd) return;
    const [x, y] = pp(i, j), dd = Math.hypot(x - mx, y - my);
    if (dd < bd) { bd = dd; best = { bi: i, pj: j }; }
  }));
  return best;
}
const cv = $("#cv"), cvw = $("#cvw"), pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }; };
const selIdx = () => (msel.length > 1 ? msel.slice() : sel && sel.t == "b" ? [sel.i] : []);
const isSel = i => msel.includes(i) || (sel && sel.t == "b" && sel.i == i);
function setSel(idx) { msel = []; sel = null; if (idx.length == 1) sel = { t: "b", i: idx[0] }; else if (idx.length > 1) msel = idx; }
cv.addEventListener("pointerdown", e => {
  if (locked) return;
  if (e.button == 1 || spaceDown) { pan = { x: e.clientX, y: e.clientY, l: cvw.scrollLeft, t: cvw.scrollTop }; e.preventDefault(); return; }
  if (e.button > 0) return;
  const p = pos(e), t = e.target, pe = t.closest("[data-pt]"), be = t.closest("[data-b]"), le = t.closest("[data-l]"), se = t.closest("[data-s]"), rz = t.closest("[data-rz]");
  if (cutMode) { applyCut(p.x); return; }
  if (rz) {
    const i = +rz.dataset.rz; setSel([i]);
    rdrag = { i, x0: p.x, y0: p.y, w0: bw(blocks[i]), h0: bh(blocks[i]) };
  } else if (pe) {
    const [bi, pj] = pe.dataset.pt.split(":").map(Number), [x, y] = pp(bi, pj);
    setSel([bi]); tmp = { bi, pj, x, y, mx: p.x, my: p.y, hov: null };
  } else if (be) {
    const i = +be.dataset.b;
    if (e.shiftKey) { const cur = selIdx(), at = cur.indexOf(i); if (at >= 0) cur.splice(at, 1); else cur.push(i); setSel(cur); }
    else {
      if (!msel.includes(i)) setSel([i]);
      drag = { i, ox: p.x - blocks[i].x, oy: p.y - blocks[i].y, grp: msel.includes(i) ? msel.map(j => ({ j, dx: blocks[j].x - blocks[i].x, dy: blocks[j].y - blocks[i].y })) : null };
    }
  } else if (le) {
    const k = +le.dataset.l, now = Date.now(); msel = [];
    if (sel && sel.t == "l" && sel.i == k && lastWire.i == k && now - lastWire.t < 400) { lastWire = { i: -1, t: 0 }; insertReg(k); return; }
    lastWire = { i: k, t: now }; sel = { t: "l", i: k };
    const wm = wireMovable(links[k]);
    wdrag = wm ? { k, kind: wm, x0: p.x, y0: p.y, moved: false } : null;
  } else if (se) {
    const si = +se.dataset.s; msel = []; sel = { t: "s", i: si };
    bdrag = { i: si, mode: se.dataset.sm, x0: p.x, bx: bands[si].x, bw: bands[si].w };
  } else {
    box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false, base: e.shiftKey ? selIdx() : [] };
    if (!e.shiftKey) { sel = null; msel = []; }
  }
  renderProps(); draw();
});
cv.addEventListener("dblclick", e => {
  const be = e.target.closest("[data-b]"); if (!be) return;
  const b = blocks[+be.dataset.b]; if (b && !isIO(b)) cmd("openModule", id(b.mod));
});
addEventListener("pointermove", e => {
  if (pan) { cvw.scrollLeft = pan.l - (e.clientX - pan.x); cvw.scrollTop = pan.t - (e.clientY - pan.y); return; }
  if (cutMode) { cutX = PL.adjustCut(blocks, Math.round(pos(e).x / 10) * 10, geo); draw(); return; }
  if (!drag && !tmp && !wdrag && !box && !bdrag && !rdrag) return;
  const p = pos(e);
  if (rdrag) {
    const b = blocks[rdrag.i];
    b.w = Math.max(40, Math.round((rdrag.w0 + p.x - rdrag.x0) / 20) * 20); b.h = Math.max(40, Math.round((rdrag.h0 + p.y - rdrag.y0) / 20) * 20);
    draw(); return;
  }
  if (bdrag) {
    const bd = bands[bdrag.i];
    if (bdrag.mode == "move") bd.x = Math.max(0, snap(bdrag.bx + p.x - bdrag.x0)); else bd.w = Math.max(40, snap(bdrag.bw + p.x - bdrag.x0));
    draw(); return;
  }
  if (box) { box.x1 = p.x; box.y1 = p.y; if (Math.hypot(p.x - box.x0, p.y - box.y0) > 4) box.moved = true; draw(); return; }
  if (wdrag) {
    if (!wdrag.moved && Math.abs(wdrag.kind == "x" ? p.x - wdrag.x0 : p.y - wdrag.y0) < 4) return;
    wdrag.moved = true;
    if (wdrag.kind == "x") links[wdrag.k].mx = Math.round(p.x / 10) * 10; else links[wdrag.k].my = Math.round(p.y / 10) * 10;
    draw(); return;
  }
  if (drag) {
    let nx = snap(p.x - drag.ox), ny = snap(p.y - drag.oy);
    if (drag.grp) {
      nx = Math.max(nx, -Math.min(...drag.grp.map(g => g.dx))); ny = Math.max(ny, MINY - Math.min(...drag.grp.map(g => g.dy)));
      drag.grp.forEach(g => { blocks[g.j].x = nx + g.dx; blocks[g.j].y = ny + g.dy; });
    } else { const b = blocks[drag.i]; b.x = Math.max(0, nx); b.y = Math.max(MINY, ny); magnet(drag.i); }
  } else { tmp.mx = p.x; tmp.my = p.y; tmp.hov = nearest(p.x, p.y, tmp); }
  draw();
});
addEventListener("pointerup", () => {
  if (pan) { pan = null; return; }
  if (tmp) { if (tmp.hov) connect(tmp, tmp.hov); tmp = null; sync(); }
  if (drag) { drag = null; autoSides(); draw(); commit(); }          // draw : efface les guides d'alignement
  if (wdrag) { if (wdrag.moved) { lastWire = { i: -1, t: 0 }; renderProps(); commit(); } wdrag = null; }
  if (bdrag) { bdrag = null; renderProps(); commit(); }
  if (rdrag) { rdrag = null; renderProps(); commit(); }
  if (box) {
    const bx = box; box = null;
    if (bx.moved) setSel([...new Set(bx.base.concat(GP.hit(blocks, bx, geo)))]);
    renderProps(); draw();
  }
});
addEventListener("keydown", e => {
  if (locked || e.target.matches("input,select")) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), idx = selIdx();
  if (e.key == " " && !e.target.matches("button")) { spaceDown = true; cvw.classList.add("pan"); e.preventDefault(); return; }
  if (e.key.startsWith("Arrow") && idx.length) {
    const st = e.altKey ? 1 : 20, dx = e.key == "ArrowLeft" ? -st : e.key == "ArrowRight" ? st : 0, dy = e.key == "ArrowUp" ? -st : e.key == "ArrowDown" ? st : 0;
    idx.forEach(i => { blocks[i].x = Math.max(0, blocks[i].x + dx); blocks[i].y = Math.max(MINY, blocks[i].y + dy); });
    autoSides(); sync(); e.preventDefault(); return;
  }
  if (e.key == "Escape") { if (closeMenus()) return; if (cutMode) setCut(false); else { sel = null; msel = []; renderProps(); draw(); } return; }
  if (mod && k == "a") { setSel(blocks.map((_, i) => i)); renderProps(); draw(); e.preventDefault(); }
  else if (mod && k == "c" && idx.length) { clip = GP.copyGroup(blocks, links, idx); e.preventDefault(); }
  else if (mod && k == "v" && clip) { paste(); e.preventDefault(); }
  else if (mod && k == "d" && idx.length) { dupBlock(); e.preventDefault(); }
  else if (["Delete", "Backspace"].includes(e.key)) {
    if (msel.length > 1) delGroup();
    else if (sel) { if (sel.t == "l") delLink(); else if (sel.t == "s") delBand(); else delBlock(); }
  }
});
addEventListener("keyup", e => { if (e.key == " ") { spaceDown = false; cvw.classList.remove("pan"); } });

/* ---------- Zoom ---------- */
function setZoom(z, cx, cy) {
  z = Math.min(3, Math.max(0.25, z));
  const r = cvw.getBoundingClientRect(), ox = (cx === undefined ? r.left + r.width / 2 : cx) - r.left, oy = (cy === undefined ? r.top + r.height / 2 : cy) - r.top;
  const wx = (cvw.scrollLeft + ox) / zoom, wy = (cvw.scrollTop + oy) / zoom;
  zoom = z; draw();
  cvw.scrollLeft = wx * zoom - ox; cvw.scrollTop = wy * zoom - oy;
  $("#zl").textContent = Math.round(zoom * 100) + " %";
}
function fit() {
  if (!blocks.length && !bands.length) return;
  const x0 = Math.min(...blocks.map(b => b.x), ...bands.map(b => b.x)), x1 = Math.max(...blocks.map(b => b.x + bw(b)), ...bands.map(b => b.x + b.w));
  const y0 = bands.length ? BAND_TOP - 10 : Math.min(...blocks.map(b => b.y)) - 40, y1 = Math.max(...blocks.map(b => b.y + bh(b))) + 30;
  const z = Math.min(1.5, ((cvw.clientWidth || 900) - 40) / (x1 - x0 + 40), ((cvw.clientHeight || 600) - 40) / (y1 - y0 + 40));
  setZoom(z);
  cvw.scrollLeft = (x0 - 20) * zoom; cvw.scrollTop = Math.max(0, y0 * zoom);
}
cvw.addEventListener("wheel", e => { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });

/* ---------- Ligne de coupe ---------- */
function setCut(on) {
  cutMode = on; cutX = null;
  $("#cutb").classList.toggle("p", on); cvw.classList.toggle("cutting", on);
  setHint(on ? CUT_HINT : HINT, false); draw();
}
function applyCut(x) {
  const r = PL.insertCut(blocks, links, Math.round(x / 10) * 10, geo);
  if (!r.count) { setHint("Aucun fil ne traverse cette ligne.", true); return; }
  links = r.links; setCut(false); setSel(r.regs.map(g => blocks.indexOf(g))); renderProps(); sync();
}

/* ---------- Bandes d'étages ---------- */
function addBand() {
  const last = bands[bands.length - 1], i = bands.length;
  bands.push({ name: BAND_NAMES[i] || "S" + (i + 1), x: last ? last.x + last.w : 20, w: 240 });
  msel = []; sel = { t: "s", i }; renderProps(); sync();
}
function delBand() { bands.splice(sel.i, 1); sel = null; renderProps(); sync(); }
function setBand(k, v) {
  const bd = bands[sel.i];
  if (k == "name") bd.name = v; else if (k == "color") bd.color = v;
  else if (k == "x") bd.x = Math.max(0, +v || 0); else if (k == "w") bd.w = Math.max(40, +v || 40);
  sync();
}
function magnet(bi) {
  const b = blocks[bi]; let dy = null;
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
  const ref = x => `${blocks[x.bi].inst}.${blocks[x.bi].ports[x.pj].name}`, to = ref(b);
  links = links.filter(l => l.to != to); links.push({ from: ref(a), to }); magnet(b.bi); autoSides();
}
/**
 * Côté du port `sel` d'un mux : au-dessus du bloc si sa source est plus haut, en dessous sinon (le fil n'a plus à
 * contourner le mux). Sauf si l'utilisateur a choisi le côté à la main (`selAuto: false`). Retourne true si un côté a changé.
 */
function autoSides() {
  let ch = false;
  blocks.forEach(b => {
    if (b.kind != "mux" || b.selAuto === false) return;
    const sp = b.ports.find(p => p.side); if (!sp) return;
    const ref = `${b.inst}.${sp.name}`, l = links.find(x => x.to == ref), f = l && find(l.from);
    if (!f) return;
    const want = pp(f.bi, f.pj)[1] < b.y + bh(b) / 2 ? "top" : "bottom";
    if (sp.side != want) { sp.side = want; ch = true; }
  });
  return ch;
}
/** Redresse les fils : blocs sélectionnés (2 ou plus) ou tout le schéma. */
function straighten() {
  const idx = msel.length > 1 ? msel : null;
  const n = LY.straighten(blocks, links, idx, geo, MINY);
  if (n) autoSides();
  setHint(n ? `${n} bloc${n > 1 ? "s" : ""} redressé${n > 1 ? "s" : ""}` : "Déjà aligné : rien à redresser", false);
  setTimeout(() => setHint(cutMode ? CUT_HINT : HINT, false), 3500);
  if (n) sync();
}
function snapGrid() {
  const n = LY.snapAll(blocks); autoSides();
  setHint(n ? `${n} bloc${n > 1 ? "s" : ""} calé${n > 1 ? "s" : ""} sur la grille de 20 px` : "Déjà sur la grille", false);
  setTimeout(() => setHint(cutMode ? CUT_HINT : HINT, false), 3500);
  if (n) sync();
}

/* ---------- Panneau de propriétés (délégation d'événements, compatible CSP) ---------- */
function renderProps() {
  const el = $("#props");
  if (locked) { el.hidden = true; return; }
  if (msel.length > 1) {
    el.hidden = false;
    el.innerHTML = `<div class="ph">${msel.length} blocs sélectionnés</div>
      <div class="ph">Aligner</div>
      <div class="pr wrap"><button data-a="al:left">Gauche</button><button data-a="al:hcenter">Centre H</button><button data-a="al:right">Droite</button>
        <button data-a="al:top">Haut</button><button data-a="al:vcenter">Centre V</button><button data-a="al:bottom">Bas</button></div>
      <div class="ph">Répartir (3 blocs min.)</div>
      <div class="pr wrap"><button data-a="dist:h"${msel.length < 3 ? " disabled" : ""}>↔ Horizontalement</button><button data-a="dist:v"${msel.length < 3 ? " disabled" : ""}>↕ Verticalement</button></div>
      <div class="pr" style="margin-top:8px"><button data-a="straighten" title="Aligne ces blocs à la hauteur de leurs sources">⇉ Redresser les fils</button></div>
      <div class="pr"><button data-a="dup">Dupliquer</button><button class="x" data-a="del">Supprimer</button></div>`;
    return;
  }
  if (!sel || (sel.t == "l" ? !links[sel.i] : sel.t == "s" ? !bands[sel.i] : !blocks[sel.i])) { el.hidden = true; return; }
  el.hidden = false;
  if (sel.t == "s") {
    const bd = bands[sel.i];
    el.innerHTML = `<div class="ph">Étage</div>
      <label>Nom <input data-a="s:name" value="${esc(bd.name)}"></label>
      <label>Début <input type="number" min="0" step="20" data-a="s:x" value="${bd.x}"></label>
      <label>Largeur <input type="number" min="40" step="20" data-a="s:w" value="${bd.w}"></label>
      <label>Couleur <input type="color" data-a="s:color" value="${bd.color || BAND[sel.i % BAND.length]}"></label>
      <div class="pr" style="margin-top:8px"><button class="x" data-a="del">Supprimer l'étage</button></div>`;
    return;
  }
  if (sel.t == "l") {
    const l = links[sel.i], f = find(l.from), t = find(l.to), ok = f && t && f.p.dir == "out" && t.p.dir == "in";
    el.innerHTML = `<div class="ph">Lien</div>
      <div style="margin-bottom:8px">${esc(l.from)} → ${esc(l.to)}${f ? ` <span class="ph">[${f.p.width}]</span>` : ""}</div>
      <div class="pr"><button class="p" data-a="insReg"${ok ? "" : " disabled"} title="Coupe le lien et insère un registre (ou double-clic sur le fil)">+ Registre ici</button></div>
      ${l.mx != null || l.my != null ? `<div class="pr"><button data-a="resetMx" title="Annule le déplacement du fil">Tracé automatique</button></div>` : ""}
      <div class="pr"><button class="x" data-a="del">Supprimer le lien</button></div>`;
    return;
  }
  const b = blocks[sel.i], o = (a, c) => a.map(([v, t]) => `<option value="${v}"${v == c ? " selected" : ""}>${t}</option>`).join("");
  if (isIO(b)) {
    el.innerHTML = `<div class="ph">${b.kind == "in" ? "Entrée" : "Sortie"} du top</div>
      <label>Nom <input data-a="b:inst" value="${esc(b.inst)}"></label>
      <label>Largeur <input type="number" min="1" data-a="p:0:width" value="${b.ports[0].width}"></label>
      <label>Couleur <input type="color" data-a="b:color" value="${col(b)}"></label>
      <div class="pr" style="margin-top:8px"><button data-a="dup">Dupliquer</button><button class="x" data-a="del">Supprimer</button></div>`;
    return;
  }
  const ports = K.KINDS.includes(b.kind) ? kindPanel(b) : b.kind == "mux"
    ? `<label>Entrées <input type="number" min="2" max="8" data-a="mux:n" value="${b.ports.filter(p => p.dir == "in" && !p.side).length}"></label>
       <label>Largeur <input type="number" min="1" data-a="mux:w" value="${b.ports[0].width}"></label>
       <label title="Côté du port de sélection : auto = du côté de sa source">Sélection <select data-a="selSide">${o([["auto", "auto"], ["top", "haut"], ["bottom", "bas"]], b.selAuto === false ? (b.ports.find(p => p.side) || {}).side : "auto")}</select></label>`
    : `<div class="ph">Ports</div>` + b.ports.map((p, j) => `<div class="pr">
      <input type="text" data-a="p:${j}:name" value="${esc(p.name)}">
      <select data-a="p:${j}:dir">${o([["in", "in"], ["out", "out"]], p.dir)}</select>
      <input type="number" min="1" data-a="p:${j}:width" value="${p.width}">
      <select data-a="p:${j}:role">${o([["", "data"], ["clk", "clk"], ["rst", "rst"]], p.role)}</select>
      <button class="x" data-a="delPort:${j}">✕</button></div>`).join("") + `<div class="pr"><button data-a="addPort">+ port</button></div>`;
  el.innerHTML = `<div class="ph">Bloc</div>
    <label>Instance <input data-a="b:inst" value="${esc(b.inst)}"></label>
    <label>Module <input data-a="b:mod" value="${esc(b.mod)}"></label>
    <label>Type <select data-a="kind">${o([["register", "registre"], ["adder", "adder"], ["mux", "mux"], ["custom", "custom"], ...K.KINDS.map(k => [k, K.META[k].label.toLowerCase()])], b.kind)}</select></label>
    <label>Couleur <input type="color" data-a="b:color" value="${col(b)}"></label>
    ${b.kind == "register" || b.kind == "adder" || K.KINDS.includes(b.kind) ? `<label>Compact <input type="checkbox" data-a="compact"${b.compact ? " checked" : ""}></label>` : ""}
    ${b.kind == "register" ? `<label title="Nombre d'étages : un seul module qui retarde le signal de N cycles">Profondeur <input type="number" min="1" max="64" data-a="depth" value="${PL.depthOf(b)}"></label>` : ""}
    ${b.kind == "custom" ? `<label>Largeur <input type="number" min="40" step="20" data-a="cw" value="${bw(b)}"></label>
    <label>Hauteur <input type="number" min="40" step="20" data-a="ch" value="${bh(b)}"></label>
    <label>Arrondi <input type="range" min="0" max="${Math.floor(Math.min(bw(b), bh(b)) / 2)}" data-a="crx" value="${typeof b.rx == "number" ? b.rx : 2}"></label>
    ${b.w || b.h ? `<div class="pr"><button data-a="cauto">Taille automatique</button></div>` : ""}` : ""}
    ${ports}
    <div class="pr" style="margin-top:8px"><button data-a="openMod">Ouvrir ${esc(id(b.mod))}.v</button></div>
    <div class="pr"><button data-a="dup">Dupliquer</button><button class="x" data-a="del">Supprimer le bloc</button></div>`;
}
function act(el) {
  const [a, x, y] = el.dataset.a.split(":"), v = el.value;
  if (a == "b") setB(x, v);
  else if (a == "p") setP(+x, y, v);
  else if (a == "mux") x == "n" ? setMux(+v, 0) : setMux(0, +v);
  else if (a == "kind") setKind(v);
  else if (a == "delPort") delPort(+x);
  else if (a == "addPort") addPort();
  else if (a == "dup") dupBlock();
  else if (a == "del") msel.length > 1 ? delGroup() : sel.t == "l" ? delLink() : sel.t == "s" ? delBand() : delBlock();
  else if (a == "straighten") straighten();
  else if (a == "selSide") { const b = blocks[sel.i], sp = b.ports.find(p => p.side); if (v == "auto") { delete b.selAuto; autoSides(); } else { b.selAuto = false; if (sp) sp.side = v; } sync(); }
  else if (a == "al") { GP.align(blocks, msel, x, geo); sync(); }
  else if (a == "dist") { GP.distribute(blocks, msel, x, geo); sync(); }
  else if (a == "s") setBand(x, v);
  else if (a == "depth") setDepth(+v);
  else if (a == "kf") setKindField(x, v, y);
  else if (a == "cw") { blocks[sel.i].w = Math.max(40, Math.round(+v) || 40); sync(); }
  else if (a == "ch") { blocks[sel.i].h = Math.max(40, Math.round(+v) || 40); sync(); }
  else if (a == "crx") { blocks[sel.i].rx = Math.max(0, Math.round(+v) || 0); sync(); }
  else if (a == "cauto") { delete blocks[sel.i].w; delete blocks[sel.i].h; renderProps(); sync(); }
  else if (a == "compact") { const b = blocks[sel.i]; if (el.checked) b.compact = true; else delete b.compact; sync(); }
  else if (a == "insReg") insertReg(sel.i);
  else if (a == "resetMx") { delete links[sel.i].mx; delete links[sel.i].my; renderProps(); sync(); }
  else if (a == "openMod") cmd("openModule", id(blocks[sel.i].mod));
}
const props = $("#props");
props.addEventListener("input", e => { const t = e.target; if (t.dataset.a && t.tagName != "SELECT" && t.tagName != "BUTTON") act(t); });
props.addEventListener("change", e => { const t = e.target; if (t.dataset.a && t.tagName == "SELECT") act(t); });
props.addEventListener("click", e => { const t = e.target.closest("button[data-a]"); if (t) act(t); });

function setB(k, v) {
  const b = blocks[sel.i];
  if (k == "inst") links.forEach(l => ["from", "to"].forEach(s => { if (l[s].startsWith(b.inst + ".")) l[s] = v + l[s].slice(b.inst.length); }));
  b[k] = v; sync();
}
/** Champs propres à chaque bloc prêt à l'emploi (la table des ports générique n'a pas de sens pour eux). */
function kindPanel(b) {
  const f = (label, inner, tip = "") => `<label${tip ? ` title="${tip}"` : ""}>${label} ${inner}</label>`;
  const num = (field, v, min, max) => `<input type="number" min="${min}"${max != null ? ` max="${max}"` : ""} data-a="kf:${field}" value="${v}">`;
  const sel = () => `<select data-a="kf:op">${optsHtml(K.OPS[b.kind], b.op)}</select>`, o_ = K.opts(b);
  const W = f("Largeur", num("w", o_.w, 1, 4096));
  switch (b.kind) {
    case "const": return f("Valeur", `<input data-a="kf:value" value="${esc(b.value ?? "0")}">`, "Décimal, 0xFF ou 0b1010") + W;
    case "logic": return f("Opération", sel()) + (b.op == "not" ? "" : f("Entrées", num("n", o_.n, 2, 8))) + W;
    case "cmp": return f("Comparaison", sel()) + W;
    case "counter": return f("Sens", sel()) + W;
    case "shift": return f("Décalage", sel()) + f("De", num("amount", b.amount ?? 1, 0, 4095), "Nombre de bits décalés") + W;
    case "slice": return f("Bit haut", num("hi", b.hi ?? 3, 0, 4095)) + f("Bit bas", num("lo", b.lo ?? 0, 0, 4095)) + f("Largeur entrée", num("w", o_.w, 1, 4096), "Largeur du bus d'entrée");
    case "concat": return f("Entrées", num("n", o_.n, 2, 8)) + o_.widths.map((w, j) => f(`Largeur ${String.fromCharCode(97 + j)}`, `<input type="number" min="1" data-a="kf:cw:${j}" value="${w}">`)).join("");
    case "ram": return f("Largeur données", num("w", o_.w, 1, 4096)) + f("Largeur adresse", num("aw", o_.aw, 1, 24), "Nombre de bits d'adresse : 2^N mots");
  }
  return "";
}
/** Modification d'un réglage d'un bloc prêt à l'emploi : les ports, le nom de module et les ports dérivés suivent. */
function setKindField(field, v, j) {
  const b = blocks[sel.i], patch = {};
  if (field == "value") b.value = v;
  else if (field == "amount") b.amount = Math.max(0, Math.floor(+v) || 0);
  else if (field == "hi") { b.hi = Math.max(0, Math.floor(+v) || 0); if ((b.lo ?? 0) > b.hi) b.lo = b.hi; patch.hi = b.hi; patch.lo = b.lo; }
  else if (field == "lo") { b.lo = Math.max(0, Math.min(b.hi ?? 3, Math.floor(+v) || 0)); patch.lo = b.lo; }
  else if (field == "op") { b.op = v; patch.op = v; }
  else if (field == "cw") { const ws = K.opts(b).widths.slice(); ws[j] = Math.max(1, Math.floor(+v) || 1); patch.widths = ws; }
  else patch[field] = +v;                                          // n, w, aw
  if (field != "value" && field != "amount") {
    b.ports = K.rebuild(b, patch);
    links = links.filter(l => find(l.from) && find(l.to));
  }
  K.syncDerived(b); fixMod(b);
  if (field == "op" || field == "n" || field == "hi") {            // l'affichage change (champs masqués, largeurs) : on reconstruit en gardant le focus
    renderProps(); const inp = $(`#props [data-a="kf:${field}"]`); if (inp && inp.focus) inp.focus();
  }
  sync();
}
function setKind(v) {
  const b = blocks[sel.i];
  ["op", "value", "amount", "hi", "lo", "depth", "compact", "w", "h", "rx", "selAuto"].forEach(k => delete b[k]);
  b.kind = v; b.color = "";
  if (K.KINDS.includes(v)) { const d = K.defaults(v); b.ports = d.ports; b.mod = d.mod; Object.entries(d).forEach(([k, x]) => { if (k != "ports" && k != "mod" && x !== false) b[k] = x; }); }
  else { b.ports = defPorts(v); b.mod = defMod(v, sel.i + 1); if (v == "register" || v == "adder") b.compact = true; }
  links = links.filter(l => find(l.from) && find(l.to)); fixMod(b); autoSides(); renderProps(); sync();
}
function setMux(n, w) {
  const b = blocks[sel.i]; n = Math.min(8, Math.max(2, n || b.ports.filter(p => p.dir == "in" && !p.side).length)); w = Math.max(1, w || b.ports[0].width);
  const keep = (b.ports.find(p => p.side) || {}).side;
  b.ports = muxPorts(n, w); if (keep) b.ports.find(p => p.side).side = keep;
  links = links.filter(l => find(l.from) && find(l.to)); fixMod(b); autoSides(); sync();
}
const CUT_HINT = "Ligne de coupe : clique à l'endroit du nouvel étage · Échap annule";
/** Après un changement de ports : le module doit rester cohérent (reg8 → reg16, ou _2 s'il est partagé avec d'autres ports). */
function fixMod(b) {
  const to = PL.adaptModule(blocks, b);
  if (to == b.mod) return;
  const from = b.mod, forked = to != PL.wantedMod(b);
  const msg = `Module « ${from} » → « ${to} »${forked ? " : ses ports ou son opération ne correspondent plus au module partagé" : ""}`;
  b.mod = to;
  const mi = $('#props [data-a="b:mod"]'); if (mi) mi.value = to;
  setHint(msg, false); setTimeout(() => { if ($("#hint").textContent == msg) setHint(cutMode ? CUT_HINT : HINT, false); }, 5000);
}
function setP(j, k, v) {
  const b = blocks[sel.i], p = b.ports[j], ref = `${b.inst}.${p.name}`;
  if (k == "name") links.forEach(l => ["from", "to"].forEach(s => { if (l[s] == ref) l[s] = `${b.inst}.${v}`; }));
  p[k] = k == "width" ? Math.max(1, +v || 1) : v;
  if (k == "width" && b.kind == "register") {          // d et q d'un registre ont toujours la même largeur
    b.ports.forEach((q, i) => { if (!q.role) { q.width = p.width; const inp = $(`#props [data-a="p:${i}:width"]`); if (inp && i != j) inp.value = q.width; } });
  }
  if (k == "dir") links = links.filter(l => l[v == "out" ? "to" : "from"] != ref);   // un lien ne peut plus pointer vers un port dont le sens a changé
  fixMod(b); sync();
}
function addPort() { const b = blocks[sel.i]; b.ports.push(P(PL.freePort(b), "in", 1)); fixMod(b); renderProps(); sync(); }
function delPort(j) {
  const b = blocks[sel.i], r = `${b.inst}.${b.ports[j].name}`;
  links = links.filter(l => l.from != r && l.to != r); b.ports.splice(j, 1); fixMod(b); renderProps(); sync();
}
function addBlock(kind) {
  let n = 1; while (blocks.some(b => b.inst == PRE[kind] + n)) n++;
  const k = 60 + 40 * (blocks.length % 8);
  blocks.push(mk(kind, k, k + 20, n)); sel = { t: "b", i: blocks.length - 1 }; renderProps(); sync();
}
/**
 * Comment un fil peut être déplacé : "x" (son segment vertical glisse horizontalement),
 * "y" (son canal horizontal glisse verticalement : fils qui arrivent par le haut/bas ou qui contournent), ou null.
 */
function wireMovable(l) {
  const f = l && find(l.from), t = l && find(l.to);
  if (!f || !t || side(f.p) != "right") return null;
  const [x1, y1] = pp(f.bi, f.pj), [x2, y2] = pp(t.bi, t.pj), st = side(t.p);
  if (st == "bottom") return x2 > x1 + 24 && y1 > y2 + 7 + 12 ? null : "y";
  if (st == "top") return x2 > x1 + 24 && y1 < y2 - 7 - 12 ? null : "y";
  return x2 - x1 >= 50 ? "x" : "y";
}
function delLink() { links.splice(sel.i, 1); sel = null; renderProps(); sync(); }
/** Coupe le lien k et y insère un registre compact (largeur du fil). Fait de la place si l'espace manque. */
function insertReg(k) {
  const l = links[k], f = l && find(l.from), t = l && find(l.to);
  if (!f || !t || f.p.dir != "out" || t.p.dir != "in") return;
  const reg = PL.makeRegister(blocks, f.p.width), rw = bw(reg), [x1, y1] = pp(f.bi, f.pj);
  let x2 = pp(t.bi, t.pj)[0];
  if (x2 > x1) {
    const need = rw + 60;
    if (side(f.p) == "right" && side(t.p) == "left" && x2 - x1 < need) {
      const dx = Math.ceil((need - (x2 - x1)) / 20) * 20;
      PL.makeRoom(blocks, blocks[t.bi].x, dx); x2 += dx;
    }
    reg.x = snap((x1 + x2) / 2 - rw / 2);
  } else reg.x = snap(x1 + 30);
  reg.y = Math.round(y1 - geo.center(reg));
  links = PL.spliceLink(links, k, reg);
  blocks.push(reg); sel = { t: "b", i: blocks.length - 1 }; renderProps(); sync();
}
function delBlock() {
  const n = blocks[sel.i].inst;
  links = links.filter(l => !l.from.startsWith(n + ".") && !l.to.startsWith(n + "."));
  blocks.splice(sel.i, 1); sel = null; renderProps(); sync();
}
function paste() {
  const before = blocks.length, r = GP.pasteGroup(blocks, links, clip, 40, 40, k => PRE[k] || "u");
  r.blocks.forEach(b => blocks.push(b)); r.links.forEach(l => links.push(l));
  clip.blocks.forEach(b => { b.x += 40; b.y += 40; }); clip.links.forEach(l => { if (typeof l.mx == "number") l.mx += 40; });
  setSel(r.blocks.map((_, i) => before + i)); renderProps(); sync();
}
const dupBlock = () => { clip = GP.copyGroup(blocks, links, selIdx()); paste(); };
function delGroup() {
  const names = new Set(msel.map(i => blocks[i].inst)), of = r => String(r).split(".")[0];
  links = links.filter(l => !names.has(of(l.from)) && !names.has(of(l.to)));
  blocks = blocks.filter((_, i) => !msel.includes(i)); msel = []; sel = null; renderProps(); sync();
}
/** Registre à N étages : un seul module qui retarde de N cycles (nom reg<largeur>x<N>). */
function setDepth(n) {
  const b = blocks[sel.i]; n = Math.max(1, Math.min(64, Math.floor(n) || 1));
  if (n > 1) b.depth = n; else delete b.depth;
  fixMod(b); sync();
}

/* ---------- Barre d'outils ---------- */
function toggleNom() { lite = !lite; $("#nom").textContent = "Nomenclature : " + (lite ? "allégée" : "normale"); sync(); }
const tools = $("#tools"), MENUS = ["add", "set", "files"];
let openMenu = null;
function closeMenus() { const had = openMenu; openMenu = null; MENUS.forEach(k => { $("#m-" + k).hidden = true; }); return had; }
function toggleMenu(k, btn) {
  const was = openMenu == k; closeMenus(); if (was) return;
  openMenu = k; const m = $("#m-" + k); m.hidden = false;
  m.style.left = Math.max(0, btn.getBoundingClientRect().left - tools.getBoundingClientRect().left) + "px";
}
addEventListener("pointerdown", e => { if (openMenu && !e.target.closest("#tools")) closeMenus(); }, true);
tools.addEventListener("click", e => {
  const mb = e.target.closest("[data-menu]"); if (mb) { toggleMenu(mb.dataset.menu, mb); return; }
  const el = e.target.closest("button[data-a]"); if (!el || locked) return;
  const [a, x] = el.dataset.a.split(":");
  if (a != "nom" && a != "top" && a != "rst") closeMenus();
  if (a == "add") addBlock(x);
  else if (a == "nom") toggleNom();
  else if (a == "band") addBand();
  else if (a == "straighten") straighten();
  else if (a == "snapgrid") snapGrid();
  else if (a == "status") toggleStatus();
  else if (a == "cut") setCut(!cutMode);
  else if (a == "zoom") { if (x == "in") setZoom(zoom * 1.25); else if (x == "out") setZoom(zoom / 1.25); else if (x == "fit") fit(); else setZoom(1); }
  else if (a == "cmd") cmd(x);
  else if (a == "svg") exportSvg();
});
tools.addEventListener("input", e => { if (e.target.dataset.a == "top") { topName = e.target.value; sync(); } });
tools.addEventListener("change", e => { if (e.target.dataset.a == "rst") { rstLow = e.target.value == "low"; sync(); } });

/* ---------- Synchronisation avec le document VS Code ---------- */
const projJson = () => JSON.stringify({ version: 1, topName, rstLow, blocks, links, ...(bands.length ? { bands } : {}) }, null, 1);
function flush() {
  clearTimeout(pending); pending = null;
  if (locked) return;
  const t = projJson();
  if (t === lastText) return;
  lastText = t; vscode.postMessage({ type: "edit", text: t });
}
function commit() { if (locked) return; clearTimeout(pending); pending = setTimeout(flush, 200); }
function sync() { draw(); commit(); }
function cmd(c, mod) { flush(); vscode.postMessage({ type: "cmd", cmd: c, mod }); }

function load(text) {
  if (text === lastText || pending !== null || drag || tmp || wdrag || box || bdrag || rdrag || pan) return;
  let j = null;
  if (text && text.trim()) {
    try { j = JSON.parse(text); }
    catch { locked = true; blocks = []; links = []; sel = null; renderProps(); draw(); setHint("JSON invalide : édition verrouillée.", true); vscode.postMessage({ type: "invalid" }); return; }
  }
  locked = false; setHint(cutMode ? CUT_HINT : HINT, false); msel = []; bands = [];
  if (j && Array.isArray(j.blocks) && Array.isArray(j.links)) {
    topName = j.topName ?? "top"; blocks = j.blocks; links = j.links; rstLow = j.rstLow !== false;
    bands = Array.isArray(j.bands) ? j.bands.filter(x => x && typeof x.x == "number" && typeof x.w == "number").map(x => ({ ...x, name: String(x.name ?? "") })) : [];
    blocks.forEach(b => { if (!PRE[b.kind]) b.kind = "custom"; b.ports = b.ports || []; });
  } else defaults();
  lastText = text;
  if (sel && !(sel.t == "b" ? blocks[sel.i] : sel.t == "l" ? links[sel.i] : bands[sel.i])) sel = null;
  $("#top").value = topName; $("#rp").value = rstLow ? "low" : "high";
  renderProps(); draw();
  if (j && blocks.length && LY.offGrid(blocks)) setHint("Ce schéma n'est pas sur la grille de 20 px : Réglages ▸ « Aligner sur la grille », puis « ⇉ Redresser » pour des fils droits.", false);
}
function setHint(t, err) { const h = $("#hint"); h.textContent = t; h.classList.toggle("err", !!err); }

/* ---------- Export SVG ---------- */
function svgString() {
  if (!blocks.length) return null;
  const keep = sel, keepM = msel, keepCut = cutMode; sel = null; msel = []; cutMode = false; draw();
  const c = cv.cloneNode(true); sel = keep; msel = keepM; cutMode = keepCut; draw();
  c.removeAttribute("style");
  c.querySelectorAll(".ph2,.hit,.bg,.cutline,.cutlab,.rb,.rz,.guide").forEach(e => e.remove());
  let x0 = Math.min(...blocks.map(b => b.x)) - 40, y0 = Math.min(...blocks.map(b => b.y)) - 70;
  let x1 = Math.max(...blocks.map(b => b.x + bw(b))) + 40, y1 = Math.max(...blocks.map(b => b.y + bh(b))) + 50;
  if (bands.length) { x0 = Math.min(x0, ...bands.map(b => b.x - 10)); x1 = Math.max(x1, ...bands.map(b => b.x + b.w + 10)); y0 = Math.min(y0, BAND_TOP - 10); }
  const css = 'text{font:11px "Cascadia Code",Consolas,"DejaVu Sans Mono",monospace;fill:#e8e8e8}.t{font-size:12px;font-weight:700}.m{font-size:10px;fill-opacity:.75}tspan.w{font-size:9px;fill-opacity:.65}.wire{stroke:#fff;stroke-width:1.8;fill:none}.pv{fill:#fff;stroke:#000;stroke-width:1.5}.rz{display:none}.band{fill-opacity:.07;stroke-opacity:.4;stroke-dasharray:4 4}.bh{fill-opacity:.28}.bt{font-size:12px;font-weight:700;fill:#fff}.st{stroke:#000;stroke-width:1}';
  c.setAttribute("width", x1 - x0); c.setAttribute("height", y1 - y0);
  c.setAttribute("viewBox", `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  c.insertAdjacentHTML("afterbegin", `<style>${css}</style><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#000"/>`);
  return new XMLSerializer().serializeToString(c);
}
function exportSvg() { const svg = svgString(); if (svg) vscode.postMessage({ type: "svg", svg, name: (id(topName) || "top") + "_schema.svg" }); }

/* ---------- État du Verilog ---------- */
let statusOpen = false, statusTimer = null;
const STATE = {
  ok: ["●", "à jour", "ok", ["openFile"]],
  stale: ["●", "en retard sur le schéma", "warn", ["update", "diff", "openFile"]],
  absent: ["○", "pas encore généré", "mut", ["update"]],
  edited: ["✎", "modifié à la main — en-tête à jour", "ok", ["openFile", "diff"]],
  "edited-stale": ["✎", "modifié à la main — en-tête à adapter au schéma", "warn", ["update", "diff", "openFile"]],
  orphan: ["⚠", "orphelin : n'est plus dans le schéma", "warn", ["openFile", "archive"]]
};
const VBTN = { openFile: "Ouvrir", diff: "Comparer", update: "Mettre à jour", archive: "Archiver (.bak)" };
function reqStatus(delay = 150) {
  if (!statusOpen) return;
  clearTimeout(statusTimer); statusTimer = setTimeout(() => vscode.postMessage({ type: "status" }), delay);
}
function toggleStatus() {
  statusOpen = !statusOpen; $("#vstat").hidden = !statusOpen;
  if (statusOpen) { $("#vstat").innerHTML = `<div class="ph">État du Verilog…</div>`; flush(); reqStatus(0); }
}
function renderStatus(m) {
  if (!statusOpen) return;
  const rows = m.rows || [], warn = rows.filter(r => STATE[r.state][2] == "warn").length;
  $("#vstat").innerHTML = `<div class="hd"><span class="ph">État du Verilog — ${warn ? `${warn} à regarder` : "tout est à jour"}</span><span><button data-v="refresh" title="Actualiser">↻</button> <button data-v="close" title="Fermer">✕</button></span></div>`
    + (m.error ? `<div class="vnote">${esc(m.error)}</div>` : "")
    + rows.map(r => { const [ic, txt, cls, acts] = STATE[r.state];
      return `<div class="vrow ${cls}"><span class="dot">${ic}</span><b>${esc(r.name)}</b>${r.isTop ? " <i>top</i>" : ""}<div class="vnote">${txt}</div>`
        + `<div class="pr">${acts.map(a => `<button data-v="${a}" data-f="${esc(r.name)}"${a == "archive" ? ' class="x"' : ""}>${VBTN[a]}</button>`).join("")}</div></div>`; }).join("")
    + (rows.length ? "" : `<div class="vnote">Aucun module dans le schéma.</div>`);
}
$("#vstat").addEventListener("click", e => {
  const b = e.target.closest("[data-v]"); if (!b) return;
  const a = b.dataset.v;
  if (a == "close") { toggleStatus(); return; }
  if (a == "refresh") { reqStatus(0); return; }
  flush(); vscode.postMessage({ type: "cmd", cmd: a, file: b.dataset.f });
  if (a == "update" || a == "archive") reqStatus(1200);
});

addEventListener("message", e => {
  const m = e.data; if (!m) return;
  if (m.type === "load") { load(m.text); reqStatus(400); } else if (m.type === "status") renderStatus(m);
});
document.addEventListener("visibilitychange", flush);
vscode.postMessage({ type: "ready" });
})();
