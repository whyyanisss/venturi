'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const { cfg, dirs } = require('./project');
const { emit, EVENT_TYPES } = require('./events');

const { out } = require('./log');
const diag = vscode.languages.createDiagnosticCollection('iverilog');
let busy = false;

const CACHE_FILE = '.venturi_cache.json';
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

/**
 * Calcule un hash pour une liste de fichiers.
 * @param {string[]} files - Liste des chemins de fichiers.
 * @returns {Promise<string>} Hash SHA-1 des contenus concaténés.
 */
async function computeFilesHash(files) {
  const contents = await Promise.all(
    files.map(f => fs.promises.readFile(f, 'utf8').catch(() => ''))
  );
  return crypto.createHash('sha1').update(contents.join('')).digest('hex').slice(0, 16);
}

/**
 * Charge le cache de compilation depuis le dossier build.
 * @param {string} buildDir - Chemin du dossier build.
 * @returns {Promise<{hash: string, simTop: string, vvp: string}|null>}
 */
async function loadCache(buildDir) {
  const cachePath = path.join(buildDir, CACHE_FILE);
  try {
    const cache = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
    return { hash: cache.hash, simTop: cache.simTop, vvp: cache.vvp };
  } catch {
    return null;
  }
}

/**
 * Sauvegarde le cache de compilation.
 * @param {string} buildDir - Chemin du dossier build.
 * @param {string} hash - Hash des fichiers.
 * @param {string} simTop - Module top simulé.
 * @param {string} vvp - Chemin du fichier .vvp.
 */
