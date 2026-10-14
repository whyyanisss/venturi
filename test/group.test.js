'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../media/group');
const { reg, adder, input, output } = require('./helpers');

const geo = { bw: b => (b.kind === 'in' || b.kind === 'out' ? 80 : 100), bh: b => (b.kind === 'in' || b.kind === 'out' ? 34 : 130) };
const at = (b, x, y) => Object.assign(b, { x, y });

test('hit : blocs touchés par un rectangle (coins dans n\'importe quel ordre)', () => {
  const bl = [at(reg('a'), 0, 0), at(reg('b'), 300, 0), at(reg('c'), 0, 300)];
  assert.deepEqual(G.hit(bl, { x0: 0, y0: 0, x1: 150, y1: 50 }, geo), [0]);
  assert.deepEqual(G.hit(bl, { x0: 350, y0: 200, x1: 50, y1: 10 }, geo), [0, 1]);
  assert.deepEqual(G.hit(bl, { x0: 200, y0: 200, x1: 250, y1: 250 }, geo), []);
});

test('align left / right / top / bottom', () => {
  const mk = () => [at(reg('a'), 100, 50), at(reg('b'), 300, 200), at(reg('c'), 200, 120)];
  let b = mk(); G.align(b, [0, 1, 2], 'left', geo);   assert.deepEqual(b.map(x => x.x), [100, 100, 100]);
  b = mk(); G.align(b, [0, 1, 2], 'right', geo);      assert.deepEqual(b.map(x => x.x), [300, 300, 300]);
  b = mk(); G.align(b, [0, 1, 2], 'top', geo);        assert.deepEqual(b.map(x => x.y), [50, 50, 50]);
  b = mk(); G.align(b, [0, 1, 2], 'bottom', geo);     assert.deepEqual(b.map(x => x.y), [200, 200, 200]);
});

test('align centre : blocs de tailles différentes', () => {
  const b = [at(reg('a'), 0, 0), at(input('i'), 500, 0)];       // 100 et 80 de large
  G.align(b, [0, 1], 'hcenter', geo);
  assert.equal(b[0].x + 50, b[1].x + 40);
});

test('align : un seul bloc = rien', () => {
  const b = [at(reg('a'), 7, 9)]; G.align(b, [0], 'left', geo); assert.equal(b[0].x, 7);
});

test('distribute h : intervalles égaux, extrémités fixes, quel que soit l\'ordre', () => {
  const b = [at(reg('a'), 0, 0), at(reg('b'), 500, 0), at(reg('c'), 120, 0), at(reg('d'), 700, 0)];
  G.distribute(b, [0, 1, 2, 3], 'h', geo);
  const xs = b.map(x => x.x).sort((p, q) => p - q);
  assert.equal(xs[0], 0); assert.equal(xs[3], 700);
  const gaps = [xs[1] - (xs[0] + 100), xs[2] - (xs[1] + 100), xs[3] - (xs[2] + 100)];
  assert.ok(gaps.every(g => Math.abs(g - gaps[0]) <= 1), `gaps ${gaps}`);
});

test('distribute v', () => {
  const b = [at(reg('a'), 0, 0), at(reg('b'), 0, 100), at(reg('c'), 0, 600)];
  G.distribute(b, [0, 1, 2], 'v', geo);
  assert.equal(b[1].y, 300);                                    // intervalle (730 - 390) / 2 = 170 ; 130 + 170 = 300
});

test('distribute : moins de 3 blocs = rien', () => {
  const b = [at(reg('a'), 0, 0), at(reg('b'), 50, 0)]; G.distribute(b, [0, 1], 'h', geo); assert.equal(b[1].x, 50);
});

test('copyGroup : garde les liens internes seulement', () => {
  const bl = [input('x'), reg('r1'), reg('r2'), output('z')];
  const ln = [{ from: 'x.p', to: 'r1.d' }, { from: 'r1.q', to: 'r2.d' }, { from: 'r2.q', to: 'z.p' }];
  const c = G.copyGroup(bl, ln, [2, 1]);
  assert.deepEqual(c.blocks.map(b => b.inst), ['r1', 'r2']);
  assert.deepEqual(c.links, [{ from: 'r1.q', to: 'r2.d' }]);
  c.blocks[0].x = 999; assert.notEqual(bl[1].x, 999);           // copie profonde
});

test('pasteGroup : noms libres, liens internes renommés, décalage', () => {
  const bl = [at(reg('r1'), 100, 100), at(reg('r2'), 300, 100)];
  const clip = G.copyGroup(bl, [{ from: 'r1.q', to: 'r2.d', mx: 200 }], [0, 1]);
  const p = G.pasteGroup(bl, [], clip, 40, 40, () => 'r');
  assert.deepEqual(p.blocks.map(b => b.inst), ['r3', 'r4']);
  assert.deepEqual(p.blocks.map(b => [b.x, b.y]), [[140, 140], [340, 140]]);
  assert.deepEqual(p.links, [{ from: 'r3.q', to: 'r4.d', mx: 240 }]);
  assert.equal(bl.length, 2);                                   // l'original n'est pas touché
});

test('pasteGroup : un renommage ne confond pas r1 et r10', () => {
  const bl = [reg('r1'), reg('r10')];
  const clip = G.copyGroup(bl, [{ from: 'r1.q', to: 'r10.d' }], [0, 1]);
  const p = G.pasteGroup(bl, [], clip, 0, 0, () => 'r');
  assert.deepEqual(p.links, [{ from: `${p.blocks[0].inst}.q`, to: `${p.blocks[1].inst}.d` }]);
});
