'use strict';
const vscode = require('vscode');
const path = require('path');
const P = require('./project');
const S = require('./sim');
const { VenturiEditorProvider } = require('./editor');

/** Exécute une action sur le schéma `arg` (ou le schéma courant). */
async function runFor(cmd, arg, msg = {}) {
  const p = await P.resolveProject(arg);
  if (!p) return;
  switch (cmd) {
    case 'generate': await P.generateFor(p, { notify: true }); break;
    case 'compile': await P.generateFor(p); await S.compile(p); break;
    case 'simulate': await P.generateFor(p); await S.simulate(p); break;
    case 'simulateWave': await P.generateFor(p); await S.simulate(p, { wave: true }); break;
    case 'wave': await S.wave(p); break;
    case 'testbench': await P.createTestbench(p); break;
    case 'openTop': {
      const g = await P.generateFor(p);
      if (g) await P.openFile(path.join(g.dir, g.topFile));
      break;
    }
    case 'openModule': if (msg.mod) await P.openVerilog(p, msg.mod); break;
    // actions du panneau « État du Verilog » (une ligne = un fichier)
    case 'openFile': if (msg.file) await P.openFile(path.join(P.dirs(p.root).rtl, msg.file)); break;
    case 'diff': if (msg.file) await P.diffFile(p, msg.file); break;
    case 'update': if (msg.file) await P.generateFor(p, { notify: true, only: [msg.file] }); break;
    case 'archive': if (msg.file) await P.archiveFile(p, msg.file); break;
  }
}

/** Sauvegarde d'un fichier : régénère le Verilog (schéma) et/ou recompile (.v). */
async function onSave(doc) {
  const c = P.cfg();
  if (doc.fileName.endsWith('.venturi.json')) {
    if (P.genMode(c) !== 'save') return;
    const p = await P.resolveProject(doc.uri, true);
    if (!p) return;
    const g = await P.generateFor(p, { notify: true });
    if (g && c.get('compileOnSave', true)) await S.compile(p, { quiet: true });
  } else if (/\.s?v$/.test(doc.fileName) && c.get('compileOnSave', true)) {
    const root = P.rootOf(doc.uri), d = P.dirs(root);
    const inside = dir => !path.relative(dir, doc.uri.fsPath).startsWith('..');
    if (!inside(d.rtl) && !inside(d.tb)) return;
    const p = (await P.resolveProject(undefined, true)) || { root, top: null };
    await S.compile(p, { quiet: true });
  }
}

function activate(context) {
  const hooks = {
    run: (cmd, uri, msg) => runFor(cmd, uri, msg),
    setActive: uri => P.setLastUri(uri),
    status: async uri => { const p = await P.resolveProject(uri, true); return p ? P.verilogStatus(p) : null; }
  };
  // Mode « change » : le Verilog suit l'éditeur sans enregistrer (avec délai). Jamais de fenêtre : les fichiers
  // modifiés à la main sont conservés et signalés dans la barre d'état.
  const timers = new Map();
  const onChange = e => {
    const d = e.document;
    if (!d.fileName.endsWith('.venturi.json') || !e.contentChanges.length || P.genMode() !== 'change') return;
    clearTimeout(timers.get(d.uri.toString()));
    timers.set(d.uri.toString(), setTimeout(async () => {
      const p = await P.resolveProject(d.uri, true);
      if (p) await P.generateFor(p, { auto: true });
    }, 800));
  };

  const cmd = (id, fn) => vscode.commands.registerCommand(id, fn);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('venturi.editor', new VenturiEditorProvider(context, hooks), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false
    }),
    cmd('venturi.new', P.newSchematic),
    cmd('venturi.generate', a => runFor('generate', a)),
    cmd('venturi.compile', a => runFor('compile', a)),
    cmd('venturi.simulate', a => runFor('simulate', a)),
    cmd('venturi.simulateWave', a => runFor('simulateWave', a)),
    cmd('venturi.wave', a => runFor('wave', a)),
    cmd('venturi.testbench', a => runFor('testbench', a)),
    cmd('venturi.viewJson', async a => {
      const u = a instanceof vscode.Uri ? a : (await P.resolveProject())?.uri;
      if (u) vscode.commands.executeCommand('vscode.openWith', u, 'default');
    }),
    vscode.workspace.onDidSaveTextDocument(d => onSave(d).catch(e => console.error('[venturi]', e))),
    vscode.workspace.onDidChangeTextDocument(e => onChange(e)),
    S.diag, S.out
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
