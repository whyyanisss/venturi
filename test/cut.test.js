'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const PL = require('../media/pipeline');
const { generate, validate, testbench } = require('../src/gen');
const { chain, reg, adder, input, output } = require('./helpers');

const isIO = b => b.kind === 'in' || b.kind === 'out';
/** Géométrie simplifiée, équivalente à celle de l'éditeur : ports à gauche/droite, centrés. */
const mkGeo = model => {
  const bw = b => (isIO(b) ? 80 : b.compact ? 60 : 100), bh = b => (isIO(b) ? 34 : b.compact ? 80 : 130);
  return {
    bw, bh,
    port(ref) {
      const k = ref.indexOf('.'), b = model.blocks.find(x => x.inst === ref.slice(0, k));
      const p = b && b.ports.find(q => q.name === ref.slice(k + 1));
      if (!p) return null;
      const side = p.role ? 'bottom' : (p.side || (p.dir === 'in' ? 'left' : 'right'));
      const x = side === 'right' ? b.x + bw(b) : side === 'left' ? b.x : b.x + bw(b) / 2;
      const y = side === 'bottom' ? b.y + bh(b) : side === 'top' ? b.y : b.y + bh(b) / 2;
      return { b, p, side, x, y };
    }
  };
};
const at = (b, x, y = 120) => Object.assign(b, { x, y });
const errors = m => validate(m).filter(i => i.level === 'error').map(i => i.msg);

const base = () => {
  const m = chain();
  at(m.blocks[0], 20, 168); at(m.blocks[1], 160); at(m.blocks[2], 440); at(m.blocks[3], 620, 168);
  return m;
};

test('coupe entre r1 et r2 : un registre, blocs de droite décalés, schéma valide', () => {
  const m = base(), geo = mkGeo(m);
  const r = PL.insertCut(m.blocks, m.links, 350, geo);
  m.links = r.links;
  assert.equal(r.count, 1);
  const nr = r.regs[0];
  assert.equal(nr.compact, true);
  assert.equal(nr.mod, 'reg8');
  assert.equal(m.blocks.find(b => b.inst === 'r1').x, 160);     // à gauche : inchangé
  assert.equal(m.blocks.find(b => b.inst === 'r2').x, 540);     // à droite : +100
  assert.equal(m.blocks.find(b => b.inst === 'dout').x, 720);
  assert.ok(nr.x > 260 && nr.x + 60 < 540, 'registre dans le trou');
  assert.ok(m.links.some(l => l.from === 'r1.q' && l.to === nr.inst + '.d'));
  assert.ok(m.links.some(l => l.from === nr.inst + '.q' && l.to === 'r2.d'));
  assert.deepEqual(errors(m), []);
});

test('coupe : un signal qui se ramifie n\'obtient qu\'un seul registre', () => {
  const m = {
    version: 1, topName: 'fan', rstLow: true,
    blocks: [at(input('x'), 20, 168), at(adder('a1'), 400), at(output('z'), 620, 168)],
    links: [{ from: 'x.p', to: 'a1.a' }, { from: 'x.p', to: 'a1.b' }, { from: 'a1.s', to: 'z.p' }]
  };
  const r = PL.insertCut(m.blocks, m.links, 250, mkGeo(m));
  m.links = r.links;
  assert.equal(r.count, 1);
  const q = r.regs[0].inst + '.q';
  assert.deepEqual(m.links.filter(l => l.from === q).map(l => l.to).sort(), ['a1.a', 'a1.b']);
  assert.deepEqual(errors(m), []);
});

