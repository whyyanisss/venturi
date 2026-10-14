'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generate, testbench, validate, idOf } = require('../src/gen');
const { reg, adder, mux, input, output, chain } = require('./helpers');

const errors = m => validate(m).filter(i => i.level === 'error').map(i => i.msg);
const warnings = m => validate(m).filter(i => i.level === 'warning').map(i => i.msg);

test('idOf remplace les caractères invalides', () => {
  assert.equal(idOf('a-b c'), 'a_b_c');
  assert.equal(idOf('ok_1'), 'ok_1');
});

test('chain : fichiers générés', () => {
  const g = generate(chain());
  assert.equal(g.top, 'chain');
  assert.equal(g.topFile, 'chain.v');
  assert.deepEqual(Object.keys(g.files).sort(), ['chain.v', 'reg8.v']);
});

test('chain : module top', () => {
  const top = generate(chain()).files['chain.v'];
  assert.match(top, /module chain \(\s*input clk,\s*input rst_n,\s*input \[7:0\] din,\s*output \[7:0\] dout\s*\);/);
  assert.match(top, /wire \[7:0\] r1_q;/);
  assert.match(top, /reg8 u_r1 \(/);
  assert.match(top, /\.d\(din\)/);
  assert.match(top, /\.d\(r1_q\)/);
  assert.match(top, /assign dout = r2_q;/);
});

test('registre : reset asynchrone actif bas', () => {
  const v = generate(chain()).files['reg8.v'];
  assert.match(v, /always @\(posedge clk or negedge rst_n\)/);
  assert.match(v, /if \(!rst_n\) q <= 0;/);
  assert.match(v, /output reg \[7:0\] q/);
});

test('registre : reset asynchrone actif haut', () => {
  const g = generate(chain({ rstLow: false }));
  assert.match(g.files['reg8.v'], /always @\(posedge clk or posedge rst\)/);
  assert.match(g.files['reg8.v'], /if \(rst\) q <= 0;/);
  assert.match(g.files['chain.v'], /input rst,/);
});

test('un module partagé n\'est généré qu\'une fois', () => {
  const g = generate(chain());
  assert.equal(Object.keys(g.files).filter(f => f === 'reg8.v').length, 1);
  assert.equal((g.files['chain.v'].match(/reg8 u_/g) || []).length, 2);
});

test('additionneur', () => {
  const m = chain({
    blocks: [input('x'), input('y'), adder('a1'), output('z')],
    links: [{ from: 'x.p', to: 'a1.a' }, { from: 'y.p', to: 'a1.b' }, { from: 'a1.s', to: 'z.p' }]
  });
  assert.match(generate(m).files['add8.v'], /assign s = a \+ b;/);
});

test('mux 3 entrées', () => {
  const m = chain({
    blocks: [input('a'), input('b'), input('c'), input('s', 2), mux('m1', 3), output('o')],
    links: [
      { from: 'a.p', to: 'm1.i0' }, { from: 'b.p', to: 'm1.i1' }, { from: 'c.p', to: 'm1.i2' },
      { from: 's.p', to: 'm1.sel' }, { from: 'm1.y', to: 'o.p' }
    ]
  });
  const v = generate(m).files['mux3.v'];
  assert.match(v, /assign y = \(sel == 0\) \? i0 : \(sel == 1\) \? i1 : i2;/);
  assert.match(v, /input \[1:0\] sel/);
});

test('sortie non connectée : TODO dans le top', () => {
  const m = chain({ links: [{ from: 'din.p', to: 'r1.d' }, { from: 'r1.q', to: 'r2.d' }] });
  assert.match(generate(m).files['chain.v'], /TODO: sortie dout non connectée/);
});

test('testbench : horloge, reset, dump, finish', () => {
  const tb = testbench(chain());
  assert.match(tb, /module tb_chain;/);
  assert.match(tb, /reg rst_n = 0;/);
  assert.match(tb, /reg \[7:0\] din = 0;/);
  assert.match(tb, /wire \[7:0\] dout;/);
  assert.match(tb, /\$dumpfile\("build\/tb_chain\.vcd"\)/);
  assert.match(tb, /\$finish/);
});

/* ---------- validate ---------- */

test('validate : schéma propre → aucun problème', () => {
  assert.deepEqual(validate(chain()), []);
});

test('validate : instances en double (y compris après nettoyage)', () => {
  const m = chain({ blocks: [input('din'), reg('a-b'), reg('a_b'), output('dout')], links: [] });
  assert.ok(errors(m).some(e => /même nom d'instance/.test(e)));
});

test('validate : même module, ports différents (noms ou sens) → erreur', () => {
  const m = chain();
  m.blocks[2].ports[2].name = 'din';                             // r2.d renommé alors que r1 et r2 partagent « reg8 »
  assert.ok(errors(m).some(e => /ports différents/.test(e)));
});

test('validate : même module, largeurs différentes → OK (paramètre Verilog)', () => {
  const m = chain({ blocks: [input('din'), reg('r1'), reg('r2', 0, 'reg8', 4), output('dout')] });
  assert.deepEqual(errors(m), []);
});

test('validate : même module, mêmes ports → OK', () => {
  assert.deepEqual(errors(chain()), []);
});

test('validate : mots réservés Verilog', () => {
  const m = chain({ blocks: [input('din'), reg('wire'), reg('r2'), output('dout')] });
  assert.ok(errors(m).some(e => /réservé/.test(e)));
});

test('validate : E/S nommée comme l\'horloge ou le reset', () => {
  assert.ok(errors(chain({ blocks: [input('clk'), reg('r1'), reg('r2'), output('dout')] })).some(e => /réservé par le module top/.test(e)));
  assert.ok(errors(chain({ blocks: [input('rst_n'), reg('r1'), reg('r2'), output('dout')] })).some(e => /réservé par le module top/.test(e)));
});

test('validate : module nommé comme le top', () => {
  const m = chain({ topName: 'reg8' });
  assert.ok(errors(m).some(e => /même nom que le module top/.test(e)));
});

test('validate : sens de lien invalide', () => {
  const m = chain({ links: [{ from: 'r1.d', to: 'r2.d' }, { from: 'din.p', to: 'r1.d' }, { from: 'r2.q', to: 'dout.p' }] });
  assert.ok(errors(m).some(e => /d'une sortie vers une entrée/.test(e)));
});

test('validate : double pilotage', () => {
  const m = chain({ links: [{ from: 'din.p', to: 'r1.d' }, { from: 'r2.q', to: 'r1.d' }, { from: 'r1.q', to: 'r2.d' }, { from: 'r2.q', to: 'dout.p' }] });
  assert.ok(errors(m).some(e => /plusieurs sources/.test(e)));
});

test('validate : largeurs différentes → avertissement', () => {
  const m = chain({ blocks: [input('din', 4), reg('r1'), reg('r2'), output('dout')] });
  assert.ok(warnings(m).some(w => /Largeurs différentes/.test(w)));
  assert.deepEqual(errors(m), []);
});

test('validate : entrée non connectée → avertissement', () => {
  const m = chain({ links: [{ from: 'r1.q', to: 'r2.d' }, { from: 'r2.q', to: 'dout.p' }] });
  assert.ok(warnings(m).some(w => /r1\.d non connectée/.test(w)));
});

test('validate : lien vers un port supprimé → avertissement', () => {
  const m = chain({ links: [...chain().links, { from: 'r1.q', to: 'ghost.d' }] });
  assert.ok(warnings(m).some(w => /ignoré/.test(w)));
});

/* ---------- Modules paramétrés : la taille est un paramètre de l'instance ---------- */

const widthModel = () => chain({
  blocks: [input('din'), reg('r1'), reg('r2', 0, 'reg8', 16), output('dout')]
});

test('largeurs différentes sur un module partagé → un seul fichier, paramétré par WIDTH', () => {
  const g = generate(widthModel());
  assert.deepEqual(Object.keys(g.files).sort(), ['chain.v', 'reg8.v']);
  const v = g.files['reg8.v'];
  assert.match(v, /module reg8 #\(\n    parameter WIDTH = 8\n\) \(/);
  assert.match(v, /input \[WIDTH-1:0\] d/);
  assert.match(v, /output reg \[WIDTH-1:0\] q/);
  assert.match(v, /input clk/);                                  // les ports de largeur fixe restent littéraux
  assert.match(g.files['chain.v'], /reg8 #\(\.WIDTH\(8\)\) u_r1/);
  assert.match(g.files['chain.v'], /reg8 #\(\.WIDTH\(16\)\) u_r2/);
});

test('mêmes largeurs partout → module non paramétré (sortie inchangée)', () => {
  const g = generate(chain());
  assert.doesNotMatch(g.files['reg8.v'], /parameter/);
  assert.doesNotMatch(g.files['chain.v'], /#\(/);
  assert.match(g.files['reg8.v'], /output reg \[7:0\] q/);
});

test('changer la taille d\'une seule instance change le fichier du module (jamais un nouveau module)', () => {
  const a = generate(chain()), m = chain();
  m.blocks[2].ports.forEach(p => { if (!p.role) p.width = 12; });
  const b = generate(m);
  assert.deepEqual(Object.keys(b.files).sort(), Object.keys(a.files).sort());
  assert.notEqual(b.files['reg8.v'], a.files['reg8.v']);
});

test('plusieurs groupes de largeurs → un paramètre par groupe (W_<port>)', () => {
  const add = (inst, w, ws) => { const x = adder(inst); x.ports[0].width = w; x.ports[1].width = w; x.ports[2].width = ws; return x; };
  const m = { version: 1, topName: 'ad', rstLow: true, blocks: [add('a1', 8, 9), add('a2', 12, 13)], links: [] };
  const g = generate(m);
  assert.match(g.files['add8.v'], /parameter W_a = 8,\n    parameter W_s = 9/);
  assert.match(g.files['add8.v'], /input \[W_a-1:0\] a/);
  assert.match(g.files['add8.v'], /output \[W_s-1:0\] s/);
  assert.match(g.files['ad.v'], /add8 #\(\.W_a\(8\), \.W_s\(9\)\) u_a1/);
  assert.match(g.files['ad.v'], /add8 #\(\.W_a\(12\), \.W_s\(13\)\) u_a2/);
});
