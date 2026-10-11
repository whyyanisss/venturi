'use strict';
/** Fabriques de schémas pour les tests. */
const P = (name, dir, width, role = '', side = '') => ({ name, dir, width, role, side });

const reg = (inst, x = 0, mod = 'reg8', w = 8) => ({
  inst, mod, kind: 'register', x, y: 120, color: '',
  ports: [P('clk', 'in', 1, 'clk'), P('rst', 'in', 1, 'rst'), P('d', 'in', w), P('q', 'out', w)]
});
const adder = (inst, mod = 'add8', w = 8) => ({
  inst, mod, kind: 'adder', x: 0, y: 0, color: '', ports: [P('a', 'in', w), P('b', 'in', w), P('s', 'out', w)]
});
const mux = (inst, n = 2, w = 8, mod = `mux${n}`) => ({
  inst, mod, kind: 'mux', x: 0, y: 0, color: '',
  ports: [...Array(n)].map((_, i) => P('i' + i, 'in', w))
    .concat(P('sel', 'in', Math.max(1, Math.ceil(Math.log2(n))), '', 'bottom'), P('y', 'out', w))
});
const input = (inst, w = 8) => ({ inst, mod: '', kind: 'in', x: 0, y: 0, color: '', ports: [P('p', 'out', w)] });
const output = (inst, w = 8) => ({ inst, mod: '', kind: 'out', x: 0, y: 0, color: '', ports: [P('p', 'in', w)] });

/** din → r1 → r2 → dout */
const chain = (over = {}) => ({
  version: 1, topName: 'chain', rstLow: true,
  blocks: [input('din'), reg('r1'), reg('r2'), output('dout')],
  links: [{ from: 'din.p', to: 'r1.d' }, { from: 'r1.q', to: 'r2.d' }, { from: 'r2.q', to: 'dout.p' }],
  ...over
});

module.exports = { P, reg, adder, mux, input, output, chain };