test('coupe : plusieurs signaux = plusieurs registres, sans chevauchement vertical', () => {
  const m = {
    version: 1, topName: 'two', rstLow: true,
    blocks: [at(input('x', 8), 20, 100), at(input('y', 16), 20, 130), at(adder('a1'), 400), at(output('z'), 620, 168)],
    links: [{ from: 'x.p', to: 'a1.a' }, { from: 'y.p', to: 'a1.b' }, { from: 'a1.s', to: 'z.p' }]
  };
  const r = PL.insertCut(m.blocks, m.links, 250, mkGeo(m));
  assert.equal(r.count, 2);
  const [a, b] = r.regs.sort((p, q) => p.y - q.y);
  assert.ok(b.y >= a.y + 80 + 20, 'au moins 20 px entre les deux registres');
  assert.equal(new Set(r.regs.map(x => x.mod)).size, 1, 'un seul module, paramétré par la largeur de chaque instance');
  assert.deepEqual(r.regs.map(x => x.ports.find(p => p.name === 'd').width).sort((p, q) => p - q), [8, 16]);
  m.links = r.links;
  assert.deepEqual(errors(m), []);
});

const mux2 = (inst) => ({ inst, mod: 'mux2', kind: 'mux', x: 0, y: 0, color: '', ports: [
  { name: 'i0', dir: 'in', width: 8, role: '', side: '' }, { name: 'i1', dir: 'in', width: 8, role: '', side: '' },
  { name: 'sel', dir: 'in', width: 1, role: '', side: 'bottom' }, { name: 'y', dir: 'out', width: 8, role: '', side: '' }] });

test('coupe : le fil vers sel (entrée par le bas d\'un mux) est détecté et enregistré', () => {
  const m = {
    version: 1, topName: 'mx', rstLow: true,
    blocks: [at(input('a', 8), 20, 100), at(input('b', 8), 20, 160), at(input('s', 1), 20, 260), at(mux2('m1'), 400, 100), at(output('z', 8), 620, 168)],
    links: [{ from: 'a.p', to: 'm1.i0' }, { from: 'b.p', to: 'm1.i1' }, { from: 's.p', to: 'm1.sel' }, { from: 'm1.y', to: 'z.p' }]
  };
  const geo = mkGeo(m);
  assert.deepEqual(PL.crossing(m.links, 250, geo), [0, 1, 2], 'les trois entrées du mux, sel compris');
  const r = PL.insertCut(m.blocks, m.links, 250, geo);
  m.links = r.links;
  assert.equal(r.count, 3);
  const sel = r.regs.find(x => m.links.some(l => l.from === x.inst + '.q' && l.to === 'm1.sel'));
  assert.ok(sel, 'un registre alimente sel');
  assert.equal(sel.ports.find(p => p.name === 'd').width, 1);
  assert.deepEqual(errors(m), []);
});

test('coupe : une ligne qui traverse un bloc est repoussée à sa droite', () => {
  const m = base(), geo = mkGeo(m);
  assert.equal(PL.adjustCut(m.blocks, 200, geo), 280);          // r1 occupe 160–260
  assert.equal(PL.adjustCut(m.blocks, 350, geo), 350);
});

test('coupe : rien à couper = aucun changement', () => {
  const m = base(), before = JSON.stringify(m);
  const r = PL.insertCut(m.blocks, m.links, 10, mkGeo(m));
  assert.equal(r.count, 0);
  assert.equal(JSON.stringify({ ...m, links: r.links }), before);
});

test('crossing : un lien de retour (droite → gauche) n\'est pas coupé', () => {
  const m = {
    blocks: [at(reg('a'), 400), at(reg('b'), 100)],
    links: [{ from: 'a.q', to: 'b.d' }]
  };
  assert.deepEqual(PL.crossing(m.links, 300, mkGeo(m)), []);
});

/* ---------- Latence ---------- */

test('latence : chain = 2 cycles', () => {
  assert.deepEqual(PL.latency(chain().blocks, chain().links), { cycles: 2, cyclic: false });
});

test('latence : un registre ×3 compte pour 3', () => {
  const m = chain(); m.blocks[1].depth = 3;
  assert.equal(PL.latency(m.blocks, m.links).cycles, 4);
});

