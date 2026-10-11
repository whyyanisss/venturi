'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { cfg, dirs } = require('./project');

const { out } = require('./log');
const diag = vscode.languages.createDiagnosticCollection('iverilog');
let busy = false;

const INSTALL_HINT = 'Dans WSL : sudo apt install iverilog gtkwave';

/* ---------- Utilitaires ---------- */

async function walk(dir, acc = []) {
  let ents;
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) await walk(f, acc); }
    else if (/\.s?v$/.test(e.name)) acc.push(f);
  }
  return acc.sort();
}

function run(cmd, args, cwd, { onData, timeout } = {}) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', timer, timedOut = false, child;
    try { child = cp.spawn(cmd, args, { cwd }); } catch (error) { return resolve({ code: -1, error, stdout, stderr }); }
    child.stdout.on('data', d => { const s = d.toString(); stdout += s; onData && onData(s); });
    child.stderr.on('data', d => { const s = d.toString(); stderr += s; onData && onData(s); });
    child.on('error', error => { clearTimeout(timer); resolve({ code: -1, error, stdout, stderr }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
    if (timeout) timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout * 1000);
  });
}

function toolMissing(r, name) {
  if (r.error && r.error.code === 'ENOENT') {
    vscode.window.showErrorMessage(`« ${name} » est introuvable. ${INSTALL_HINT} (ou règle venturi.${name}.path).`);
    return true;
  }
  return false;
}

/** Choisit le module à simuler : réglage > testbench trouvé > top. */
async function pickSimTop(p, tbFiles, rtlFiles) {
  const forced = cfg().get('simTop', '');
  if (forced) return forced;
  const mods = async files => {
    const names = [];
    for (const f of files) {
      const t = await fs.promises.readFile(f, 'utf8').catch(() => '');
      for (const m of t.matchAll(/^\s*module\s+(\w+)/gm)) names.push(m[1]);
    }
    return names;
  };
  const tbMods = await mods(tbFiles);
  const top = p.top;
  for (const c of [top && `tb_${top}`, top && `${top}_tb`, 'tb', 'testbench']) if (c && tbMods.includes(c)) return c;
  if (tbMods.length) return tbMods[0];
  if (top && (await mods(rtlFiles)).includes(top)) return top;
  return null;
}

function publishDiagnostics(text, root) {
  diag.clear();
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(.+?):(\d+):\s*(?:(error|warning|sorry):\s*)?(.*)$/);
    if (!m) continue;
    const file = path.resolve(root, m[1]);
    if (!fs.existsSync(file)) continue;
    const ln = Math.max(0, +m[2] - 1);
    const sev = m[3] === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
    const d = new vscode.Diagnostic(new vscode.Range(ln, 0, ln, 1000), m[4] || line, sev);
    d.source = 'iverilog';
    const key = vscode.Uri.file(file).toString();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(d);
  }
  for (const [k, v] of map) diag.set(vscode.Uri.parse(k), v);
  return [...map.values()].reduce((n, v) => n + v.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length, 0);
}

/* ---------- Compilation ---------- */

/** @returns {Promise<{ok:boolean, vvp?:string, simTop?:string|null}>} */
async function compile(p, { quiet = false } = {}) {
  if (busy) {
    if (!quiet) vscode.window.setStatusBarMessage('$(sync~spin) Venturi : une compilation est déjà en cours…', 3000);
    return { ok: false };
  }
  busy = true;
  try {
    const c = cfg(), d = dirs(p.root);
    const rtl = await walk(d.rtl), tb = await walk(d.tb);
    const files = [...rtl, ...tb];
    if (!files.length) {
      if (!quiet) vscode.window.showWarningMessage('Aucun fichier .v dans rtl/ ou tb/. Sauvegarde le schéma pour générer le Verilog.');
      return { ok: false };
    }
    const simTop = await pickSimTop(p, tb, rtl);
    await fs.promises.mkdir(d.build, { recursive: true });
    const vvp = path.join(d.build, `${simTop || p.top || 'a'}.vvp`);
    const cmd = c.get('iverilog.path', 'iverilog');
    const args = [...c.get('iverilog.args', ['-g2012']), '-o', vvp, ...(simTop ? ['-s', simTop] : []), ...files.map(f => path.relative(p.root, f))];

    out.appendLine(`\n$ ${cmd} ${args.join(' ')}`);
    const r = await run(cmd, args, p.root);
    if (toolMissing(r, 'iverilog')) return { ok: false };
    const text = r.stderr + r.stdout;
    if (text.trim()) out.appendLine(text.trimEnd());
    const errors = publishDiagnostics(text, p.root);

    if (r.code === 0) {
      vscode.window.setStatusBarMessage('$(check) iverilog : compilation OK', 4000);
      return { ok: true, vvp, simTop };
    }
    vscode.window.setStatusBarMessage(`$(error) iverilog : ${errors || 'des'} erreur(s)`, 6000);
    if (!quiet) out.show(true);
    return { ok: false };
  } finally { busy = false; }
}

/* ---------- Simulation ---------- */

async function simulate(p) {
  const r = await compile(p);
  if (!r.ok) return;
  const c = cfg(), cmd = c.get('vvp.path', 'vvp');
  const args = [...c.get('vvp.args', []), path.relative(p.root, r.vvp)];
  out.show(true);
  out.appendLine(`\n$ ${cmd} ${args.join(' ')}`);
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `vvp ${r.simTop || ''}` }, async () => {
    const res = await run(cmd, args, p.root, { onData: s => out.append(s), timeout: c.get('simTimeoutSec', 60) });
    if (toolMissing(res, 'vvp')) return;
    if (res.timedOut) vscode.window.showWarningMessage(`Simulation interrompue après ${c.get('simTimeoutSec', 60)} s (il manque peut-être un $finish).`);
    else if (res.code !== 0) vscode.window.showErrorMessage('vvp a échoué : voir la sortie « Venturi ».');
    else vscode.window.setStatusBarMessage('$(check) Simulation terminée', 4000);
  });
}

/* ---------- GTKWave ---------- */

async function wave(p) {
  const { build } = dirs(p.root);
  let vcds = [];
  try {
    const names = (await fs.promises.readdir(build)).filter(n => /\.(vcd|fst|lxt2?)$/.test(n));
    vcds = await Promise.all(names.map(async n => ({ f: path.join(build, n), t: (await fs.promises.stat(path.join(build, n))).mtimeMs })));
  } catch { /* pas de dossier build */ }
  if (!vcds.length) {
    vscode.window.showWarningMessage('Aucun fichier d\'ondes dans build/. Lance une simulation dont le testbench contient $dumpfile / $dumpvars.');
    return;
  }
  vcds.sort((a, b) => b.t - a.t);
  const cmd = cfg().get('gtkwave.path', 'gtkwave');
  const child = cp.spawn(cmd, [vcds[0].f], { cwd: p.root, detached: true, stdio: 'ignore' });
  child.on('error', e => vscode.window.showErrorMessage(
    e.code === 'ENOENT' ? `« gtkwave » est introuvable. ${INSTALL_HINT}` : `GTKWave : ${e.message}`));
  child.unref();
}

module.exports = { compile, simulate, wave, diag, out };
