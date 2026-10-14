'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generate, testbench, validate, idOf } = require('./gen');
const { out } = require('./log');

const VIEW_TYPE = 'venturi.editor';
const FORMAT_VERSION = 1;
const cfg = () => vscode.workspace.getConfiguration('venturi');
const exists = p => fs.promises.access(p).then(() => true, () => false);

/* ---------- Modèle ---------- */

function parseModel(text) {
  try {
    const j = JSON.parse(text);
    if (j && Array.isArray(j.blocks) && Array.isArray(j.links)) {
      return { version: j.version ?? FORMAT_VERSION, topName: j.topName ?? 'top', rstLow: j.rstLow !== false, blocks: j.blocks, links: j.links };
    }
  } catch { /* JSON invalide */ }
  return null;
}

const P = (name, dir, width, role = '', side = '') => ({ name, dir, width, role, side });
function defaultModel(name) {
  const reg = (inst, x) => ({
    inst, mod: 'regn', kind: 'register', x, y: 120, color: '', compact: true,
    ports: [P('clk', 'in', 1, 'clk'), P('rst', 'in', 1, 'rst'), P('d', 'in', 8), P('q', 'out', 8)]
  });
  const io = (inst, kind, x) => ({ inst, mod: '', kind, x, y: 168, color: '', ports: [P('p', kind === 'in' ? 'out' : 'in', 8)] });
  return {
    version: FORMAT_VERSION, topName: name, rstLow: true,
    blocks: [io('din', 'in', 20), reg('r1', 160), reg('r2', 440), io('dout', 'out', 620)],
    links: [{ from: 'din.p', to: 'r1.d' }, { from: 'r1.q', to: 'r2.d' }, { from: 'r2.q', to: 'dout.p' }]
  };
}

/* ---------- Résolution du projet ---------- */

let lastUri = null;
const setLastUri = u => { lastUri = u; };

function activeSchematicUri() {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const inp = tab && tab.input;
  if (inp instanceof vscode.TabInputCustom && inp.viewType === VIEW_TYPE) return inp.uri;
  return null;
}

function rootOf(uri) {
  const wf = vscode.workspace.getWorkspaceFolder(uri);
  return wf ? wf.uri.fsPath : path.dirname(uri.fsPath);
}

/**
 * Trouve le schéma courant : argument > onglet actif > dernier utilisé > recherche dans l'espace de travail.
 * @returns {Promise<{uri:vscode.Uri, root:string, top:string|null, text:string}|null>}
 */
async function resolveProject(arg, silent = false) {
  let uri = (arg instanceof vscode.Uri && arg.fsPath.endsWith('.venturi.json')) ? arg : (activeSchematicUri() || lastUri);
  if (!uri) {
    const found = await vscode.workspace.findFiles('**/*.venturi.json', '**/node_modules/**', 20);
    if (found.length === 1) uri = found[0];
    else if (found.length > 1 && !silent) {
      const pick = await vscode.window.showQuickPick(
        found.map(u => ({ label: vscode.workspace.asRelativePath(u), u })), { placeHolder: 'Quel schéma ?' });
      uri = pick && pick.u;
    }
  }
  if (!uri) {
    if (!silent) vscode.window.showWarningMessage('Aucun schéma .venturi.json trouvé. Utilise « Venturi : Nouveau schéma ».');
    return null;
  }
  let text;
  try { text = (await vscode.workspace.openTextDocument(uri)).getText(); } catch { lastUri = null; return null; }
  const m = parseModel(text);
  lastUri = uri;
  return { uri, root: rootOf(uri), top: m ? (idOf(m.topName) || 'top') : null, text };
}

const dirs = root => {
  const c = cfg();
  return {
    rtl: path.join(root, c.get('rtlDir', 'rtl')),
    tb: path.join(root, c.get('tbDir', 'tb')),
    build: path.join(root, c.get('buildDir', 'build'))
  };
};

/* ---------- Écriture protégée des fichiers générés ----------
 * Voir protect.js : on n'écrase jamais un fichier modifié à la main sans confirmation modale,
 * et la version de l'utilisateur est toujours sauvegardée dans un .bak horodaté.
 */
const { MARK, sha, stamp, pristine, portSig, syncHeader, classify, fileState, isVenturiFile, backupPath } = require('./protect');

const declined = new Set();
let lastIssues = '';

