'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { midX, range, chanY } = require('../media/wire');

test('midX : milieu par défaut', () => {
  assert.equal(midX(100, 300), 200);
  assert.equal(midX(100, 300, undefined), 200);
  assert.equal(midX(100, 300, NaN), 200);
});

test('midX : position choisie par l\'utilisateur', () => {
  assert.equal(midX(100, 300, 150), 150);
});

test('midX : bornée pour ne pas sortir des blocs', () => {
  const [lo, hi] = range(100, 300);
  assert.equal(midX(100, 300, 0), lo);
  assert.equal(midX(100, 300, 999), hi);
  assert.ok(lo > 100 && hi < 300);
});

test('chanY : canal par défaut, ou position choisie bornée', () => {
  assert.equal(chanY(200, undefined, 100, Infinity), 200);
  assert.equal(chanY(200, 320, 100, Infinity), 320);
  assert.equal(chanY(200, 50, 100, Infinity), 100);          // jamais au-dessus du bas du bloc
  assert.equal(chanY(200, 900, -Infinity, 400), 400);        // borne haute
  assert.equal(chanY(200, NaN, 100, 300), 200);
});
