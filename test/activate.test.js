'use strict';
// Test de fumée : charge l'extension avec un faux module « vscode » et vérifie que activate()
// enregistre l'éditeur, toutes les commandes déclarées dans package.json et les hooks de sauvegarde.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const pkg = require('../package.json');

function fakeVscode() {
  const commands = new Map();
  const channel = { appendLine() {}, append() {}, show() {}, dispose() {} };
  const disposable = { dispose() {} };
  const state = { editors: [], saves: 0 };
  class Uri { static file(f) { return { fsPath: f, toString: () => 'file://' + f }; } static joinPath(...a) { return a[0]; } }
  return {
    state, commands,
    api: {
      Uri,
      ViewColumn: { Beside: -2 },
      DiagnosticSeverity: { Error: 0, Warning: 1 },
      ProgressLocation: { Window: 10 },
      Range: class {}, Diagnostic: class {}, WorkspaceEdit: class {},
      TabInputCustom: class {},
      window: {
        createOutputChannel: () => channel,
        registerCustomEditorProvider: (type) => { state.editors.push(type); return disposable; },
        tabGroups: { activeTabGroup: {} },
        showErrorMessage: () => Promise.resolve(), showWarningMessage: () => Promise.resolve(),
        setStatusBarMessage() {}
      },
      languages: { createDiagnosticCollection: () => ({ clear() {}, set() {}, dispose() {} }) },
      workspace: {
        getConfiguration: () => ({ get: (_k, d) => d }),
        onDidSaveTextDocument: () => { state.saves++; return disposable; },
        onDidChangeTextDocument: () => disposable
      },
      commands: { registerCommand: (id) => { commands.set(id, true); return disposable; }, executeCommand() {} }
    }
  };
}

test('activate() enregistre éditeur, commandes et hook de sauvegarde', () => {
  const fake = fakeVscode();
  const load = Module._load;
  Module._load = function (request, ...rest) { return request === 'vscode' ? fake.api : load.call(this, request, ...rest); };
  try {
    const ext = require('../src/extension');
    ext.activate({ subscriptions: [], extensionUri: fake.api.Uri.file('/ext') });
  } finally { Module._load = load; }

  assert.deepEqual(fake.state.editors, ['venturi.editor']);
  assert.equal(fake.state.saves, 1);
  for (const c of pkg.contributes.commands) assert.ok(fake.commands.has(c.command), `commande non enregistrée : ${c.command}`);
});

test('chaque commande de package.json a un titre et une catégorie', () => {
  for (const c of pkg.contributes.commands) {
    assert.ok(c.title, c.command);
    assert.equal(c.category, 'Venturi');
  }
});