/**
 * Journalise les problèmes du schéma et prévient l'utilisateur (une seule fois par jeu de problèmes).
 * @returns {boolean} false si au moins une erreur empêche la génération
 */
function reportIssues(p, issues) {
  const errors = issues.filter(i => i.level === 'error'), warnings = issues.filter(i => i.level === 'warning');
  const sig = issues.map(i => i.level + i.msg).join('\n');
  if (!issues.length) { lastIssues = ''; return true; }
  if (sig !== lastIssues) {
    lastIssues = sig;
    out.appendLine(`\n[schéma ${vscode.workspace.asRelativePath(p.uri)}]`);
    issues.forEach(i => out.appendLine(`  ${i.level === 'error' ? 'ERREUR' : 'avertissement'} : ${i.msg}`));
    const first = (errors[0] || warnings[0]).msg;
    const more = issues.length > 1 ? ` (+${issues.length - 1})` : '';
    const show = m => m.then(c => c && out.show(true));
    if (errors.length) show(vscode.window.showErrorMessage(`Venturi : génération bloquée. ${first}${more}`, 'Détails'));
    else show(vscode.window.showWarningMessage(`Venturi : ${first}${more}`, 'Détails'));
  }
  return !errors.length;
}

let asking = false;

/** Ouvre, pour chaque fichier, les différences entre ta version et la version générée (sans rien modifier). */
async function showDiffs(conflicts) {
  const dir = path.join(os.tmpdir(), 'venturi-diff');
  await fs.promises.mkdir(dir, { recursive: true });
  for (const c of conflicts) {
    const tmp = path.join(dir, c.name);
    await fs.promises.writeFile(tmp, c.content);
    await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(c.f), vscode.Uri.file(tmp), `${c.name} : ton fichier ↔ généré`);
  }
}

/**
 * Demande confirmation (fenêtre modale) avant d'écraser des fichiers modifiés à la main.
 * Écraser = copie horodatée .bak de ta version, puis écriture. Garder ou fermer = rien n'est touché.
 * @returns {Promise<{written:string[], kept:string[]}>} fichiers modifiés / fichiers laissés tels quels
 */
async function resolveConflicts(conflicts, rtl) {
  if (asking) return { written: [], kept: conflicts.map(c => c.name) };
  asking = true;
  try {
    const n = conflicts.length, dir = vscode.workspace.asRelativePath(rtl);
    const detail = conflicts.map(c => `• ${c.name} — ${c.modified ? 'modifié à la main' : 'sera mis à jour'}`).join('\n')
      + '\n\nÉcraser : ta version est d\'abord copiée dans un fichier .bak horodaté (rien n\'est perdu).'
      + '\nPorts seulement : met à jour l\'en-tête du module (paramètres et ports, donc les tailles) et garde TON code ; sauvegarde .bak aussi.'
      + '\nComparer : ouvre les différences, sans rien modifier.'
      + '\nGarder mon code : les fichiers restent tels quels (Venturi te le signale à chaque génération).';
    const OK = 'Écraser (avec sauvegarde)', HDR = 'Ports seulement (garder mon code)', CMP = 'Comparer', KEEP = 'Garder mon code';
    const choice = await vscode.window.showWarningMessage(
      `Venturi va modifier ${n} fichier${n > 1 ? 's' : ''} dans ${dir}/`, { modal: true, detail }, OK, HDR, CMP, KEEP);
    const names = conflicts.map(c => c.name);
    if (choice === CMP) {
      await showDiffs(conflicts);
      vscode.window.setStatusBarMessage('Venturi : différences ouvertes, rien n\'a été modifié', 6000);
      return { written: [], kept: names };
    }
    if (choice !== OK && choice !== HDR) { conflicts.forEach(c => declined.add(c.f + sha(c.content))); return { written: [], kept: names }; }
    const written = [], kept = [];
    for (const c of conflicts) {
      // « Ports seulement » ne s'applique pas au module top (c'est un câblage généré, pas de la logique à toi)
      const text = choice === HDR ? (c.isTop ? null : syncHeader(c.old, c.content)) : c.content;
      if (text === null) { kept.push(c.name); continue; }
      let bak = backupPath(c.f), i = 2;
      while (await exists(bak)) bak = backupPath(c.f).replace(/\.bak$/, `-${i++}.bak`);
      await fs.promises.copyFile(c.f, bak);
      await fs.promises.writeFile(c.f, text);
      written.push(c.name);
    }
    return { written, kept };
  } finally { asking = false; }
}

