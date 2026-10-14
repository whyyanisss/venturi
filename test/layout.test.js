'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../media/layout');

const P = (name, dir, width = 8, role = '', side = '') => ({ name, dir, width, role, side });
const blk = (inst, kind, x, y, ports, extra = {}) => ({ inst, mod: 'm', kind, x, y, color: '', ports, ...extra });
const geo = {
  bw: b => (b.kind === 'in' || b.kind === 'out' ? 80 : b.compact ? 60 : 100),
  bh: b => L.height(b.kind, Math.max(1, b.ports.filter(p => L.sideOf(p) === 'left').length, b.ports.filter(p => L.sideOf(p) === 'right').length), { compact: !!b.compact, width: b.compact ? 60 : 100 })
};
const reg = (inst, x, y, compact = true) => blk(inst, 'register', x, y, [P('clk', 'in', 1, 'clk'), P('rst', 'in', 1, 'rst'), P('d', 'in'), P('q', 'out')], { compact });
const io = (inst, kind, x, y) => blk(inst, kind, x, y, [P('p', kind === 'in' ? 'out' : 'in')]);

test('slots : toujours des multiples de 20, symétriques', () => {
  assert.deepEqual(L.slots(1, 80), [40]);
  assert.deepEqual(L.slots(2, 80), [20, 60]);
  assert.deepEqual(L.slots(3, 80), [20, 40, 60]);
  assert.deepEqual(L.slots(1, 120), [60]);
  assert.deepEqual(L.slots(2, 120), [40, 80]);
  assert.deepEqual(L.slots(3, 120), [20, 60, 100]);
  assert.deepEqual(L.slots(4, 120), [20, 40, 80, 100]);
  assert.deepEqual(L.slots(1, 40), [20]);
  for (let h = 40; h <= 400; h += 40) for (let n = 1; n <= 8; n++) {
    const s = L.slots(n, h);
    assert.equal(s.length, n);
    assert.ok(s.every(v => v % 20 === 0), `h=${h} n=${n}: ${s}`);
    if (n < h / 20) {                                               // symétrie quand tout tient
      assert.ok(s.every((v, i) => v + s[n - 1 - i] === h), `asymétrique h=${h} n=${n}: ${s}`);
      assert.ok(s.every((v, i) => i === 0 || v > s[i - 1]));
    }
  }
});

test('slots : trop de ports → lignes consécutives (le bloc devra grandir)', () => {
  assert.deepEqual(L.slots(5, 80), [20, 40, 60, 80, 100]);
  assert.deepEqual(L.slots(0, 80), []);
});

test('height : multiple de 40, assez haut pour les ports', () => {
  assert.equal(L.height('in', 1), 40);
  assert.equal(L.height('register', 1, { compact: true }), 80);
  assert.equal(L.height('register', 3, { compact: true }), 80);
  assert.equal(L.height('register', 4, { compact: true }), 120);
  assert.equal(L.height('register', 1), 120);
  assert.equal(L.height('mux', 2), 160);
  for (const k of ['register', 'adder', 'mux', 'custom']) for (let n = 1; n <= 9; n++) {
    const h = L.height(k, n, { width: 100 });
    assert.equal(h % 40, 0);
    assert.ok(h >= 20 * (n + 1));
  }
});

test('ports sur la grille : un bloc posé sur la grille a tous ses ports sur la grille', () => {
  const blocks = [reg('r1', 160, 120), reg('r2', 440, 120, false), io('din', 'in', 20, 140),
    blk('m', 'mux', 300, 200, [P('i0', 'in'), P('i1', 'in'), P('sel', 'in', 1, '', 'bottom'), P('y', 'out')])];
  blocks.forEach(b => L.portPositions(b, geo).forEach((p, j) => {
    if (p.side === 'left' || p.side === 'right') assert.equal(p.y % 20, 0, `${b.inst}.${b.ports[j].name} y=${p.y}`);
    assert.equal(p.x % 20, 0, `${b.inst}.${b.ports[j].name} x=${p.x}`);
  }));
});

