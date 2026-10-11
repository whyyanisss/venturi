(function () {
"use strict";
const vscode = acquireVsCodeApi();
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const id = s => String(s).replace(/\W/g, "_");
const snap = v => Math.round(v / 20) * 20;
const HINT = $("#hint").textContent;
let topName = "chain", lite = false, rstLow = true, sel = null, drag = null, tmp = null, clip = null;
let lastText = null, pending = null, locked = false;

/* ---------- Types de blocs ---------- */
const P = (name, dir, width, role = "", side = "") => ({ name, dir, width, role, side });
const muxPorts = (n, w) => [...Array(n)].map((_, i) => P("i" + i, "in", w)).concat(P("sel", "in", Math.max(1, Math.ceil(Math.log2(n))), "", "bottom"), P("y", "out", w));
const PRE = { register: "r", adder: "a", mux: "m", custom: "u", in: "in", out: "out" };
const COL = { register: "#065b07", adder: "#f97316", mux: "#112f5f", custom: "#a855f7", in: "#0d9488", out: "#db2777" };
const rgb = c => [1, 3, 5].map(i => parseInt(c.substr(i, 2), 16));
const ink = c => { const [r, g, b] = rgb(c); return .299 * r + .587 * g + .114 * b > 200 ? "#000" : "#fff"; };
const dark = (c, f = .35) => "#" + rgb(c).map(v => Math.round(v * (1 - f)).toString(16).padStart(2, "0")).join("");
const defPorts = k => ({
  register: [P("clk", "in", 1, "clk"), P("rst", "in", 1, "rst"), P("d", "in", 8), P("q", "out", 8)],
  adder: [P("a", "in", 8), P("b", "in", 8), P("s", "out", 8)],
  mux: muxPorts(2, 8), custom: [P("a", "in", 1), P("y", "out", 1)], in: [P("p", "out", 8)], out: [P("p", "in", 8)] }[k]);
const defMod = (k, n) => ({ register: "reg8", adder: "add8", mux: "mux2", custom: "bloc" + n, in: "", out: "" }[k]);
const mk = (kind, x, y, n) => ({ inst: PRE[kind] + n, mod: defMod(kind, n), kind, x, y, color: "", ports: defPorts(kind) });
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
  const i = mk("in", 20, 168, 1), o = mk("out", 620, 168, 1); i.inst = "din"; o.inst = "dout";
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
  const mark = (i, c) => `<marker id="${i}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`;
  let s = `<defs>${mark("ar", "#fff")}${mark("as", "#ffd24a")}</defs>`;
  links.forEach((l, k) => {
    const f = find(l.from), t = find(l.to); if (!f || !t) return;
    const on = sel && sel.t == "l" && sel.i == k, dd = route(f, t);
    s += `<path class="hit" data-l="${k}" d="${dd}"/><path class="wire${on ? " on" : ""}" d="${dd}" marker-end="url(#${on ? "as" : "ar"})"/>`;
  });
  if (tmp) {
    s += `<path class="tmp" d="M${tmp.x} ${tmp.y}L${tmp.mx} ${tmp.my}"/>`;
    if (tmp.hov) { const [x, y] = pp(tmp.hov.bi, tmp.hov.pj); s += `<circle class="ring" cx="${x}" cy="${y}" r="9"/>`; }
  }
  blocks.forEach((b, i) => {
    const on = sel && sel.t == "b" && sel.i == i, c = col(b), k = ink(c), dk = dark(c), kd = ink(dk);
    const w = bw(b), h = bh(b), m = mi(b), cx = b.x + w / 2, cy = b.y + h / 2, clk = b.ports.some(p => p.role == "clk");
    const a = `class="bx${on ? " on" : ""}" data-b="${i}" fill="${c}"`;
    s += b.kind == "mux"
      ? `<polygon ${a} points="${b.x},${b.y} ${b.x + w},${b.y + m} ${b.x + w},${b.y + h - m} ${b.x},${b.y + h}"/>`
      : isIO(b)
        ? `<polygon ${a} points="${b.x},${b.y} ${b.x + w - 14},${b.y} ${b.x + w},${cy} ${b.x + w - 14},${b.y + h} ${b.x},${b.y + h}"/>`
        : `<rect ${a} x="${b.x}" y="${b.y}" width="${w}" height="${h}" rx="2"/>`;
    if (clk) s += `<polygon data-b="${i}" fill="${dk}" points="${b.x},${b.y + h} ${b.x + w},${b.y + h} ${cx},${b.y + h - 44}"/>`;
    const io = isIO(b), one = io || lite, ny = io ? cy + 4 : b.kind == "adder" ? b.y + h - 22 : (one ? cy + 4 : cy - 1) - (clk ? 13 : 0);
    s += `<text class="t" style="fill:${k}" x="${io ? cx - 7 : cx}" y="${ny}" text-anchor="middle">${esc(b.inst)}${io && b.ports[0].width > 1 ? `<tspan class="w" dx="3">${b.ports[0].width}</tspan>` : ""}</text>`
      + (one ? "" : `<text class="m" style="fill:${k}" x="${cx}" y="${ny + 13}" text-anchor="middle">${esc(b.mod)}</text>`);
    if (b.kind == "adder") s += `<text style="fill:${k};font-size:46px;font-weight:300" x="${cx}" y="${cy + 10}" text-anchor="middle">+</text>`;
    b.ports.forEach((p, j) => {
      const [x, y] = pp(i, j), sd = side(p);
      if (p.role == "clk") { if (!lite) s += `<text style="fill:${kd}" x="${x}" y="${y - 9}" text-anchor="middle">clk</text>`; return; }
      if (!p.role) s += `<circle class="pv" cx="${x}" cy="${y}" r="4"/>`;
      const [tx, ty, an] = sd == "left" ? [x + 10, y + 4, "start"] : sd == "right" ? [x - 10, y + 4, "end"] : sd == "top" ? [x, y + 15, "middle"] : [x, y - 9, "middle"];
      if (!io && !lite) s += `<text style="fill:${p.role == "rst" ? kd : k}" x="${tx}" y="${ty}" text-anchor="${an}">${esc(lab(b, p))}${p.width > 1 ? `<tspan class="w" dx="3">${p.width}</tspan>` : ""}</text>`;
      if (!p.role) s += `<circle class="ph2" data-pt="${i}:${j}" cx="${x}" cy="${y}" r="12"><title>${esc((io ? b.inst : b.inst + "." + p.name) + (p.width > 1 ? ` [${p.width - 1}:0]` : ""))}</title></circle>`;
    });
  });
  $("#cv").innerHTML = s;
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
const cv = $("#cv"), pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
cv.addEventListener("pointerdown", e => {
  if (locked) return;
  const p = pos(e), t = e.target, pe = t.closest("[data-pt]"), be = t.closest("[data-b]"), le = t.closest("[data-l]");
  if (pe) {
    const [bi, pj] = pe.dataset.pt.split(":").map(Number), [x, y] = pp(bi, pj);
    sel = { t: "b", i: bi }; tmp = { bi, pj, x, y, mx: p.x, my: p.y, hov: null };
  } else if (be) {
    const i = +be.dataset.b; sel = { t: "b", i }; drag = { i, ox: p.x - blocks[i].x, oy: p.y - blocks[i].y };
  } else if (le) sel = { t: "l", i: +le.dataset.l };
  else sel = null;
  renderProps(); draw();
});
cv.addEventListener("dblclick", e => {
  const be = e.target.closest("[data-b]"); if (!be) return;
  const b = blocks[+be.dataset.b]; if (b && !isIO(b)) cmd("openModule", id(b.mod));
});
addEventListener("pointermove", e => {
  if (!drag && !tmp) return;
  const p = pos(e);
  if (drag) { const b = blocks[drag.i]; b.x = Math.max(0, snap(p.x - drag.ox)); b.y = Math.max(40, snap(p.y - drag.oy)); magnet(drag.i); }
  else { tmp.mx = p.x; tmp.my = p.y; tmp.hov = nearest(p.x, p.y, tmp); }
  draw();
});
addEventListener("pointerup", () => {
  if (tmp) { if (tmp.hov) connect(tmp, tmp.hov); tmp = null; sync(); }
  if (drag) { drag = null; commit(); }
});
addEventListener("keydown", e => {
  if (locked || e.target.matches("input,select")) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), blk = sel && sel.t == "b";
  if (mod && k == "c" && blk) { clip = JSON.parse(JSON.stringify(blocks[sel.i])); e.preventDefault(); }
  else if (mod && k == "v" && clip) { paste(); e.preventDefault(); }
  else if (mod && k == "d" && blk) { dupBlock(); e.preventDefault(); }
  else if (sel && ["Delete", "Backspace"].includes(e.key)) {
    if (sel.t == "l") { links.splice(sel.i, 1); sel = null; renderProps(); sync(); } else delBlock();
  }
});
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
  links = links.filter(l => l.to != to); links.push({ from: ref(a), to }); magnet(b.bi);
}