/**
 * Génère le Verilog depuis le texte JSON du schéma et l'écrit dans rtl/.
 * @returns {Promise<{dir:string, top:string, topFile:string, written:string[]}|null>}
 */
async function generateFor(p, { notify = false, auto = false, only = null } = {}) {
  const model = parseModel(p.text);
  if (!model) { vscode.window.showErrorMessage('Venturi : le schéma .venturi.json est invalide.'); return null; }
  if (!reportIssues(p, validate(model))) return null;
  let g;
  try { g = generate(model); } catch (e) {
    vscode.window.showErrorMessage('Venturi : génération impossible (' + e.message + ').'); return null;
  }
  const { rtl } = dirs(p.root);
  await fs.promises.mkdir(rtl, { recursive: true });

  const always = cfg().get('confirmOverwrite', 'modified') === 'always';
  const written = [], conflicts = [], kept = [];
  for (const [name, body] of Object.entries(g.files)) {
    if (only && !only.includes(name)) continue;
    const f = path.join(rtl, name), content = stamp(body);
    let old = null;
    try { old = await fs.promises.readFile(f, 'utf8'); } catch { /* absent */ }
    const isTop = name === g.topFile, { action, modified } = classify(old, content, { isTop, always });
    if (action === 'write') { await fs.promises.writeFile(f, content); written.push(name); }
    else if (action === 'keep') kept.push(name);                 // ton code, mêmes ports : intact
    else if (action === 'confirm') {
      // « Générer » (notify) repose la question même si tu as déjà répondu « garder » : pas de silence trompeur
      // génération automatique (à chaque modification) : jamais de fenêtre, on signale seulement
      if (auto || (declined.has(f + sha(content)) && !notify)) kept.push(name);
      else conflicts.push({ name, f, content, modified, old, isTop });
    }
  }
  if (conflicts.length) { const r = await resolveConflicts(conflicts, rtl); written.push(...r.written); kept.push(...r.kept); }

  // Message exact : on ne dit « à jour » que si rien n'a été laissé de côté.
  if (kept.length || notify) {
    const parts = [];
    if (written.length) parts.push(`écrit : ${written.join(', ')}`);
    if (kept.length) parts.push(`conservé tel quel (non régénéré) : ${kept.join(', ')}`);
    if (!parts.length) parts.push('Verilog déjà à jour');
    vscode.window.setStatusBarMessage(`${kept.length ? '$(warning)' : '$(check)'} Venturi : ${parts.join(' — ')}`, kept.length ? 9000 : 4000);
  }
  return { dir: rtl, top: g.top, topFile: g.topFile, written, kept };
}

/* ---------- Ouverture / testbench ---------- */

async function openFile(file, beside = true) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc, { viewColumn: beside ? vscode.ViewColumn.Beside : undefined, preview: true });
}

async function openVerilog(p, modName) {
  let file = path.join(dirs(p.root).rtl, `${idOf(modName)}.v`);
  if (!(await exists(file))) {
    await generateFor(p);
    if (!(await exists(file))) { vscode.window.showWarningMessage(`Venturi : ${path.basename(file)} introuvable.`); return; }
  }
  await openFile(file);
}

async function createTestbench(p) {
  const model = parseModel(p.text);
  if (!model) { vscode.window.showErrorMessage('Venturi : schéma invalide.'); return; }
  const top = idOf(model.topName) || 'top';
  const { tb } = dirs(p.root), file = path.join(tb, `tb_${top}.v`);
  if (await exists(file)) {
    vscode.window.setStatusBarMessage(`Venturi : ${path.basename(file)} existe déjà, ouvert sans modification`, 5000);
  } else {
    await fs.promises.mkdir(tb, { recursive: true });
    await fs.promises.writeFile(file, testbench(model));
    vscode.window.setStatusBarMessage(`$(check) Venturi : ${path.basename(file)} créé dans ${path.basename(tb)}/`, 5000);
  }
  await openFile(file);
}

