'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generate, testbench, validate, idOf } = require('./gen');
const { out } = require('./log');
const { emit, EVENT_TYPES } = require('./events');

const VIEW_TYPE = 'venturi.editor';
const FORMAT_VERSION = 1;
const cfg = () => vscode.workspace.getConfiguration('venturi');
const exists = p => fs.promises.access(p).then(() => true, () => false);

/* ---------- Modèle ---------- */

function parseModel(text) {
  try {
    const j = JSON.parse(text);
    if (j && Array.isArray(j.blocks) && Array.isArray(j.links)) {
      return { 
        version: j.version ?? FORMAT_VERSION, 
        topName: j.topName ?? 'top', 
        rstLow: j.rstLow !== false, 
        blocks: j.blocks,
        links: j.links,
        parameters: j.parameters ?? {},
        testbench: j.testbench ?? {}
      };
    }
  } catch { /* JSON invalide */ }
  return null;
}

const P = (name, dir, width, role = '', side = '') => ({ name, dir, width, role, side });
function defaultModel(name) {
  const reg = (inst, x) => ({
    inst, mod: 'reg8', kind: 'register', x, y: 120, color: '',
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
  emit(EVENT_TYPES.PROJECT_RESOLVED, { status: 'start' });
  
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
    emit(EVENT_TYPES.PROJECT_ERROR, { error: 'No schematic found' });
    return null;
  }
  let text;
  try { text = (await vscode.workspace.openTextDocument(uri)).getText(); } catch { lastUri = null; return null; }
  const m = parseModel(text);
  lastUri = uri;
  
  emit(EVENT_TYPES.PROJECT_RESOLVED, { 
    status: 'success', 
    uri: uri.toString(),
    top: m ? (idOf(m.topName) || 'top') : null
  });
  
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
 * Chaque fichier généré commence par « // venturi:<hash> ».
 * Si le hash correspond au contenu, le fichier n'a pas été modifié à la main → on peut le régénérer sans risque.
 * Sinon on le protège : on ne l'écrase que si l'utilisateur confirme (et une sauvegarde .bak est faite).
 */
const MARK = '// venturi:';
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const stamp = body => `${MARK}${sha(body)}\n${body}`;
function pristine(txt) {
  const i = txt.indexOf('\n');
  return txt.startsWith(MARK) && i > 0 && txt.slice(MARK.length, i) === sha(txt.slice(i + 1));
}
function portSig(txt) {
  const m = txt.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .match(/module\s+\w+\s*(?:#\s*\([\s\S]*?\)\s*)?\(([\s\S]*?)\)\s*;/);
  return m ? m[1].replace(/\b(reg|wire|logic)\b/g, '').replace(/\s+/g, '').trim() : null;
}

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

/**
 * Génère le Verilog depuis le texte JSON du schéma et l'écrit dans rtl/.
 * @returns {Promise<{dir:string, top:string, topFile:string, written:string[]}|null>}
 */
async function generateFor(p, { notify = false } = {}) {
  emit(EVENT_TYPES.GENERATION_START, { uri: p.uri.toString() });
  
  const model = parseModel(p.text);
  if (!model) { 
    emit(EVENT_TYPES.GENERATION_ERROR, { error: 'Invalid schema JSON' });
    vscode.window.showErrorMessage('Venturi : le schéma .venturi.json est invalide.'); 
    return null; 
  }
  
  if (!reportIssues(p, validate(model))) {
    emit(EVENT_TYPES.GENERATION_ERROR, { error: 'Validation failed' });
    return null;
  }
  
  let g;
  try { 
    g = generate(model); 
  } catch (e) {
    emit(EVENT_TYPES.GENERATION_ERROR, { error: e.message });
    vscode.window.showErrorMessage('Venturi : génération impossible (' + e.message + ').'); 
    return null; 
  }
  
  const { rtl } = dirs(p.root);
  await fs.promises.mkdir(rtl, { recursive: true });

  const written = [], conflicts = [];
  for (const [name, body] of Object.entries(g.files)) {
    const f = path.join(rtl, name), content = stamp(body);
    let old = null;
    try { old = await fs.promises.readFile(f, 'utf8'); } catch { /* absent */ }
    if (old === content) continue;
    if (old === null || pristine(old)) {
      await fs.promises.writeFile(f, content); written.push(name);
    } else if (name !== g.topFile && portSig(old) === portSig(content)) {
      continue; // code écrit à la main, ports inchangés : on n'y touche pas
    } else if (!declined.has(f + sha(content))) {
      conflicts.push({ name, f, content });
    }
  }

  if (conflicts.length) {
    const names = conflicts.map(c => c.name).join(', ');
    vscode.window.showWarningMessage(
      `Le schéma ne correspond plus à ${names} (modifié à la main). Régénérer ? Ton fichier sera copié en .bak.`,
      'Régénérer', 'Garder mon code'
    ).then(async choice => {
      for (const c of conflicts) {
        if (choice === 'Régénérer') {
          await fs.promises.copyFile(c.f, c.f + '.bak');
          await fs.promises.writeFile(c.f, c.content);
        } else declined.add(c.f + sha(c.content));
      }
    });
  }

  if (notify) {
    vscode.window.setStatusBarMessage(written.length
      ? `$(check) Venturi : ${written.join(', ')}`
      : '$(check) Venturi : Verilog déjà à jour', 4000);
  }
  
  emit(EVENT_TYPES.GENERATION_SUCCESS, { 
    dir: rtl, 
    top: g.top, 
    topFile: g.topFile, 
    written 
  });
  
  return { dir: rtl, top: g.top, topFile: g.topFile, written };
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
  if (!(await exists(file))) {
    await fs.promises.mkdir(tb, { recursive: true });
    await fs.promises.writeFile(file, testbench(model));
  }
  await openFile(file);
}

async function newSchematic(arg) {
  const wf = (arg instanceof vscode.Uri && vscode.workspace.getWorkspaceFolder(arg)) || (vscode.workspace.workspaceFolders || [])[0];
  if (!wf) { vscode.window.showErrorMessage('Ouvre d\'abord un dossier (code . depuis WSL).'); return; }
  const name = await vscode.window.showInputBox({ 
    prompt: 'Nom du module top', 
    value: 'chain', 
    validateInput: v => /^\w+$/.test(v) ? null : 'Lettres, chiffres et _ uniquement' 
  });
  if (!name) return;
  const dir = path.join(wf.uri.fsPath, 'schema'), file = path.join(dir, `${name}.venturi.json`);
  if (await exists(file)) { 
    vscode.window.showWarningMessage('Ce schéma existe déjà.'); 
    return openSchematic(file); 
  }
  await fs.promises.mkdir(dir, { recursive: true });
  const text = JSON.stringify(defaultModel(name), null, 1);
  await fs.promises.writeFile(file, text);
  await generateFor({ uri: vscode.Uri.file(file), root: wf.uri.fsPath, text });
  await openSchematic(file);
}

const openSchematic = file => vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), VIEW_TYPE);

module.exports = {
  VIEW_TYPE, cfg, exists, dirs, parseModel, resolveProject, rootOf, setLastUri,
  generateFor, openVerilog, openFile, createTestbench, newSchematic
};
