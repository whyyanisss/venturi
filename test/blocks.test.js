'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const K = require('../media/kinds');
const PL = require('../media/pipeline');
const { generate, validate } = require('../src/gen');
const { input, output } = require('./helpers');

/** Bloc prêt à l'emploi, comme l'éditeur le crée. */
const blk = (kind, inst, patch = {}, rebuild = {}) => {
  const d = K.defaults(kind), b = { inst, kind, x: 0, y: 0, color: '', ...d, ...patch };
  if (Object.keys(rebuild).length) b.ports = K.rebuild(b, rebuild);
  K.syncDerived(b);
  if (K.isAuto(b)) b.mod = K.modFor(b);
  return b;
};
const model = (blocks, links, topName = 'top') => ({ version: 1, topName, rstLow: true, blocks, links });
const errors = m => validate(m).filter(i => i.level === 'error').map(i => i.msg);
const warnings = m => validate(m).filter(i => i.level === 'warning').map(i => i.msg);
const verilog = (b, extra = []) => { const m = model([input('x', 8), input('y', 8), input('e', 1), b, ...extra], []); return generate(m).files[`${b.mod}.v`]; };

/* ---------- kinds.js : logique pure ---------- */

test('chaque bloc a des ports valides, un module automatique et des noms de ports uniques', () => {
  for (const k of K.KINDS) {
    const d = K.defaults(k);
    assert.ok(d.ports.length >= 1, k);
    assert.equal(new Set(d.ports.map(p => p.name)).size, d.ports.length, k);
    assert.ok(/^[A-Za-z_]\w*$/.test(d.mod), `${k} : ${d.mod}`);
    assert.ok(K.META[k].pre && K.META[k].col && K.META[k].label);
  }
});

test('logique : nombre d\'entrées et NON à une seule entrée', () => {
  assert.deepEqual(K.ports('logic', { op: 'and', n: 3 }).map(p => p.name), ['a', 'b', 'c', 'y']);
  assert.deepEqual(K.ports('logic', { op: 'not', n: 5 }).map(p => p.name), ['a', 'y']);
  assert.equal(K.modFor(blk('logic', 'g1', { op: 'not' }, { op: 'not' })), 'inv');
  assert.equal(K.modFor(blk('logic', 'g1', {}, { n: 4 })), 'and4');
});

test('rebuild : conserve les largeurs, applique les changements', () => {
  const b = blk('logic', 'g1', {}, { w: 16 });
  assert.deepEqual(b.ports.map(p => p.width), [16, 16, 16]);
  const p2 = K.rebuild(b, { n: 3 });
  assert.deepEqual(p2.map(p => p.name + p.width), ['a16', 'b16', 'c16', 'y16']);
});

test('ports dérivés : cmp → 1 bit, extraction → hi−lo+1, concaténation → somme', () => {
  const s = blk('slice', 's1', { hi: 6, lo: 2 }, { hi: 6, lo: 2 });
  assert.equal(s.ports.find(p => p.name === 'y').width, 5);
  assert.ok(s.ports.find(p => p.name === 'a').width >= 7, 'l\'entrée est assez large');
  const c = blk('concat', 'c1', {}, { widths: [3, 5, 8], n: 3 });
  assert.equal(c.ports.find(p => p.name === 'y').width, 16);
  c.ports[0].width = 1; assert.equal(K.syncDerived(c), true);
  assert.equal(c.ports.find(p => p.name === 'y').width, 14);
  const m = blk('cmp', 'c2'); m.ports[2].width = 9;
  assert.equal(K.syncDerived(m), true); assert.equal(m.ports[2].width, 1);
});

test('isAuto : un nom choisi à la main n\'est pas renommé', () => {
  assert.equal(K.isAuto(blk('logic', 'g1')), true);
  assert.equal(K.isAuto(blk('logic', 'g1', { mod: 'ma_porte' })), false);
  const g = blk('logic', 'g1'); g.op = 'or'; g.mod = 'and2';                                 // opération changée, nom pas encore
  assert.equal(PL.wantedMod(g), 'or2');                                                      // le nom suit l'opération
  g.mod = 'ma_porte';
  assert.equal(PL.wantedMod(g), 'ma_porte');
});