test('latence : le plus long chemin l\'emporte', () => {
  const m = {
    blocks: [input('x'), reg('r1'), reg('r2'), adder('a1'), output('z')],
    links: [{ from: 'x.p', to: 'a1.a' }, { from: 'x.p', to: 'r1.d' }, { from: 'r1.q', to: 'r2.d' }, { from: 'r2.q', to: 'a1.b' }, { from: 'a1.s', to: 'z.p' }]
  };
  assert.equal(PL.latency(m.blocks, m.links).cycles, 2);       // via r1 puis r2 (l'autre chemin vaut 0)
});

test('latence : une boucle est signalée sans bloquer le calcul', () => {
  const m = chain(); m.links.push({ from: 'r2.q', to: 'r1.d' });
  const r = PL.latency(m.blocks, m.links);
  assert.equal(r.cyclic, true);
  assert.equal(r.cycles, 2);
});

test('latence : pas de chemin entrée → sortie = null', () => {
  assert.equal(PL.latency([input('x'), output('z')], []).cycles, null);
});

/* ---------- Registre à profondeur N ---------- */

const delay = (n, w = 8) => {
  const m = chain({ topName: 'dly', blocks: [input('din', w), reg('r1', 0, `reg${w}x${n}`, w), output('dout', w)], links: [{ from: 'din.p', to: 'r1.d' }, { from: 'r1.q', to: 'dout.p' }] });
  m.blocks[1].depth = n;
  return m;
};

test('profondeur N : un seul module à N étages', () => {
  const g = generate(delay(4));
  assert.deepEqual(Object.keys(g.files).sort(), ['dly.v', 'reg8x4.v']);
  const v = g.files['reg8x4.v'];
  assert.match(v, /reg \[7:0\] pipe_stage \[0:3\];/);
  assert.match(v, /assign q = pipe_stage\[3\];/);
  assert.doesNotMatch(v, /output reg/);
  assert.match(v, /output \[7:0\] q/);
});

test('profondeur 1 : inchangé (registre simple)', () => {
  const m = delay(1); delete m.blocks[1].depth;
  assert.match(generate(m).files['reg8x1.v'], /output reg \[7:0\] q/);
});