/* ---------- Panneau de propriétés (délégation d'événements, compatible CSP) ---------- */
function renderProps() {
  const el = $("#props");
  if (locked || !sel || sel.t != "b" || !blocks[sel.i]) { el.hidden = true; return; }
  el.hidden = false;
  const b = blocks[sel.i], o = (a, c) => a.map(([v, t]) => `<option value="${v}"${v == c ? " selected" : ""}>${t}</option>`).join("");
  if (isIO(b)) {
    el.innerHTML = `<div class="ph">${b.kind == "in" ? "Entrée" : "Sortie"} du top</div>
      <label>Nom <input data-a="b:inst" value="${esc(b.inst)}"></label>
      <label>Largeur <input type="number" min="1" data-a="p:0:width" value="${b.ports[0].width}"></label>
      <label>Couleur <input type="color" data-a="b:color" value="${col(b)}"></label>
      <div class="pr" style="margin-top:8px"><button data-a="dup">Dupliquer</button><button class="x" data-a="del">Supprimer</button></div>`;
    return;
  }
  const ports = b.kind == "mux"
    ? `<label>Entrées <input type="number" min="2" max="8" data-a="mux:n" value="${b.ports.filter(p => p.dir == "in" && !p.side).length}"></label>
       <label>Largeur <input type="number" min="1" data-a="mux:w" value="${b.ports[0].width}"></label>`
    : `<div class="ph">Ports</div>` + b.ports.map((p, j) => `<div class="pr">
      <input type="text" data-a="p:${j}:name" value="${esc(p.name)}">
      <select data-a="p:${j}:dir">${o([["in", "in"], ["out", "out"]], p.dir)}</select>
      <input type="number" min="1" data-a="p:${j}:width" value="${p.width}">
      <select data-a="p:${j}:role">${o([["", "data"], ["clk", "clk"], ["rst", "rst"]], p.role)}</select>
      <button class="x" data-a="delPort:${j}">✕</button></div>`).join("") + `<div class="pr"><button data-a="addPort">+ port</button></div>`;
  el.innerHTML = `<div class="ph">Bloc</div>
    <label>Instance <input data-a="b:inst" value="${esc(b.inst)}"></label>
    <label>Module <input data-a="b:mod" value="${esc(b.mod)}"></label>
    <label>Type <select data-a="kind">${o([["register", "registre"], ["adder", "adder"], ["mux", "mux"], ["custom", "custom"]], b.kind)}</select></label>
    <label>Couleur <input type="color" data-a="b:color" value="${col(b)}"></label>
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
  else if (a == "del") delBlock();
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
function setKind(v) {
  const b = blocks[sel.i]; b.kind = v; b.ports = defPorts(v); b.mod = defMod(v, sel.i + 1); b.color = "";
  links = links.filter(l => find(l.from) && find(l.to)); renderProps(); sync();
}
function setMux(n, w) {
  const b = blocks[sel.i]; n = Math.min(8, Math.max(2, n || b.ports.filter(p => p.dir == "in" && !p.side).length)); w = Math.max(1, w || b.ports[0].width);
  b.ports = muxPorts(n, w); links = links.filter(l => find(l.from) && find(l.to)); sync();
}
function setP(j, k, v) {
  const b = blocks[sel.i], p = b.ports[j];
  if (k == "name") links.forEach(l => ["from", "to"].forEach(s => { if (l[s] == `${b.inst}.${p.name}`) l[s] = `${b.inst}.${v}`; }));
  p[k] = k == "width" ? Math.max(1, +v || 1) : v; sync();
}
function addPort() { const b = blocks[sel.i]; b.ports.push(P("p" + b.ports.length, "in", 1)); renderProps(); sync(); }
function delPort(j) {
  const b = blocks[sel.i], r = `${b.inst}.${b.ports[j].name}`;
  links = links.filter(l => l.from != r && l.to != r); b.ports.splice(j, 1); renderProps(); sync();
}
function addBlock(kind) {
  let n = 1; while (blocks.some(b => b.inst == PRE[kind] + n)) n++;
  const k = 60 + 40 * (blocks.length % 8);
  blocks.push(mk(kind, k, k + 20, n)); sel = { t: "b", i: blocks.length - 1 }; renderProps(); sync();
}
function delBlock() {
  const n = blocks[sel.i].inst;
  links = links.filter(l => !l.from.startsWith(n + ".") && !l.to.startsWith(n + "."));
  blocks.splice(sel.i, 1); sel = null; renderProps(); sync();
}
function paste() {
  const b = JSON.parse(JSON.stringify(clip)); let n = 1;
  while (blocks.some(x => x.inst == PRE[b.kind] + n)) n++;
  b.inst = PRE[b.kind] + n; b.x += 40; b.y += 40; clip.x += 40; clip.y += 40;
  blocks.push(b); sel = { t: "b", i: blocks.length - 1 }; renderProps(); sync();
}
const dupBlock = () => { clip = JSON.parse(JSON.stringify(blocks[sel.i])); paste(); };

/* ---------- Barre d'outils ---------- */
function toggleNom() { lite = !lite; $("#nom").textContent = "Nomenclature : " + (lite ? "allégée" : "normale"); sync(); }
const tools = $("#tools");
tools.addEventListener("click", e => {
  const el = e.target.closest("button[data-a]"); if (!el || locked) return;
  const [a, x] = el.dataset.a.split(":");
  if (a == "add") addBlock(x);
  else if (a == "nom") toggleNom();
  else if (a == "cmd") cmd(x);
  else if (a == "svg") exportSvg();
});
tools.addEventListener("input", e => { if (e.target.dataset.a == "top") { topName = e.target.value; sync(); } });
tools.addEventListener("change", e => { if (e.target.dataset.a == "rst") { rstLow = e.target.value == "low"; sync(); } });

/* ---------- Synchronisation avec le document VS Code ---------- */
const projJson = () => JSON.stringify({ version: 1, topName, rstLow, blocks, links }, null, 1);
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
  if (text === lastText || pending !== null || drag || tmp) return;
  let j = null;
  if (text && text.trim()) {
    try { j = JSON.parse(text); }
    catch { locked = true; blocks = []; links = []; sel = null; renderProps(); draw(); setHint("JSON invalide : édition verrouillée.", true); vscode.postMessage({ type: "invalid" }); return; }
  }
  locked = false; setHint(HINT, false);
  if (j && Array.isArray(j.blocks) && Array.isArray(j.links)) {
    topName = j.topName ?? "top"; blocks = j.blocks; links = j.links; rstLow = j.rstLow !== false;
    blocks.forEach(b => { if (!PRE[b.kind]) b.kind = "custom"; b.ports = b.ports || []; });
  } else defaults();
  lastText = text;
  if (sel && (sel.t == "b" ? !blocks[sel.i] : !links[sel.i])) sel = null;
  $("#top").value = topName; $("#rp").value = rstLow ? "low" : "high";
  renderProps(); draw();
}
function setHint(t, err) { const h = $("#hint"); h.textContent = t; h.classList.toggle("err", !!err); }

/* ---------- Export SVG ---------- */
function svgString() {
  if (!blocks.length) return null;
  const keep = sel; sel = null; draw();
  const c = cv.cloneNode(true); sel = keep; draw();
  c.querySelectorAll(".ph2,.hit").forEach(e => e.remove());
  const x0 = Math.min(...blocks.map(b => b.x)) - 40, y0 = Math.min(...blocks.map(b => b.y)) - 70;
  const x1 = Math.max(...blocks.map(b => b.x + bw(b))) + 40, y1 = Math.max(...blocks.map(b => b.y + bh(b))) + 50;
  const css = 'text{font:11px "Cascadia Code",Consolas,"DejaVu Sans Mono",monospace;fill:#e8e8e8}.t{font-size:12px;font-weight:700}.m{font-size:10px;fill-opacity:.75}tspan.w{font-size:9px;fill-opacity:.65}.wire{stroke:#fff;stroke-width:1.8;fill:none}.pv{fill:#fff;stroke:#000;stroke-width:1.5}';
  c.setAttribute("width", x1 - x0); c.setAttribute("height", y1 - y0);
  c.setAttribute("viewBox", `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  c.insertAdjacentHTML("afterbegin", `<style>${css}</style><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#000"/>`);
  return new XMLSerializer().serializeToString(c);
}
function exportSvg() { const svg = svgString(); if (svg) vscode.postMessage({ type: "svg", svg, name: (id(topName) || "top") + "_schema.svg" }); }

addEventListener("message", e => { if (e.data && e.data.type === "load") load(e.data.text); });
document.addEventListener("visibilitychange", flush);
vscode.postMessage({ type: "ready" });
})();
