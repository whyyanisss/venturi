'use strict';
// Éditeur réel (src/html.js + media/*.js) exécuté dans jsdom : vrai DOM, vrais événements, sans VS Code.
// jsdom ne calcule pas de mise en page : on teste le comportement et la géométrie du schéma, pas le rendu pixel.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { buildHtml } = require('../src/html');

const MEDIA = path.join(__dirname, '..', 'media');
const wait = ms => new Promise(r => setTimeout(r, ms));

function boot() {
  const html = buildHtml({ nonce: 'n', cspSource: 'x', uri: f => 'media/' + f, version: 'test' }).replace(/<script[^>]*src=[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, posted = [], errors = [];
  w.acquireVsCodeApi = () => ({ postMessage: m => posted.push(m) });
  w.addEventListener('error', e => errors.push(String(e.error ? e.error.stack || e.error : e.message)));
  for (const f of ['wire', 'layout', 'kinds', 'pipeline', 'group', 'editor']) {
    try { w.eval(fs.readFileSync(path.join(MEDIA, f + '.js'), 'utf8')); } catch (e) { errors.push(`${f}.js : ${e.stack}`); }
  }
  const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
  const el = x => (typeof x === 'string' ? $(x) : x);
  const fire = (target, type, init = {}) => el(target).dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  const api = {
    w, posted, errors, $, $$, wait,
    load: m => w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'load', text: typeof m === 'string' ? m : JSON.stringify(m) } })),
    click: x => el(x).click(),
    btn: a => { const b = $(`button[data-a="${a}"]`); if (!b) throw new Error(`bouton data-a="${a}" introuvable`); b.click(); },
    menu: k => { const b = $(`[data-menu="${k}"]`); b.click(); },
    down: (target, init = {}) => fire(target, 'pointerdown', init),
    move: (x, y = 0, init = {}) => w.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y, ...init })),
    up: () => w.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true })),
    key: (key, init = {}) => w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })),
    input: (x, v) => { const e = el(x); e.value = String(v); e.dispatchEvent(new w.Event('input', { bubbles: true })); },
    change: (x, v) => { const e = el(x); e.value = String(v); e.dispatchEvent(new w.Event('change', { bubbles: true })); },
    tick: (ms = 300) => wait(ms),
    /** Dernier schéma écrit par l'éditeur. */
    model: () => { const m = posted.filter(p => p.type === 'edit').pop(); if (!m) throw new Error('aucune modification envoyée'); return JSON.parse(m.text); },
    block: i => $(`[data-b="${i}"].bx, rect[data-b="${i}"], polygon[data-b="${i}"]`),
    /** Coordonnées [x, y] de tous les ports dessinés, par « bloc:port ». */
    ports: () => Object.fromEntries($$('[data-pt]').map(c => [c.dataset.pt, [+c.getAttribute('cx'), +c.getAttribute('cy')]])),
    wires: () => $$('path.wire').map(p => p.getAttribute('d'))
  };
  return api;
}

const P = (name, dir, width = 8, role = '', side = '') => ({ name, dir, width, role, side });
module.exports = { boot, wait, P };