async function saveCache(buildDir, hash, simTop, vvp) {
  const cachePath = path.join(buildDir, CACHE_FILE);
  await fs.promises.mkdir(buildDir, { recursive: true });
  await fs.promises.writeFile(cachePath, JSON.stringify({ hash, simTop, vvp }));
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
    vscode.window.showErrorMessage(`\u00ab ${name} \u00bb est introuvable. ${INSTALL_HINT} (ou règle venturi.${name}.path).`);
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
async function compile(p, { quiet = false, force = false } = {}) {
  if (busy) {
    if (!quiet) vscode.window.setStatusBarMessage('$(sync~spin) Venturi : une compilation est déjà en cours…', 3000);
    emit(EVENT_TYPES.COMPILATION_ERROR, { error: 'Compilation already in progress' });
    return { ok: false };
  }
  busy = true;
  emit(EVENT_TYPES.COMPILATION_START, { root: p.root });
  
  try {
    const c = cfg(), d = dirs(p.root);
    const rtl = await walk(d.rtl), tb = await walk(d.tb);
    const files = [...rtl, ...tb];
    if (!files.length) {
      if (!quiet) vscode.window.showWarningMessage('Aucun fichier .v dans rtl/ ou tb/. Sauvegarde le schéma pour générer le Verilog.');
      emit(EVENT_TYPES.COMPILATION_ERROR, { error: 'No Verilog files found' });
      return { ok: false };
    }
    const simTop = await pickSimTop(p, tb, rtl);
    await fs.promises.mkdir(d.build, { recursive: true });
    const vvp = path.join(d.build, `${simTop || p.top || 'a'}.vvp`);
    const args = [...c.get('iverilog.args', ['-g2012']), '-o', vvp, ...(simTop ? ['-s', simTop] : []), ...files.map(f => path.relative(p.root, f))];

    // Vérifier le cache de compilation
    if (!force) {
      const currentHash = await computeFilesHash(files);
      const cached = await loadCache(d.build);
      if (cached && cached.hash === currentHash && fs.existsSync(cached.vvp)) {
        if (!quiet) vscode.window.setStatusBarMessage('$(check) iverilog : déjà à jour', 2000);
        emit(EVENT_TYPES.COMPILATION_SUCCESS, { vvp: cached.vvp, simTop: cached.simTop });
        return { ok: true, vvp: cached.vvp, simTop: cached.simTop };
      }
    }

    const cmd = c.get('iverilog.path', 'iverilog');
    out.appendLine(`\n$ ${cmd} ${args.join(' ')}`);
    const r = await run(cmd, args, p.root);
    if (toolMissing(r, 'iverilog')) {
      emit(EVENT_TYPES.COMPILATION_ERROR, { error: 'iverilog not found' });
      return { ok: false };
    }
    const text = r.stderr + r.stdout;
    if (text.trim()) out.appendLine(text.trimEnd());
    const errors = publishDiagnostics(text, p.root);

    if (r.code === 0) {
      // Sauvegarder le cache
      const currentHash = await computeFilesHash(files);
      await saveCache(d.build, currentHash, simTop, vvp);
      vscode.window.setStatusBarMessage('$(check) iverilog : compilation OK', 4000);
      emit(EVENT_TYPES.COMPILATION_SUCCESS, { vvp, simTop });
      return { ok: true, vvp, simTop };
    }
    vscode.window.setStatusBarMessage(`$(error) iverilog : ${errors || 'des'} erreur(s)`, 6000);
    emit(EVENT_TYPES.COMPILATION_ERROR, { errors, text });
    if (!quiet) out.show(true);
    return { ok: false };
  } finally { 
    busy = false; 
    emit(EVENT_TYPES.COMPILATION_ERROR, { status: 'finished' });
  }
}

/* ---------- Simulation ---------- */

async function simulate(p) {
  emit(EVENT_TYPES.SIMULATION_START, { root: p.root });
  const r = await compile(p, { force: true });
  if (!r.ok) {
    emit(EVENT_TYPES.SIMULATION_ERROR, { error: 'Compilation failed' });
    return;
  }
  const c = cfg(), cmd = c.get('vvp.path', 'vvp');
  const args = [...c.get('vvp.args', []), path.relative(p.root, r.vvp)];
  out.show(true);
  out.appendLine(`\n$ ${cmd} ${args.join(' ')}`);
  
  const timeout = c.get('simTimeoutSec', 60);
  await vscode.window.withProgress({ 
    location: vscode.ProgressLocation.Window, 
    title: `vvp ${r.simTop || ''}`,
    cancellable: true 
  }, async (progress, token) => {
    const controller = new AbortController();
    
    // Annuler si l'utilisateur clique sur "Annuler"
    token.onCancellationRequested(() => {
      controller.abort();
    });
    
    const res = await run(cmd, args, p.root, { 
      onData: s => out.append(s), 
      timeout: timeout 
    });
    
    if (token.isCancellationRequested) {
      vscode.window.showWarningMessage('Simulation annulée par l\'utilisateur.');
      emit(EVENT_TYPES.SIMULATION_ERROR, { error: 'User cancelled' });
      return;
    }
    
    if (toolMissing(res, 'vvp')) {
      emit(EVENT_TYPES.SIMULATION_ERROR, { error: 'vvp not found' });
      return;
    }
    if (res.timedOut) {
      vscode.window.showWarningMessage(
        `Simulation interrompue après ${timeout} secondes. ` +
        `Augmentez "venturi.simTimeoutSec" dans les paramètres ou ajoutez un $finish dans votre testbench.`
      );
      emit(EVENT_TYPES.SIMULATION_ERROR, { error: 'Timeout' });
    } else if (res.code !== 0) {
      vscode.window.showErrorMessage('vvp a échoué : voir la sortie « Venturi ».');
      emit(EVENT_TYPES.SIMULATION_ERROR, { error: 'vvp failed', code: res.code });
    } else {
      vscode.window.setStatusBarMessage('$(check) Simulation terminée', 4000);
      emit(EVENT_TYPES.SIMULATION_SUCCESS, { simTop: r.simTop });
    }
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
    e.code === 'ENOENT' ? `\u00ab gtkwave \u00bb est introuvable. ${INSTALL_HINT}` : `GTKWave : ${e.message}`));
  child.unref();
}

module.exports = { compile, simulate, wave, diag, out };