test('entrée/sortie d\'un registre à la même hauteur (centre) et IO alignés avec lui', () => {
  const r = reg('r1', 160, 120), din = io('din', 'in', 20, 140);
  const [, , d, q] = L.portPositions(r, geo), [pin] = L.portPositions(din, geo);
  assert.equal(d.y, q.y);
  assert.equal(pin.y, d.y);                                          // din (y=140, h=40) ↔ r1 (y=120, h=80) : fil droit
});

test('mux : le port du bas suit le bord incliné', () => {
  const m = blk('m', 'mux', 300, 200, [P('i0', 'in'), P('i1', 'in'), P('sel', 'in', 1, '', 'bottom'), P('y', 'out')]);
  const sel = L.portPositions(m, geo)[2], h = geo.bh(m);
  assert.ok(sel.y < m.y + h, 'remonté par la pente');
  assert.equal(sel.x % 20, 0);
});

test('straighten : un pipeline décalé est redressé de gauche à droite', () => {
  const blocks = [io('din', 'in', 20, 140), reg('r1', 160, 200), reg('r2', 300, 80), io('dout', 'out', 440, 320)];
  const links = [{ from: 'din.p', to: 'r1.d' }, { from: 'r1.q', to: 'r2.d' }, { from: 'r2.q', to: 'dout.p' }];
  const n = L.straighten(blocks, links, null, geo);
  assert.equal(n, 3);
  const y = i => L.portPositions(blocks[i], geo).find(p => p.side === 'left' || p.side === 'right').y;
  assert.equal(y(0), y(1)); assert.equal(y(1), y(2)); assert.equal(y(2), y(3));
  assert.equal(blocks[0].y, 140);                                    // la source ne bouge pas
});

test('straighten : seulement la sélection, les autres blocs restent des références', () => {
  const blocks = [io('din', 'in', 20, 140), reg('r1', 160, 200), reg('r2', 300, 80)];
  const links = [{ from: 'din.p', to: 'r1.d' }, { from: 'r1.q', to: 'r2.d' }];
  L.straighten(blocks, links, [2], geo);
  assert.equal(blocks[1].y, 200);                                    // r1 non sélectionné : inchangé
  const [, , d] = L.portPositions(blocks[2], geo), [, , , q] = L.portPositions(blocks[1], geo);
  assert.equal(d.y, q.y);
});

test('straighten : plusieurs sources → médiane, et déjà aligné → 0 déplacement', () => {
  const blocks = [io('a', 'in', 20, 100), io('b', 'in', 20, 220),
    blk('add', 'adder', 200, 100, [P('a', 'in'), P('b', 'in'), P('s', 'out')])];
  const links = [{ from: 'a.p', to: 'add.a' }, { from: 'b.p', to: 'add.b' }];
  assert.equal(L.straighten(blocks, links, null, geo), 1);
  assert.equal(L.straighten(blocks, links, null, geo), 0);
});

test('straighten : respecte la limite haute', () => {
  const blocks = [io('din', 'in', 20, 40), reg('r1', 160, 200)];
  L.straighten(blocks, [{ from: 'din.p', to: 'r1.d' }], null, geo, 60);
  assert.ok(blocks[1].y >= 60);
});

test('guides : un port aligné sur celui d\'un autre bloc est signalé', () => {
  const blocks = [reg('r1', 160, 120), reg('r2', 440, 120), reg('r3', 440, 300)];
  const g = L.guides(blocks, 2, geo);
  assert.equal(g.h.length, 0);
  blocks[2].y = 120 + 160;                                           // pas aligné
  assert.equal(L.guides(blocks, 2, geo).h.length, 0);
  blocks[2].y = 120;                                                 // aligné avec r2 et r1
  assert.ok(L.guides(blocks, 2, geo).h.length >= 2);
});

test('snapAll / offGrid', () => {
  const blocks = [io('a', 'in', 23, 168), reg('r1', 160, 120)];
  assert.equal(L.offGrid(blocks), true);
  assert.equal(L.snapAll(blocks), 1);
  assert.equal(L.offGrid(blocks), false);
  assert.deepEqual([blocks[0].x, blocks[0].y], [20, 160]);
});