test('symboles dessinés', () => {
  assert.equal(K.symbol(blk('logic', 'g', { op: 'xnor' })), '~^');
  assert.equal(K.symbol(blk('shift', 's', { op: 'sra', amount: 3 })), '>>>3');
  assert.equal(K.symbol(blk('slice', 's', { hi: 7, lo: 4 })), '[7:4]');
  assert.equal(K.symbol(blk('const', 'k', { value: '0xFF' })), '0xFF');
  assert.equal(K.symbol(blk('counter', 'c', { op: 'down' })), '−1');
  assert.equal(K.symbol(blk('ram', 'r')), null);
});

test('valeur d\'une constante : décimal, hexadécimal, binaire, invalide', () => {
  assert.equal(K.valueLiteral('255', 8), "8'd255");
  assert.equal(K.valueLiteral('0xA5', 8), "8'hA5");
  assert.equal(K.valueLiteral('0b1010_0101', 8), "8'b10100101");
  assert.equal(K.valueLiteral('abc', 8), null);
  assert.equal(K.valueLiteral('-1', 8), null);
  assert.equal(K.valueNumber('0x100'), 256n);
});

/* ---------- gen.js : Verilog des nouveaux blocs ---------- */

test('constante : assign avec la valeur, sur la bonne largeur', () => {
  const v = verilog(blk('const', 'k1', { value: '0xA5' }));
  assert.match(v, /module constn \(\n    output \[7:0\] y\n\);/);
  assert.match(v, /assign y = 8'hA5;/);
});

test('logique : ET, NON-OU, OU exclusif, NON', () => {
  assert.match(verilog(blk('logic', 'g1', { op: 'and' })), /assign y = a & b;/);
  assert.match(verilog(blk('logic', 'g1', { op: 'nor' }, { op: 'nor', n: 3 })), /assign y = ~\(a \| b \| c\);/);
  assert.match(verilog(blk('logic', 'g1', { op: 'xor' }, { op: 'xor' })), /assign y = a \^ b;/);
  assert.match(verilog(blk('logic', 'g1', { op: 'not' }, { op: 'not' })), /assign y = ~a;/);
});

test('comparateur, décaleur, extraction, concaténation', () => {
  assert.match(verilog(blk('cmp', 'c1', { op: 'ge' })), /assign y = \(a >= b\);/);
  assert.match(verilog(blk('shift', 's1', { op: 'shl', amount: 3 })), /assign y = a << 3;/);
  assert.match(verilog(blk('shift', 's1', { op: 'sra', amount: 2 })), /assign y = \$signed\(a\) >>> 2;/);
  assert.match(verilog(blk('slice', 's1', { hi: 5, lo: 2 }, { hi: 5, lo: 2 })), /assign y = a\[5:2\];/);
  assert.match(verilog(blk('concat', 'c1', {}, { n: 3 })), /assign y = \{a, b, c\};/);
});

test('compteur et RAM : logique séquentielle', () => {
  const c = verilog(blk('counter', 'ct1', { op: 'down' }));
  assert.match(c, /output reg \[7:0\] q/);
  assert.match(c, /else if \(en\) q <= q - 1;/);
  const r = verilog(blk('ram', 'ram1'));
  assert.match(r, /reg \[7:0\] mem \[0:\(1 << 4\) - 1\];/);
  assert.match(r, /if \(we\) mem\[addr\] <= din;/);
  assert.match(r, /output reg \[7:0\] dout/);
});

test('même module, réglages différents → paramètres (largeur, décalage, valeur, bits)', () => {
  const s = [blk('shift', 's1', { amount: 1 }), blk('shift', 's2', { amount: 4 })];
  const g = generate(model([input('x', 8), ...s], []));
  assert.match(g.files['shift_shl.v'], /parameter AMOUNT = 1/);
  assert.match(g.files['shift_shl.v'], /assign y = a << AMOUNT;/);
  assert.match(g.files['top.v'], /shift_shl #\(\.AMOUNT\(1\)\) u_s1/);
  assert.match(g.files['top.v'], /shift_shl #\(\.AMOUNT\(4\)\) u_s2/);
  const k = [blk('const', 'k1', { value: '1' }), blk('const', 'k2', { value: '0xFF' }, { w: 16 })];
  const gk = generate(model(k, []));
  assert.match(gk.files['constn.v'], /parameter WIDTH = 8,\n    parameter VALUE = 8'd1/);
  assert.match(gk.files['top.v'], /constn #\(\.WIDTH\(16\), \.VALUE\(16'hFF\)\) u_k2/);
  const sl = [blk('slice', 'a1', { hi: 3, lo: 0 }, { hi: 3, lo: 0 }), blk('slice', 'a2', { hi: 7, lo: 4 }, { hi: 7, lo: 4 })];
  assert.match(generate(model(sl, [])).files['slice.v'], /parameter HI = 3,\n    parameter LO = 0|parameter HI = 3/);
});

test('opérations différentes sous le même nom de module = erreur de structure', () => {
  const a = blk('logic', 'g1', { op: 'and', mod: 'porte' }), b = blk('logic', 'g2', { op: 'or', mod: 'porte' });
  assert.ok(errors(model([a, b], [])).some(e => /ports différents/.test(e)));
  assert.deepEqual(errors(model([blk('logic', 'g1', { op: 'and' }), blk('logic', 'g2', { op: 'or' })], [])), []);
});

/* ---------- validation ---------- */

test('validation : constante invalide / trop grande, bits hors de l\'entrée, décalage', () => {
  assert.ok(errors(model([blk('const', 'k1', { value: 'zz' })], [])).some(e => /valeur « zz » invalide/.test(e)));
  assert.ok(warnings(model([blk('const', 'k1', { value: '300' })], [])).some(w => /ne tient pas sur 8 bits/.test(w)));
  assert.deepEqual(warnings(model([blk('const', 'k1', { value: '255' })], [])).filter(w => /ne tient pas/.test(w)), []);
  const s = blk('slice', 's1', { hi: 9, lo: 2 }); s.ports[0].width = 8;
  assert.ok(warnings(model([s], [])).some(w => /hors de l'entrée/.test(w)));
  assert.ok(errors(model([blk('slice', 's1', { hi: 2, lo: 5 })], [])).some(e => /invalides/.test(e)));
  assert.ok(errors(model([blk('shift', 's1', { amount: -1 })], [])).some(e => /invalide/.test(e)));
  assert.ok(warnings(model([blk('shift', 's1', { amount: 9 })], [])).some(w => /toujours nul/.test(w)));
});

/* ---------- latence ---------- */

test('latence : compteur et RAM comptent pour un cycle', () => {
  const m = model([input('e', 1), blk('counter', 'ct1'), output('o', 8)], [{ from: 'e.p', to: 'ct1.en' }, { from: 'ct1.q', to: 'o.p' }]);
  assert.equal(PL.latency(m.blocks, m.links).cycles, 1);
});

/* ---------- simulation de bout en bout ---------- */

const has = c => !cp.spawnSync(c, ['-V'], { stdio: 'ignore' }).error;
test('tous les blocs ensemble : compile et donne les bonnes valeurs sous iverilog', { skip: has('iverilog') && has('vvp') ? false : 'iverilog introuvable' }, () => {
  const blocks = [
    input('x', 8), input('n4', 4), input('m4', 4), input('e', 1), input('we', 1), input('ad', 4), input('dn', 8),
    blk('const', 'k1', { value: '0xA5' }),
    blk('logic', 'g1', { op: 'and' }), blk('cmp', 'c1', { op: 'eq' }), blk('shift', 'sh1', { op: 'shl', amount: 2 }),
    blk('slice', 'sl1', { hi: 5, lo: 2 }, { hi: 5, lo: 2 }), blk('concat', 'cc1'), blk('counter', 'ct1', {}, { w: 4 }), blk('ram', 'ram1'),
    output('o_and', 8), output('o_eq', 1), output('o_shl', 8), output('o_sl', 4), output('o_cc', 8), output('o_ct', 4), output('o_ram', 8)
  ];
  const L = (a, b) => ({ from: a, to: b });
  const links = [
    L('x.p', 'g1.a'), L('k1.y', 'g1.b'), L('g1.y', 'o_and.p'),
    L('x.p', 'c1.a'), L('k1.y', 'c1.b'), L('c1.y', 'o_eq.p'),
    L('x.p', 'sh1.a'), L('sh1.y', 'o_shl.p'),
    L('x.p', 'sl1.a'), L('sl1.y', 'o_sl.p'),
    L('n4.p', 'cc1.a'), L('m4.p', 'cc1.b'), L('cc1.y', 'o_cc.p'),
    L('e.p', 'ct1.en'), L('ct1.q', 'o_ct.p'),
    L('we.p', 'ram1.we'), L('ad.p', 'ram1.addr'), L('dn.p', 'ram1.din'), L('ram1.dout', 'o_ram.p')
  ];
  const m = model(blocks, links, 'all');
  assert.deepEqual(errors(m), [], errors(m).join(' | '));
  const g = generate(m), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venturi-blk-'));
  const files = Object.entries(g.files).map(([n, b]) => { const f = path.join(dir, n); fs.writeFileSync(f, b); return f; });
  const tb = path.join(dir, 'tb.v');
  fs.writeFileSync(tb, `\`timescale 1ns/1ps
module tb;
  reg clk = 0, rst_n = 0; reg [7:0] x = 8'hA5, dn = 0; reg [3:0] n4 = 3, m4 = 12, ad = 0; reg e = 0, we = 0;
  wire [7:0] o_and, o_shl, o_cc, o_ram; wire o_eq; wire [3:0] o_sl, o_ct;
  all dut (.clk(clk), .rst_n(rst_n), .x(x), .n4(n4), .m4(m4), .e(e), .we(we), .ad(ad), .dn(dn),
           .o_and(o_and), .o_eq(o_eq), .o_shl(o_shl), .o_sl(o_sl), .o_cc(o_cc), .o_ct(o_ct), .o_ram(o_ram));
  always #5 clk = ~clk;
  initial begin
    #23 rst_n = 1;
    if (o_and !== 8'hA5 || o_eq !== 1'b1 || o_shl !== 8'h94 || o_sl !== 4'h9 || o_cc !== 8'h3C) begin
      $display("FAIL comb %h %b %h %h %h", o_and, o_eq, o_shl, o_sl, o_cc); $finish; end
    e = 1; repeat (3) @(posedge clk); #1;
    if (o_ct !== 4'd3) begin $display("FAIL compteur %0d", o_ct); $finish; end
    we = 1; ad = 2; dn = 8'h5A; @(posedge clk); #1 we = 0; @(posedge clk); #1;
    if (o_ram !== 8'h5A) begin $display("FAIL ram %h", o_ram); $finish; end
    x = 8'h00; #1; if (o_eq !== 1'b0) begin $display("FAIL eq"); $finish; end
    $display("PASS"); $finish;
  end
endmodule
`);
  const vvp = path.join(dir, 'a.vvp');
  const c = cp.spawnSync('iverilog', ['-g2012', '-Wall', '-o', vvp, '-s', 'tb', ...files, tb], { encoding: 'utf8' });
  assert.equal(c.status, 0, c.stderr);
  const r = cp.spawnSync('vvp', [vvp], { cwd: dir, encoding: 'utf8', timeout: 20000 });
  assert.match(r.stdout, /PASS/, r.stdout);
});