test('profondeur : profondeurs différentes sur un même module → module paramétré, pas d\'erreur', () => {
  const m = chain();
  m.blocks[1].depth = 3;                                         // r1 (×3) et r2 (×1) partagent « reg8 »
  assert.deepEqual(errors(m), []);
  const g = generate(m);
  assert.deepEqual(Object.keys(g.files).sort(), ['chain.v', 'reg8.v']);
  assert.match(g.files['reg8.v'], /module reg8 #\(\n    parameter DEPTH = 3\n\) \(/);
  assert.match(g.files['reg8.v'], /pipe_stage \[0:DEPTH - 1\]/);
  assert.match(g.files['chain.v'], /reg8 #\(\.DEPTH\(3\)\) u_r1/);
  assert.match(g.files['chain.v'], /reg8 #\(\.DEPTH\(1\)\) u_r2/);
});

test('profondeur : makeRegister réutilise le module existant, quelle que soit la profondeur', () => {
  const m = chain(); m.blocks[1].depth = 3;
  assert.equal(PL.makeRegister(m.blocks, 8).mod, 'reg8');
});

test('profondeur : nom de port « pipe_stage » ne provoque pas de collision', () => {
  const m = delay(2);
  m.blocks[1].ports[2].name = 'pipe_stage';
  const v = generate(m).files['reg8x2.v'];
  assert.match(v, /reg \[7:0\] pipe_stage_ \[0:1\];/);
});

const has = c => !cp.spawnSync(c, ['-V'], { stdio: 'ignore' }).error;
test('profondeur 3 : la sortie arrive bien après 3 cycles (iverilog)', { skip: has('iverilog') && has('vvp') ? false : 'iverilog introuvable' }, () => {
  const m = delay(3), g = generate(m);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venturi-dly-'));
  fs.mkdirSync(path.join(dir, 'build'));
  const files = Object.entries(g.files).map(([n, b]) => { const f = path.join(dir, n); fs.writeFileSync(f, b); return f; });
  const tb = path.join(dir, 'tb.v');
  fs.writeFileSync(tb, `\`timescale 1ns/1ps
module tb;
  reg clk = 0, rst_n = 0; reg [7:0] din = 0; wire [7:0] dout;
  dly dut (.clk(clk), .rst_n(rst_n), .din(din), .dout(dout));
  always #5 clk = ~clk;
  initial begin
    #22 rst_n = 1; din = 8'h5A;
    @(posedge clk); #1; if (dout !== 8'h00) begin $display("FAIL c1 %h", dout); $finish; end
    @(posedge clk); #1; if (dout !== 8'h00) begin $display("FAIL c2 %h", dout); $finish; end
    @(posedge clk); #1; if (dout !== 8'h5A) begin $display("FAIL c3 %h", dout); $finish; end
    $display("PASS"); $finish;
  end
endmodule
`);
  const vvp = path.join(dir, 'd.vvp');
  const c = cp.spawnSync('iverilog', ['-g2012', '-Wall', '-o', vvp, '-s', 'tb', ...files, tb], { encoding: 'utf8' });
  assert.equal(c.status, 0, c.stderr);
  const r = cp.spawnSync('vvp', [vvp], { cwd: dir, encoding: 'utf8', timeout: 20000 });
  assert.match(r.stdout, /PASS/, r.stdout);
});

test('module paramétré (largeur ET profondeur) : compile et se simule sous iverilog', { skip: has('iverilog') && has('vvp') ? false : 'iverilog introuvable' }, () => {
  const m = {
    version: 1, topName: 'par', rstLow: true,
    blocks: [input('a', 8), reg('r1', 0, 'regn', 8), output('ya', 8), input('b', 16), reg('r2', 0, 'regn', 16), output('yb', 16)],
    links: [{ from: 'a.p', to: 'r1.d' }, { from: 'r1.q', to: 'ya.p' }, { from: 'b.p', to: 'r2.d' }, { from: 'r2.q', to: 'yb.p' }]
  };
  m.blocks[4].depth = 3;
  assert.deepEqual(errors(m), []);
  const g = generate(m);
  assert.deepEqual(Object.keys(g.files).sort(), ['par.v', 'regn.v']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venturi-par-'));
  const files = Object.entries(g.files).map(([n, b]) => { const f = path.join(dir, n); fs.writeFileSync(f, b); return f; });
  const tb = path.join(dir, 'tb.v');
  fs.writeFileSync(tb, `\`timescale 1ns/1ps
module tb;
  reg clk = 0, rst_n = 0; reg [7:0] a = 0; reg [15:0] b = 0; wire [7:0] ya; wire [15:0] yb;
  par dut (.clk(clk), .rst_n(rst_n), .a(a), .b(b), .ya(ya), .yb(yb));
  always #5 clk = ~clk;
  initial begin
    #22 rst_n = 1; a = 8'hA5; b = 16'hBEEF;
    @(posedge clk); #1; if (ya !== 8'hA5 || yb !== 16'h0000) begin $display("FAIL c1 %h %h", ya, yb); $finish; end
    @(posedge clk); #1; if (yb !== 16'h0000) begin $display("FAIL c2 %h", yb); $finish; end
    @(posedge clk); #1; if (yb !== 16'hBEEF || ya !== 8'hA5) begin $display("FAIL c3 %h %h", ya, yb); $finish; end
    $display("PASS"); $finish;
  end
endmodule
`);
  const vvp = path.join(dir, 'p.vvp');
  const c = cp.spawnSync('iverilog', ['-g2012', '-Wall', '-o', vvp, '-s', 'tb', ...files, tb], { encoding: 'utf8' });
  assert.equal(c.status, 0, c.stderr);
  const r = cp.spawnSync('vvp', [vvp], { cwd: dir, encoding: 'utf8', timeout: 20000 });
  assert.match(r.stdout, /PASS/, r.stdout);
});