async function newSchematic(arg) {
  const wf = (arg instanceof vscode.Uri && vscode.workspace.getWorkspaceFolder(arg)) || (vscode.workspace.workspaceFolders || [])[0];
  if (!wf) { vscode.window.showErrorMessage('Ouvre d\'abord un dossier (code . depuis WSL).'); return; }
  const name = await vscode.window.showInputBox({ prompt: 'Nom du module top', value: 'chain', validateInput: v => /^\w+$/.test(v) ? null : 'Lettres, chiffres et _ uniquement' });
  if (!name) return;
  const dir = path.join(wf.uri.fsPath, 'schema'), file = path.join(dir, `${name}.venturi.json`);
  if (await exists(file)) { vscode.window.showWarningMessage('Ce schéma existe déjà.'); return openSchematic(file); }
  await fs.promises.mkdir(dir, { recursive: true });
  const text = JSON.stringify(defaultModel(name), null, 1);
  await fs.promises.writeFile(file, text);
  await generateFor({ uri: vscode.Uri.file(file), root: wf.uri.fsPath, text });
  await openSchematic(file);
}

const openSchematic = file => vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), VIEW_TYPE);

/** Mode de génération : `generateOn` (save | change | manual), sinon l'ancien réglage `generateOnSave`. */
function genMode(c = cfg()) {
  const i = c.inspect ? c.inspect('generateOn') : null;
  const set = i && (i.workspaceFolderValue ?? i.workspaceValue ?? i.globalValue);
  return set || (c.get('generateOnSave', true) ? 'save' : 'manual');
}

/**
 * État de chaque fichier Verilog du schéma (panneau « État du Verilog ») + fichiers orphelins :
 * générés par Venturi autrefois (ex. reg16.v) mais qui ne sont plus dans le schéma.
 * @returns {Promise<{dir:string, rows:{name:string, state:string, isTop:boolean}[]}|null>}
 */
async function verilogStatus(p) {
  const model = parseModel(p.text);
  if (!model || validate(model).some(i => i.level === 'error')) return { dir: dirs(p.root).rtl, rows: [], error: 'Schéma invalide : corrige les erreurs pour voir l\'état du Verilog.' };
  const g = generate(model), { rtl } = dirs(p.root), rows = [];
  const read = async f => { try { return await fs.promises.readFile(f, 'utf8'); } catch { return null; } };
  for (const [name, body] of Object.entries(g.files)) {
    const isTop = name === g.topFile;
    rows.push({ name, isTop, state: fileState(await read(path.join(rtl, name)), stamp(body), isTop) });
  }
  let present = [];
  try { present = (await fs.promises.readdir(rtl)).filter(n => /\.s?v$/.test(n)); } catch { /* dossier absent */ }
  for (const n of present.sort()) {
    if (g.files[n]) continue;
    if (isVenturiFile(await read(path.join(rtl, n)))) rows.push({ name: n, isTop: false, state: 'orphan' });
  }
  rows.sort((a, b) => (b.isTop - a.isTop) || a.name.localeCompare(b.name));
  return { dir: rtl, rows };
}

/** Ouvre le diff entre le fichier existant et la version générée. */
async function diffFile(p, name) {
  const model = parseModel(p.text); if (!model) return;
  const g = generate(model), { rtl } = dirs(p.root), f = path.join(rtl, name);
  if (!g.files[name] || !(await exists(f))) { await openFile(f); return; }
  await showDiffs([{ name, f, content: stamp(g.files[name]) }]);
}

/** Archive un fichier orphelin : il est renommé en .bak horodaté (jamais supprimé), après confirmation. */
async function archiveFile(p, name) {
  const f = path.join(dirs(p.root).rtl, name);
  if (!(await exists(f))) return false;
  const OK = 'Archiver en .bak';
  const choice = await vscode.window.showWarningMessage(`Archiver ${name} ?`,
    { modal: true, detail: `${name} n'est plus dans le schéma. Il sera renommé en .bak horodaté (rien n'est supprimé).` }, OK);
  if (choice !== OK) return false;
  let bak = backupPath(f), i = 2;
  while (await exists(bak)) bak = backupPath(f).replace(/\.bak$/, `-${i++}.bak`);
  await fs.promises.rename(f, bak);
  return true;
}

module.exports = {
  genMode, verilogStatus, diffFile, archiveFile,
  VIEW_TYPE, cfg, exists, dirs, parseModel, resolveProject, rootOf, setLastUri,
  generateFor, openVerilog, openFile, createTestbench, newSchematic
};
