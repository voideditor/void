"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const fs = __importStar(require("fs"));
const path_1 = require("path");
const vscode = __importStar(require("vscode"));
const memfs_1 = require("../memfs");
const utils_1 = require("../utils");
suite('vscode API - workspace', () => {
    let root;
    suiteSetup(function () {
        root = vscode.workspace.workspaceFolders[0].uri;
    });
    teardown(async function () {
        (0, utils_1.assertNoRpc)();
        await (0, utils_1.closeAllEditors)();
    });
    test('MarkdownString', function () {
        let md = new vscode.MarkdownString();
        assert_1.default.strictEqual(md.value, '');
        assert_1.default.strictEqual(md.isTrusted, undefined);
        md = new vscode.MarkdownString('**bold**');
        assert_1.default.strictEqual(md.value, '**bold**');
        md.appendText('**bold?**');
        assert_1.default.strictEqual(md.value, '**bold**\\*\\*bold?\\*\\*');
        md.appendMarkdown('**bold**');
        assert_1.default.strictEqual(md.value, '**bold**\\*\\*bold?\\*\\***bold**');
    });
    test('textDocuments', () => {
        assert_1.default.ok(Array.isArray(vscode.workspace.textDocuments));
        assert_1.default.throws(() => vscode.workspace.textDocuments = null);
    });
    test('rootPath', () => {
        assert_1.default.ok((0, utils_1.pathEquals)(vscode.workspace.rootPath, (0, path_1.join)(__dirname, '../../testWorkspace')));
        assert_1.default.throws(() => vscode.workspace.rootPath = 'farboo');
    });
    test('workspaceFile', () => {
        assert_1.default.ok(!vscode.workspace.workspaceFile);
    });
    test('workspaceFolders', () => {
        if (vscode.workspace.workspaceFolders) {
            assert_1.default.strictEqual(vscode.workspace.workspaceFolders.length, 1);
            assert_1.default.ok((0, utils_1.pathEquals)(vscode.workspace.workspaceFolders[0].uri.fsPath, (0, path_1.join)(__dirname, '../../testWorkspace')));
        }
    });
    test('getWorkspaceFolder', () => {
        const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file((0, path_1.join)(__dirname, '../../testWorkspace/far.js')));
        assert_1.default.ok(!!folder);
        if (folder) {
            assert_1.default.ok((0, utils_1.pathEquals)(folder.uri.fsPath, (0, path_1.join)(__dirname, '../../testWorkspace')));
        }
    });
    test('openTextDocument', async () => {
        const uri = await (0, utils_1.createRandomFile)();
        // not yet there
        const existing1 = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
        assert_1.default.strictEqual(existing1, undefined);
        // open and assert its there
        const doc = await vscode.workspace.openTextDocument(uri);
        assert_1.default.ok(doc);
        assert_1.default.strictEqual(doc.uri.toString(), uri.toString());
        const existing2 = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
        assert_1.default.strictEqual(existing2 === doc, true);
    });
    test('openTextDocument, illegal path', () => {
        return vscode.workspace.openTextDocument('funkydonky.txt').then(_doc => {
            throw new Error('missing error');
        }, _err => {
            // good!
        });
    });
    test('openTextDocument, untitled is dirty', async function () {
        return vscode.workspace.openTextDocument(vscode.workspace.workspaceFolders[0].uri.with({ scheme: 'untitled', path: path_1.posix.join(vscode.workspace.workspaceFolders[0].uri.path, 'newfile.txt') })).then(doc => {
            assert_1.default.strictEqual(doc.uri.scheme, 'untitled');
            assert_1.default.ok(doc.isDirty);
        });
    });
    test('openTextDocument, untitled with host', function () {
        const uri = vscode.Uri.parse('untitled://localhost/c%24/Users/jrieken/code/samples/foobar.txt');
        return vscode.workspace.openTextDocument(uri).then(doc => {
            assert_1.default.strictEqual(doc.uri.scheme, 'untitled');
        });
    });
    test('openTextDocument, untitled without path', function () {
        return vscode.workspace.openTextDocument().then(doc => {
            assert_1.default.strictEqual(doc.uri.scheme, 'untitled');
            assert_1.default.ok(doc.isDirty);
        });
    });
    test('openTextDocument, untitled without path but language ID', function () {
        return vscode.workspace.openTextDocument({ language: 'xml' }).then(doc => {
            assert_1.default.strictEqual(doc.uri.scheme, 'untitled');
            assert_1.default.strictEqual(doc.languageId, 'xml');
            assert_1.default.ok(doc.isDirty);
        });
    });
    test('openTextDocument, untitled without path but language ID and content', function () {
        return vscode.workspace.openTextDocument({ language: 'html', content: '<h1>Hello world!</h1>' }).then(doc => {
            assert_1.default.strictEqual(doc.uri.scheme, 'untitled');
            assert_1.default.strictEqual(doc.languageId, 'html');
            assert_1.default.ok(doc.isDirty);
            assert_1.default.strictEqual(doc.getText(), '<h1>Hello world!</h1>');
        });
    });
    test('openTextDocument, untitled closes on save', function () {
        const path = (0, path_1.join)(vscode.workspace.rootPath || '', './newfile.txt');
        return vscode.workspace.openTextDocument(vscode.Uri.parse('untitled:' + path)).then(doc => {
            assert_1.default.strictEqual(doc.uri.scheme, 'untitled');
            assert_1.default.ok(doc.isDirty);
            const closedDocuments = [];
            const d0 = vscode.workspace.onDidCloseTextDocument(e => closedDocuments.push(e));
            return vscode.window.showTextDocument(doc).then(() => {
                return doc.save().then((didSave) => {
                    assert_1.default.strictEqual(didSave, true, `FAILED to save${doc.uri.toString()}`);
                    const closed = closedDocuments.filter(close => close.uri.toString() === doc.uri.toString())[0];
                    assert_1.default.ok(closed);
                    assert_1.default.ok(closed === doc);
                    assert_1.default.ok(!doc.isDirty);
                    assert_1.default.ok(fs.existsSync(path));
                    d0.dispose();
                    fs.unlinkSync((0, path_1.join)(vscode.workspace.rootPath || '', './newfile.txt'));
                });
            });
        });
    });
    test('openTextDocument, uri scheme/auth/path', function () {
        const registration = vscode.workspace.registerTextDocumentContentProvider('sc', {
            provideTextDocumentContent() {
                return 'SC';
            }
        });
        return Promise.all([
            vscode.workspace.openTextDocument(vscode.Uri.parse('sc://auth')).then(doc => {
                assert_1.default.strictEqual(doc.uri.authority, 'auth');
                assert_1.default.strictEqual(doc.uri.path, '');
            }),
            vscode.workspace.openTextDocument(vscode.Uri.parse('sc:///path')).then(doc => {
                assert_1.default.strictEqual(doc.uri.authority, '');
                assert_1.default.strictEqual(doc.uri.path, '/path');
            }),
            vscode.workspace.openTextDocument(vscode.Uri.parse('sc://auth/path')).then(doc => {
                assert_1.default.strictEqual(doc.uri.authority, 'auth');
                assert_1.default.strictEqual(doc.uri.path, '/path');
            })
        ]).then(() => {
            registration.dispose();
        });
    });
    test('openTextDocument, actual casing first', async function () {
        const fs = new memfs_1.TestFS('this-fs', false);
        const reg = vscode.workspace.registerFileSystemProvider(fs.scheme, fs, { isCaseSensitive: fs.isCaseSensitive });
        const uriOne = vscode.Uri.parse('this-fs:/one');
        const uriTwo = vscode.Uri.parse('this-fs:/two');
        const uriONE = vscode.Uri.parse('this-fs:/ONE'); // same resource, different uri
        const uriTWO = vscode.Uri.parse('this-fs:/TWO');
        fs.writeFile(uriOne, Buffer.from('one'), { create: true, overwrite: true });
        fs.writeFile(uriTwo, Buffer.from('two'), { create: true, overwrite: true });
        // lower case (actual case) comes first
        const docOne = await vscode.workspace.openTextDocument(uriOne);
        assert_1.default.strictEqual(docOne.uri.toString(), uriOne.toString());
        const docONE = await vscode.workspace.openTextDocument(uriONE);
        assert_1.default.strictEqual(docONE === docOne, true);
        assert_1.default.strictEqual(docONE.uri.toString(), uriOne.toString());
        assert_1.default.strictEqual(docONE.uri.toString() !== uriONE.toString(), true); // yep
        // upper case (NOT the actual case) comes first
        const docTWO = await vscode.workspace.openTextDocument(uriTWO);
        assert_1.default.strictEqual(docTWO.uri.toString(), uriTWO.toString());
        const docTwo = await vscode.workspace.openTextDocument(uriTwo);
        assert_1.default.strictEqual(docTWO === docTwo, true);
        assert_1.default.strictEqual(docTwo.uri.toString(), uriTWO.toString());
        assert_1.default.strictEqual(docTwo.uri.toString() !== uriTwo.toString(), true); // yep
        reg.dispose();
    });
    test('eol, read', () => {
        const a = (0, utils_1.createRandomFile)('foo\nbar\nbar').then(file => {
            return vscode.workspace.openTextDocument(file).then(doc => {
                assert_1.default.strictEqual(doc.eol, vscode.EndOfLine.LF);
            });
        });
        const b = (0, utils_1.createRandomFile)('foo\nbar\nbar\r\nbaz').then(file => {
            return vscode.workspace.openTextDocument(file).then(doc => {
                assert_1.default.strictEqual(doc.eol, vscode.EndOfLine.LF);
            });
        });
        const c = (0, utils_1.createRandomFile)('foo\r\nbar\r\nbar').then(file => {
            return vscode.workspace.openTextDocument(file).then(doc => {
                assert_1.default.strictEqual(doc.eol, vscode.EndOfLine.CRLF);
            });
        });
        return Promise.all([a, b, c]);
    });
    test('eol, change via editor', () => {
        return (0, utils_1.createRandomFile)('foo\nbar\nbar').then(file => {
            return vscode.workspace.openTextDocument(file).then(doc => {
                assert_1.default.strictEqual(doc.eol, vscode.EndOfLine.LF);
                return vscode.window.showTextDocument(doc).then(editor => {
                    return editor.edit(builder => builder.setEndOfLine(vscode.EndOfLine.CRLF));
                }).then(value => {
                    assert_1.default.ok(value);
                    assert_1.default.ok(doc.isDirty);
                    assert_1.default.strictEqual(doc.eol, vscode.EndOfLine.CRLF);
                });
            });
        });
    });
    test('eol, change via applyEdit', () => {
        return (0, utils_1.createRandomFile)('foo\nbar\nbar').then(file => {
            return vscode.workspace.openTextDocument(file).then(doc => {
                assert_1.default.strictEqual(doc.eol, vscode.EndOfLine.LF);
                const edit = new vscode.WorkspaceEdit();
                edit.set(file, [vscode.TextEdit.setEndOfLine(vscode.EndOfLine.CRLF)]);
                return vscode.workspace.applyEdit(edit).then(value => {
                    assert_1.default.ok(value);
                    assert_1.default.ok(doc.isDirty);
                    assert_1.default.strictEqual(doc.eol, vscode.EndOfLine.CRLF);
                });
            });
        });
    });
    test('eol, change via onWillSave', async function () {
        let called = false;
        const sub = vscode.workspace.onWillSaveTextDocument(e => {
            called = true;
            e.waitUntil(Promise.resolve([vscode.TextEdit.setEndOfLine(vscode.EndOfLine.LF)]));
        });
        const file = await (0, utils_1.createRandomFile)('foo\r\nbar\r\nbar');
        const doc = await vscode.workspace.openTextDocument(file);
        assert_1.default.strictEqual(doc.eol, vscode.EndOfLine.CRLF);
        const edit = new vscode.WorkspaceEdit();
        edit.set(file, [vscode.TextEdit.insert(new vscode.Position(0, 0), '-changes-')]);
        const successEdit = await vscode.workspace.applyEdit(edit);
        assert_1.default.ok(successEdit);
        const successSave = await doc.save();
        assert_1.default.ok(successSave);
        assert_1.default.ok(called);
        assert_1.default.ok(!doc.isDirty);
        assert_1.default.strictEqual(doc.eol, vscode.EndOfLine.LF);
        sub.dispose();
    });
    test('events: onDidOpenTextDocument, onDidChangeTextDocument, onDidSaveTextDocument', async () => {
        const file = await (0, utils_1.createRandomFile)();
        const disposables = [];
        await (0, utils_1.revertAllDirty)(); // needed for a clean state for `onDidSaveTextDocument` (#102365)
        const onDidOpenTextDocument = new Set();
        const onDidChangeTextDocument = new Set();
        const onDidSaveTextDocument = new Set();
        disposables.push(vscode.workspace.onDidOpenTextDocument(e => {
            onDidOpenTextDocument.add(e);
        }));
        disposables.push(vscode.workspace.onDidChangeTextDocument(e => {
            onDidChangeTextDocument.add(e.document);
        }));
        disposables.push(vscode.workspace.onDidSaveTextDocument(e => {
            onDidSaveTextDocument.add(e);
        }));
        const doc = await vscode.workspace.openTextDocument(file);
        const editor = await vscode.window.showTextDocument(doc);
        await editor.edit((builder) => {
            builder.insert(new vscode.Position(0, 0), 'Hello World');
        });
        await doc.save();
        assert_1.default.ok(Array.from(onDidOpenTextDocument).find(e => e.uri.toString() === file.toString()), 'did Open: ' + file.toString());
        assert_1.default.ok(Array.from(onDidChangeTextDocument).find(e => e.uri.toString() === file.toString()), 'did Change: ' + file.toString());
        assert_1.default.ok(Array.from(onDidSaveTextDocument).find(e => e.uri.toString() === file.toString()), 'did Save: ' + file.toString());
        (0, utils_1.disposeAll)(disposables);
        return (0, utils_1.deleteFile)(file);
    });
    test('events: onDidSaveTextDocument fires even for non dirty file when saved', async () => {
        const file = await (0, utils_1.createRandomFile)();
        const disposables = [];
        await (0, utils_1.revertAllDirty)(); // needed for a clean state for `onDidSaveTextDocument` (#102365)
        const onDidSaveTextDocument = new Set();
        disposables.push(vscode.workspace.onDidSaveTextDocument(e => {
            onDidSaveTextDocument.add(e);
        }));
        const doc = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('workbench.action.files.save');
        assert_1.default.ok(onDidSaveTextDocument);
        assert_1.default.ok(Array.from(onDidSaveTextDocument).find(e => e.uri.toString() === file.toString()), 'did Save: ' + file.toString());
        (0, utils_1.disposeAll)(disposables);
        return (0, utils_1.deleteFile)(file);
    });
    test('openTextDocument, with selection', function () {
        return (0, utils_1.createRandomFile)('foo\nbar\nbar').then(file => {
            return vscode.workspace.openTextDocument(file).then(doc => {
                return vscode.window.showTextDocument(doc, { selection: new vscode.Range(new vscode.Position(1, 1), new vscode.Position(1, 2)) }).then(editor => {
                    assert_1.default.strictEqual(editor.selection.start.line, 1);
                    assert_1.default.strictEqual(editor.selection.start.character, 1);
                    assert_1.default.strictEqual(editor.selection.end.line, 1);
                    assert_1.default.strictEqual(editor.selection.end.character, 2);
                });
            });
        });
    });
    test('registerTextDocumentContentProvider, simple', function () {
        const registration = vscode.workspace.registerTextDocumentContentProvider('foo', {
            provideTextDocumentContent(uri) {
                return uri.toString();
            }
        });
        const uri = vscode.Uri.parse('foo://testing/virtual.js');
        return vscode.workspace.openTextDocument(uri).then(doc => {
            assert_1.default.strictEqual(doc.getText(), uri.toString());
            assert_1.default.strictEqual(doc.isDirty, false);
            assert_1.default.strictEqual(doc.uri.toString(), uri.toString());
            registration.dispose();
        });
    });
    test('registerTextDocumentContentProvider, constrains', function () {
        // built-in
        assert_1.default.throws(function () {
            vscode.workspace.registerTextDocumentContentProvider('untitled', { provideTextDocumentContent() { return null; } });
        });
        // built-in
        assert_1.default.throws(function () {
            vscode.workspace.registerTextDocumentContentProvider('file', { provideTextDocumentContent() { return null; } });
        });
        // missing scheme
        return vscode.workspace.openTextDocument(vscode.Uri.parse('notThere://foo/far/boo/bar')).then(() => {
            assert_1.default.ok(false, 'expected failure');
        }, _err => {
            // expected
        });
    });
    test('registerTextDocumentContentProvider, multiple', function () {
        // duplicate registration
        const registration1 = vscode.workspace.registerTextDocumentContentProvider('foo', {
            provideTextDocumentContent(uri) {
                if (uri.authority === 'foo') {
                    return '1';
                }
                return undefined;
            }
        });
        const registration2 = vscode.workspace.registerTextDocumentContentProvider('foo', {
            provideTextDocumentContent(uri) {
                if (uri.authority === 'bar') {
                    return '2';
                }
                return undefined;
            }
        });
        return Promise.all([
            vscode.workspace.openTextDocument(vscode.Uri.parse('foo://foo/bla')).then(doc => { assert_1.default.strictEqual(doc.getText(), '1'); }),
            vscode.workspace.openTextDocument(vscode.Uri.parse('foo://bar/bla')).then(doc => { assert_1.default.strictEqual(doc.getText(), '2'); })
        ]).then(() => {
            registration1.dispose();
            registration2.dispose();
        });
    });
    test('registerTextDocumentContentProvider, evil provider', function () {
        // duplicate registration
        const registration1 = vscode.workspace.registerTextDocumentContentProvider('foo', {
            provideTextDocumentContent(_uri) {
                return '1';
            }
        });
        const registration2 = vscode.workspace.registerTextDocumentContentProvider('foo', {
            provideTextDocumentContent(_uri) {
                throw new Error('fail');
            }
        });
        return vscode.workspace.openTextDocument(vscode.Uri.parse('foo://foo/bla')).then(doc => {
            assert_1.default.strictEqual(doc.getText(), '1');
            registration1.dispose();
            registration2.dispose();
        });
    });
    test('registerTextDocumentContentProvider, invalid text', function () {
        const registration = vscode.workspace.registerTextDocumentContentProvider('foo', {
            provideTextDocumentContent(_uri) {
                return 123;
            }
        });
        return vscode.workspace.openTextDocument(vscode.Uri.parse('foo://auth/path')).then(() => {
            assert_1.default.ok(false, 'expected failure');
        }, _err => {
            // expected
            registration.dispose();
        });
    });
    test('registerTextDocumentContentProvider, show virtual document', function () {
        const registration = vscode.workspace.registerTextDocumentContentProvider('foo', {
            provideTextDocumentContent(_uri) {
                return 'I am virtual';
            }
        });
        return vscode.workspace.openTextDocument(vscode.Uri.parse('foo://something/path')).then(doc => {
            return vscode.window.showTextDocument(doc).then(editor => {
                assert_1.default.ok(editor.document === doc);
                assert_1.default.strictEqual(editor.document.getText(), 'I am virtual');
                registration.dispose();
            });
        });
    });
    test('registerTextDocumentContentProvider, open/open document', function () {
        let callCount = 0;
        const registration = vscode.workspace.registerTextDocumentContentProvider('foo', {
            provideTextDocumentContent(_uri) {
                callCount += 1;
                return 'I am virtual';
            }
        });
        const uri = vscode.Uri.parse('foo://testing/path');
        return Promise.all([vscode.workspace.openTextDocument(uri), vscode.workspace.openTextDocument(uri)]).then(docs => {
            const [first, second] = docs;
            assert_1.default.ok(first === second);
            assert_1.default.ok(vscode.workspace.textDocuments.some(doc => doc.uri.toString() === uri.toString()));
            assert_1.default.strictEqual(callCount, 1);
            registration.dispose();
        });
    });
    test('registerTextDocumentContentProvider, empty doc', function () {
        const registration = vscode.workspace.registerTextDocumentContentProvider('foo', {
            provideTextDocumentContent(_uri) {
                return '';
            }
        });
        const uri = vscode.Uri.parse('foo:doc/empty');
        return vscode.workspace.openTextDocument(uri).then(doc => {
            assert_1.default.strictEqual(doc.getText(), '');
            assert_1.default.strictEqual(doc.uri.toString(), uri.toString());
            registration.dispose();
        });
    });
    test('registerTextDocumentContentProvider, change event', async function () {
        let callCount = 0;
        const emitter = new vscode.EventEmitter();
        const registration = vscode.workspace.registerTextDocumentContentProvider('foo', {
            onDidChange: emitter.event,
            provideTextDocumentContent(_uri) {
                return 'call' + (callCount++);
            }
        });
        const uri = vscode.Uri.parse('foo://testing/path3');
        const doc = await vscode.workspace.openTextDocument(uri);
        assert_1.default.strictEqual(callCount, 1);
        assert_1.default.strictEqual(doc.getText(), 'call0');
        return new Promise(resolve => {
            const subscription = vscode.workspace.onDidChangeTextDocument(event => {
                assert_1.default.ok(event.document === doc);
                assert_1.default.strictEqual(event.document.getText(), 'call1');
                subscription.dispose();
                registration.dispose();
                resolve();
            });
            emitter.fire(doc.uri);
        });
    });
    test('findFiles', () => {
        return vscode.workspace.findFiles('**/image.png').then((res) => {
            assert_1.default.strictEqual(res.length, 2);
            assert_1.default.strictEqual((0, path_1.basename)(vscode.workspace.asRelativePath(res[0])), 'image.png');
        });
    });
    test('findFiles - null exclude', async () => {
        await vscode.workspace.findFiles('**/file.txt').then((res) => {
            // search.exclude folder is still searched, files.exclude folder is not
            assert_1.default.strictEqual(res.length, 1);
            assert_1.default.strictEqual((0, path_1.basename)(vscode.workspace.asRelativePath(res[0])), 'file.txt');
        });
        await vscode.workspace.findFiles('**/file.txt', null).then((res) => {
            // search.exclude and files.exclude folders are both searched
            assert_1.default.strictEqual(res.length, 2);
            assert_1.default.strictEqual((0, path_1.basename)(vscode.workspace.asRelativePath(res[0])), 'file.txt');
        });
    });
    test('findFiles - exclude', () => {
        return vscode.workspace.findFiles('**/image.png').then((res) => {
            assert_1.default.strictEqual(res.length, 2);
            assert_1.default.strictEqual((0, path_1.basename)(vscode.workspace.asRelativePath(res[0])), 'image.png');
        });
    });
    test('findFiles, exclude', () => {
        return vscode.workspace.findFiles('**/image.png', '**/sub/**').then((res) => {
            assert_1.default.strictEqual(res.length, 1);
            assert_1.default.strictEqual((0, path_1.basename)(vscode.workspace.asRelativePath(res[0])), 'image.png');
        });
    });
    test('findFiles, cancellation', () => {
        const source = new vscode.CancellationTokenSource();
        const token = source.token; // just to get an instance first
        source.cancel();
        return vscode.workspace.findFiles('*.js', null, 100, token).then((res) => {
            assert_1.default.deepStrictEqual(res, []);
        });
    });
    test('`findFiles2`', () => {
        return vscode.workspace.findFiles2(['**/image.png']).then((res) => {
            assert_1.default.strictEqual(res.length, 2);
        });
    });
    test('findFiles2 - null exclude', async () => {
        await vscode.workspace.findFiles2(['**/file.txt'], { useExcludeSettings: vscode.ExcludeSettingOptions.FilesExclude }).then((res) => {
            // file.exclude folder is still searched, search.exclude folder is not
            assert_1.default.strictEqual(res.length, 1);
            assert_1.default.strictEqual((0, path_1.basename)(vscode.workspace.asRelativePath(res[0])), 'file.txt');
        });
        await vscode.workspace.findFiles2(['**/file.txt'], { useExcludeSettings: vscode.ExcludeSettingOptions.None }).then((res) => {
            // search.exclude and files.exclude folders are both searched
            assert_1.default.strictEqual(res.length, 2);
            assert_1.default.strictEqual((0, path_1.basename)(vscode.workspace.asRelativePath(res[0])), 'file.txt');
        });
    });
    test('findFiles2, exclude', () => {
        return vscode.workspace.findFiles2(['**/image.png'], { exclude: ['**/sub/**'] }).then((res) => {
            assert_1.default.strictEqual(res.length, 1);
        });
    });
    test('findFiles2, cancellation', () => {
        const source = new vscode.CancellationTokenSource();
        const token = source.token; // just to get an instance first
        source.cancel();
        return vscode.workspace.findFiles2(['*.js'], {}, token).then((res) => {
            assert_1.default.deepStrictEqual(res, []);
        });
    });
    test('findTextInFiles', async () => {
        const options = {
            include: '*.ts',
            previewOptions: {
                matchLines: 1,
                charsPerLine: 100
            }
        };
        const results = [];
        await vscode.workspace.findTextInFiles({ pattern: 'foo' }, options, result => {
            results.push(result);
        });
        assert_1.default.strictEqual(results.length, 1);
        const match = results[0];
        (0, assert_1.default)(match.preview.text.indexOf('foo') >= 0);
        assert_1.default.strictEqual((0, path_1.basename)(vscode.workspace.asRelativePath(match.uri)), '10linefile.ts');
    });
    test('findTextInFiles, cancellation', async () => {
        const results = [];
        const cancellation = new vscode.CancellationTokenSource();
        cancellation.cancel();
        await vscode.workspace.findTextInFiles({ pattern: 'foo' }, result => {
            results.push(result);
        }, cancellation.token);
    });
    test('applyEdit', async () => {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse('untitled:' + (0, path_1.join)(vscode.workspace.rootPath || '', './new2.txt')));
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), new Array(1000).join('Hello World'));
        const success = await vscode.workspace.applyEdit(edit);
        assert_1.default.strictEqual(success, true);
        assert_1.default.strictEqual(doc.isDirty, true);
    });
    test('applyEdit should fail when editing deleted resource', (0, utils_1.withLogDisabled)(async () => {
        const resource = await (0, utils_1.createRandomFile)();
        const edit = new vscode.WorkspaceEdit();
        edit.deleteFile(resource);
        edit.insert(resource, new vscode.Position(0, 0), '');
        const success = await vscode.workspace.applyEdit(edit);
        assert_1.default.strictEqual(success, false);
    }));
    test('applyEdit should fail when renaming deleted resource', (0, utils_1.withLogDisabled)(async () => {
        const resource = await (0, utils_1.createRandomFile)();
        const edit = new vscode.WorkspaceEdit();
        edit.deleteFile(resource);
        edit.renameFile(resource, resource);
        const success = await vscode.workspace.applyEdit(edit);
        assert_1.default.strictEqual(success, false);
    }));
    test('applyEdit should fail when editing renamed from resource', (0, utils_1.withLogDisabled)(async () => {
        const resource = await (0, utils_1.createRandomFile)();
        const newResource = vscode.Uri.file(resource.fsPath + '.1');
        const edit = new vscode.WorkspaceEdit();
        edit.renameFile(resource, newResource);
        edit.insert(resource, new vscode.Position(0, 0), '');
        const success = await vscode.workspace.applyEdit(edit);
        assert_1.default.strictEqual(success, false);
    }));
    test('applyEdit "edit A -> rename A to B -> edit B"', async () => {
        await testEditRenameEdit(oldUri => oldUri.with({ path: oldUri.path + 'NEW' }));
    });
    test('applyEdit "edit A -> rename A to B (different case)" -> edit B', async () => {
        await testEditRenameEdit(oldUri => oldUri.with({ path: oldUri.path.toUpperCase() }));
    });
    test('applyEdit "edit A -> rename A to B (same case)" -> edit B', async () => {
        await testEditRenameEdit(oldUri => oldUri);
    });
    async function testEditRenameEdit(newUriCreator) {
        const oldUri = await (0, utils_1.createRandomFile)();
        const newUri = newUriCreator(oldUri);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(oldUri, new vscode.Position(0, 0), 'BEFORE');
        edit.renameFile(oldUri, newUri);
        edit.insert(newUri, new vscode.Position(0, 0), 'AFTER');
        assert_1.default.ok(await vscode.workspace.applyEdit(edit));
        const doc = await vscode.workspace.openTextDocument(newUri);
        assert_1.default.strictEqual(doc.getText(), 'AFTERBEFORE');
        assert_1.default.strictEqual(doc.isDirty, true);
    }
    function nameWithUnderscore(uri) {
        return uri.with({ path: path_1.posix.join(path_1.posix.dirname(uri.path), `_${path_1.posix.basename(uri.path)}`) });
    }
    test('WorkspaceEdit: applying edits before and after rename duplicates resource #42633', (0, utils_1.withLogDisabled)(async function () {
        const docUri = await (0, utils_1.createRandomFile)();
        const newUri = nameWithUnderscore(docUri);
        const we = new vscode.WorkspaceEdit();
        we.insert(docUri, new vscode.Position(0, 0), 'Hello');
        we.insert(docUri, new vscode.Position(0, 0), 'Foo');
        we.renameFile(docUri, newUri);
        we.insert(newUri, new vscode.Position(0, 0), 'Bar');
        assert_1.default.ok(await vscode.workspace.applyEdit(we));
        const doc = await vscode.workspace.openTextDocument(newUri);
        assert_1.default.strictEqual(doc.getText(), 'BarHelloFoo');
    }));
    test('WorkspaceEdit: Problem recreating a renamed resource #42634', (0, utils_1.withLogDisabled)(async function () {
        const docUri = await (0, utils_1.createRandomFile)();
        const newUri = nameWithUnderscore(docUri);
        const we = new vscode.WorkspaceEdit();
        we.insert(docUri, new vscode.Position(0, 0), 'Hello');
        we.insert(docUri, new vscode.Position(0, 0), 'Foo');
        we.renameFile(docUri, newUri);
        we.createFile(docUri);
        we.insert(docUri, new vscode.Position(0, 0), 'Bar');
        assert_1.default.ok(await vscode.workspace.applyEdit(we));
        const newDoc = await vscode.workspace.openTextDocument(newUri);
        assert_1.default.strictEqual(newDoc.getText(), 'HelloFoo');
        const doc = await vscode.workspace.openTextDocument(docUri);
        assert_1.default.strictEqual(doc.getText(), 'Bar');
    }));
    test('WorkspaceEdit api - after saving a deleted file, it still shows up as deleted. #42667', (0, utils_1.withLogDisabled)(async function () {
        const docUri = await (0, utils_1.createRandomFile)();
        const we = new vscode.WorkspaceEdit();
        we.deleteFile(docUri);
        we.insert(docUri, new vscode.Position(0, 0), 'InsertText');
        assert_1.default.ok(!(await vscode.workspace.applyEdit(we)));
        try {
            await vscode.workspace.openTextDocument(docUri);
            assert_1.default.ok(false);
        }
        catch (e) {
            assert_1.default.ok(true);
        }
    }));
    test('WorkspaceEdit: edit and rename parent folder duplicates resource #42641', async function () {
        const dir = vscode.Uri.parse(`${utils_1.testFs.scheme}:/before-${(0, utils_1.rndName)()}`);
        await utils_1.testFs.createDirectory(dir);
        const docUri = await (0, utils_1.createRandomFile)('', dir);
        const docParent = docUri.with({ path: path_1.posix.dirname(docUri.path) });
        const newParent = nameWithUnderscore(docParent);
        const we = new vscode.WorkspaceEdit();
        we.insert(docUri, new vscode.Position(0, 0), 'Hello');
        we.renameFile(docParent, newParent);
        assert_1.default.ok(await vscode.workspace.applyEdit(we));
        try {
            await vscode.workspace.openTextDocument(docUri);
            assert_1.default.ok(false);
        }
        catch (e) {
            assert_1.default.ok(true);
        }
        const newUri = newParent.with({ path: path_1.posix.join(newParent.path, path_1.posix.basename(docUri.path)) });
        const doc = await vscode.workspace.openTextDocument(newUri);
        assert_1.default.ok(doc);
        assert_1.default.strictEqual(doc.getText(), 'Hello');
    });
    test('WorkspaceEdit: rename resource followed by edit does not work #42638', (0, utils_1.withLogDisabled)(async function () {
        const docUri = await (0, utils_1.createRandomFile)();
        const newUri = nameWithUnderscore(docUri);
        const we = new vscode.WorkspaceEdit();
        we.renameFile(docUri, newUri);
        we.insert(newUri, new vscode.Position(0, 0), 'Hello');
        assert_1.default.ok(await vscode.workspace.applyEdit(we));
        const doc = await vscode.workspace.openTextDocument(newUri);
        assert_1.default.strictEqual(doc.getText(), 'Hello');
    }));
    test('WorkspaceEdit: create & override', (0, utils_1.withLogDisabled)(async function () {
        const docUri = await (0, utils_1.createRandomFile)('before');
        let we = new vscode.WorkspaceEdit();
        we.createFile(docUri);
        assert_1.default.ok(!await vscode.workspace.applyEdit(we));
        assert_1.default.strictEqual((await vscode.workspace.openTextDocument(docUri)).getText(), 'before');
        we = new vscode.WorkspaceEdit();
        we.createFile(docUri, { overwrite: true });
        assert_1.default.ok(await vscode.workspace.applyEdit(we));
        assert_1.default.strictEqual((await vscode.workspace.openTextDocument(docUri)).getText(), '');
    }));
    test('WorkspaceEdit: create & ignoreIfExists', (0, utils_1.withLogDisabled)(async function () {
        const docUri = await (0, utils_1.createRandomFile)('before');
        let we = new vscode.WorkspaceEdit();
        we.createFile(docUri, { ignoreIfExists: true });
        assert_1.default.ok(await vscode.workspace.applyEdit(we));
        assert_1.default.strictEqual((await vscode.workspace.openTextDocument(docUri)).getText(), 'before');
        we = new vscode.WorkspaceEdit();
        we.createFile(docUri, { overwrite: true, ignoreIfExists: true });
        assert_1.default.ok(await vscode.workspace.applyEdit(we));
        assert_1.default.strictEqual((await vscode.workspace.openTextDocument(docUri)).getText(), '');
    }));
    test('WorkspaceEdit: rename & ignoreIfExists', (0, utils_1.withLogDisabled)(async function () {
        const aUri = await (0, utils_1.createRandomFile)('aaa');
        const bUri = await (0, utils_1.createRandomFile)('bbb');
        let we = new vscode.WorkspaceEdit();
        we.renameFile(aUri, bUri);
        assert_1.default.ok(!await vscode.workspace.applyEdit(we));
        we = new vscode.WorkspaceEdit();
        we.renameFile(aUri, bUri, { ignoreIfExists: true });
        assert_1.default.ok(await vscode.workspace.applyEdit(we));
        we = new vscode.WorkspaceEdit();
        we.renameFile(aUri, bUri, { overwrite: false, ignoreIfExists: true });
        assert_1.default.ok(!await vscode.workspace.applyEdit(we));
        we = new vscode.WorkspaceEdit();
        we.renameFile(aUri, bUri, { overwrite: true, ignoreIfExists: true });
        assert_1.default.ok(await vscode.workspace.applyEdit(we));
    }));
    test('WorkspaceEdit: delete & ignoreIfNotExists', (0, utils_1.withLogDisabled)(async function () {
        const docUri = await (0, utils_1.createRandomFile)();
        let we = new vscode.WorkspaceEdit();
        we.deleteFile(docUri, { ignoreIfNotExists: false });
        assert_1.default.ok(await vscode.workspace.applyEdit(we));
        we = new vscode.WorkspaceEdit();
        we.deleteFile(docUri, { ignoreIfNotExists: false });
        assert_1.default.ok(!await vscode.workspace.applyEdit(we));
        we = new vscode.WorkspaceEdit();
        we.deleteFile(docUri, { ignoreIfNotExists: true });
        assert_1.default.ok(await vscode.workspace.applyEdit(we));
    }));
    test('WorkspaceEdit: insert & rename multiple', async function () {
        const [f1, f2, f3] = await Promise.all([(0, utils_1.createRandomFile)(), (0, utils_1.createRandomFile)(), (0, utils_1.createRandomFile)()]);
        const we = new vscode.WorkspaceEdit();
        we.insert(f1, new vscode.Position(0, 0), 'f1');
        we.insert(f2, new vscode.Position(0, 0), 'f2');
        we.insert(f3, new vscode.Position(0, 0), 'f3');
        const f1_ = nameWithUnderscore(f1);
        we.renameFile(f1, f1_);
        assert_1.default.ok(await vscode.workspace.applyEdit(we));
        assert_1.default.strictEqual((await vscode.workspace.openTextDocument(f3)).getText(), 'f3');
        assert_1.default.strictEqual((await vscode.workspace.openTextDocument(f2)).getText(), 'f2');
        assert_1.default.strictEqual((await vscode.workspace.openTextDocument(f1_)).getText(), 'f1');
        try {
            await vscode.workspace.fs.stat(f1);
            assert_1.default.ok(false);
        }
        catch {
            assert_1.default.ok(true);
        }
    });
    // TODO: below test is flaky and commented out, see https://github.com/microsoft/vscode/issues/238837
    test.skip('workspace.applyEdit drops the TextEdit if there is a RenameFile later #77735 (with opened editor)', async function () {
        await test77735(true);
    });
    test('workspace.applyEdit drops the TextEdit if there is a RenameFile later #77735 (without opened editor)', async function () {
        await test77735(false);
    });
    async function test77735(withOpenedEditor) {
        const docUriOriginal = await (0, utils_1.createRandomFile)();
        const docUriMoved = docUriOriginal.with({ path: `${docUriOriginal.path}.moved` });
        await (0, utils_1.deleteFile)(docUriMoved);
        if (withOpenedEditor) {
            const document = await vscode.workspace.openTextDocument(docUriOriginal);
            await vscode.window.showTextDocument(document);
        }
        else {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        }
        for (let i = 0; i < 4; i++) {
            const we = new vscode.WorkspaceEdit();
            let oldUri;
            let newUri;
            let expected;
            if (i % 2 === 0) {
                oldUri = docUriOriginal;
                newUri = docUriMoved;
                we.insert(oldUri, new vscode.Position(0, 0), 'Hello');
                expected = 'Hello';
            }
            else {
                oldUri = docUriMoved;
                newUri = docUriOriginal;
                we.delete(oldUri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5)));
                expected = '';
            }
            we.renameFile(oldUri, newUri);
            assert_1.default.ok(await vscode.workspace.applyEdit(we));
            const document = await vscode.workspace.openTextDocument(newUri);
            assert_1.default.strictEqual(document.isDirty, true);
            const result = await document.save();
            assert_1.default.strictEqual(result, true, `save failed in iteration: ${i} (docUriOriginal: ${docUriOriginal.fsPath})`);
            assert_1.default.strictEqual(document.isDirty, false, `document still dirty in iteration: ${i} (docUriOriginal: ${docUriOriginal.fsPath})`);
            assert_1.default.strictEqual(document.getText(), expected);
            await (0, utils_1.delay)(10);
        }
    }
    test('The api workspace.applyEdit failed for some case of mixing resourceChange and textEdit #80688, 1/2', async function () {
        const file1 = await (0, utils_1.createRandomFile)();
        const file2 = await (0, utils_1.createRandomFile)();
        const we = new vscode.WorkspaceEdit();
        we.insert(file1, new vscode.Position(0, 0), 'import1;');
        const file2Name = (0, path_1.basename)(file2.fsPath);
        const file2NewUri = vscode.Uri.joinPath(file2, `../new/${file2Name}`);
        we.renameFile(file2, file2NewUri);
        we.insert(file1, new vscode.Position(0, 0), 'import2;');
        await vscode.workspace.applyEdit(we);
        const document = await vscode.workspace.openTextDocument(file1);
        // const expected = 'import1;import2;';
        const expected2 = 'import2;import1;';
        assert_1.default.strictEqual(document.getText(), expected2);
    });
    test('The api workspace.applyEdit failed for some case of mixing resourceChange and textEdit #80688, 2/2', async function () {
        const file1 = await (0, utils_1.createRandomFile)();
        const file2 = await (0, utils_1.createRandomFile)();
        const we = new vscode.WorkspaceEdit();
        we.insert(file1, new vscode.Position(0, 0), 'import1;');
        we.insert(file1, new vscode.Position(0, 0), 'import2;');
        const file2Name = (0, path_1.basename)(file2.fsPath);
        const file2NewUri = vscode.Uri.joinPath(file2, `../new/${file2Name}`);
        we.renameFile(file2, file2NewUri);
        await vscode.workspace.applyEdit(we);
        const document = await vscode.workspace.openTextDocument(file1);
        const expected = 'import1;import2;';
        // const expected2 = 'import2;import1;';
        assert_1.default.strictEqual(document.getText(), expected);
    });
    test('[Bug] Failed to create new test file when in an untitled file #1261', async function () {
        const uri = vscode.Uri.parse('untitled:Untitled-5.test');
        const contents = `Hello Test File ${uri.toString()}`;
        const we = new vscode.WorkspaceEdit();
        we.createFile(uri, { ignoreIfExists: true });
        we.replace(uri, new vscode.Range(0, 0, 0, 0), contents);
        const success = await vscode.workspace.applyEdit(we);
        assert_1.default.ok(success);
        const doc = await vscode.workspace.openTextDocument(uri);
        assert_1.default.strictEqual(doc.getText(), contents);
    });
    test('Should send a single FileWillRenameEvent instead of separate events when moving multiple files at once#111867, 1/3', async function () {
        const file1 = await (0, utils_1.createRandomFile)();
        const file2 = await (0, utils_1.createRandomFile)();
        const file1New = await (0, utils_1.createRandomFile)();
        const file2New = await (0, utils_1.createRandomFile)();
        const event = new Promise(resolve => {
            const sub = vscode.workspace.onWillRenameFiles(e => {
                sub.dispose();
                resolve(e);
            });
        });
        const we = new vscode.WorkspaceEdit();
        we.renameFile(file1, file1New, { overwrite: true });
        we.renameFile(file2, file2New, { overwrite: true });
        await vscode.workspace.applyEdit(we);
        const e = await event;
        assert_1.default.strictEqual(e.files.length, 2);
        assert_1.default.strictEqual(e.files[0].oldUri.toString(), file1.toString());
        assert_1.default.strictEqual(e.files[1].oldUri.toString(), file2.toString());
    });
    test('WorkspaceEdit fails when creating then writing to file if file is open in the editor and is not empty #146964', async function () {
        const file1 = await (0, utils_1.createRandomFile)();
        {
            // prepare: open file in editor, make sure it has contents
            const editor = await vscode.window.showTextDocument(file1);
            const prepEdit = new vscode.WorkspaceEdit();
            prepEdit.insert(file1, new vscode.Position(0, 0), 'Hello Here And There');
            const status = await vscode.workspace.applyEdit(prepEdit);
            assert_1.default.ok(status);
            assert_1.default.strictEqual(editor.document.getText(), 'Hello Here And There');
            assert_1.default.ok(vscode.window.activeTextEditor === editor);
        }
        const we = new vscode.WorkspaceEdit();
        we.createFile(file1, { overwrite: true, ignoreIfExists: false });
        we.set(file1, [new vscode.TextEdit(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)), 'SOME TEXT')]);
        const status = await vscode.workspace.applyEdit(we);
        assert_1.default.ok(status);
        assert_1.default.strictEqual(vscode.window.activeTextEditor.document.getText(), 'SOME TEXT');
    });
    test('Should send a single FileWillRenameEvent instead of separate events when moving multiple files at once#111867, 2/3', async function () {
        const event = new Promise(resolve => {
            const sub = vscode.workspace.onWillCreateFiles(e => {
                sub.dispose();
                resolve(e);
            });
        });
        const file1 = vscode.Uri.parse(`fake-fs:/${(0, utils_1.rndName)()}`);
        const file2 = vscode.Uri.parse(`fake-fs:/${(0, utils_1.rndName)()}`);
        const we = new vscode.WorkspaceEdit();
        we.createFile(file1, { overwrite: true });
        we.createFile(file2, { overwrite: true });
        await vscode.workspace.applyEdit(we);
        const e = await event;
        assert_1.default.strictEqual(e.files.length, 2);
        assert_1.default.strictEqual(e.files[0].toString(), file1.toString());
        assert_1.default.strictEqual(e.files[1].toString(), file2.toString());
    });
    test('Should send a single FileWillRenameEvent instead of separate events when moving multiple files at once#111867, 3/3', async function () {
        const file1 = await (0, utils_1.createRandomFile)();
        const file2 = await (0, utils_1.createRandomFile)();
        const event = new Promise(resolve => {
            const sub = vscode.workspace.onWillDeleteFiles(e => {
                sub.dispose();
                resolve(e);
            });
        });
        const we = new vscode.WorkspaceEdit();
        we.deleteFile(file1);
        we.deleteFile(file2);
        await vscode.workspace.applyEdit(we);
        const e = await event;
        assert_1.default.strictEqual(e.files.length, 2);
        assert_1.default.strictEqual(e.files[0].toString(), file1.toString());
        assert_1.default.strictEqual(e.files[1].toString(), file2.toString());
    });
    test('issue #107739 - Redo of rename Java Class name has no effect', async () => {
        const file = await (0, utils_1.createRandomFile)('hello');
        const fileName = (0, path_1.basename)(file.fsPath);
        const newFile = vscode.Uri.joinPath(file, `../${fileName}2`);
        // apply edit
        {
            const we = new vscode.WorkspaceEdit();
            we.insert(file, new vscode.Position(0, 5), '2');
            we.renameFile(file, newFile);
            await vscode.workspace.applyEdit(we);
        }
        // show the new document
        {
            const document = await vscode.workspace.openTextDocument(newFile);
            await vscode.window.showTextDocument(document);
            assert_1.default.strictEqual(document.getText(), 'hello2');
            assert_1.default.strictEqual(document.isDirty, true);
        }
        // undo and show the old document
        {
            await vscode.commands.executeCommand('undo');
            const document = await vscode.workspace.openTextDocument(file);
            await vscode.window.showTextDocument(document);
            assert_1.default.strictEqual(document.getText(), 'hello');
        }
        // redo and show the new document
        {
            await vscode.commands.executeCommand('redo');
            const document = await vscode.workspace.openTextDocument(newFile);
            await vscode.window.showTextDocument(document);
            assert_1.default.strictEqual(document.getText(), 'hello2');
            assert_1.default.strictEqual(document.isDirty, true);
        }
    });
    test('issue #110141 - TextEdit.setEndOfLine applies an edit and invalidates redo stack even when no change is made', async () => {
        const file = await (0, utils_1.createRandomFile)('hello\nworld');
        const document = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(document);
        // apply edit
        {
            const we = new vscode.WorkspaceEdit();
            we.insert(file, new vscode.Position(0, 5), '2');
            await vscode.workspace.applyEdit(we);
        }
        // check the document
        {
            assert_1.default.strictEqual(document.getText(), 'hello2\nworld');
            assert_1.default.strictEqual(document.isDirty, true);
        }
        // apply no-op edit
        {
            const we = new vscode.WorkspaceEdit();
            we.set(file, [vscode.TextEdit.setEndOfLine(vscode.EndOfLine.LF)]);
            await vscode.workspace.applyEdit(we);
        }
        // undo
        {
            await vscode.commands.executeCommand('undo');
            assert_1.default.strictEqual(document.getText(), 'hello\nworld');
            assert_1.default.strictEqual(document.isDirty, false);
        }
    });
    test('SnippetString in WorkspaceEdit', async function () {
        const file = await (0, utils_1.createRandomFile)('hello\nworld');
        const document = await vscode.workspace.openTextDocument(file);
        const edt = await vscode.window.showTextDocument(document);
        assert_1.default.ok(edt === vscode.window.activeTextEditor);
        const we = new vscode.WorkspaceEdit();
        we.set(document.uri, [new vscode.SnippetTextEdit(new vscode.Range(0, 0, 0, 0), new vscode.SnippetString('${1:foo}${2:bar}'))]);
        const success = await vscode.workspace.applyEdit(we);
        if (edt !== vscode.window.activeTextEditor) {
            return this.skip();
        }
        assert_1.default.ok(success);
        assert_1.default.strictEqual(document.getText(), 'foobarhello\nworld');
        assert_1.default.deepStrictEqual(edt.selections, [new vscode.Selection(0, 0, 0, 3)]);
    });
    test('SnippetString in WorkspaceEdit with keepWhitespace', async function () {
        const file = await (0, utils_1.createRandomFile)('This is line 1\n  ');
        const document = await vscode.workspace.openTextDocument(file);
        const edt = await vscode.window.showTextDocument(document);
        assert_1.default.ok(edt === vscode.window.activeTextEditor);
        const snippetText = new vscode.SnippetTextEdit(new vscode.Range(1, 3, 1, 3), new vscode.SnippetString('This is line 2\n  This is line 3'));
        snippetText.keepWhitespace = true;
        const we = new vscode.WorkspaceEdit();
        we.set(document.uri, [snippetText]);
        const success = await vscode.workspace.applyEdit(we);
        if (edt !== vscode.window.activeTextEditor) {
            return this.skip();
        }
        assert_1.default.ok(success);
        assert_1.default.strictEqual(document.getText(), 'This is line 1\n  This is line 2\n  This is line 3');
    });
    test('Support creating binary files in a WorkspaceEdit', async function () {
        const fileUri = vscode.Uri.parse(`${utils_1.testFs.scheme}:/${(0, utils_1.rndName)()}`);
        const data = Buffer.from('Hello Binary Files');
        const ws = new vscode.WorkspaceEdit();
        ws.createFile(fileUri, { contents: data, ignoreIfExists: false, overwrite: false });
        const success = await vscode.workspace.applyEdit(ws);
        assert_1.default.ok(success);
        const actual = await vscode.workspace.fs.readFile(fileUri);
        assert_1.default.deepStrictEqual(actual, data);
    });
    test('saveAll', async () => {
        await testSave(true);
    });
    test('save', async () => {
        await testSave(false);
    });
    async function testSave(saveAll) {
        const file = await (0, utils_1.createRandomFile)();
        const disposables = [];
        await (0, utils_1.revertAllDirty)(); // needed for a clean state for `onDidSaveTextDocument` (#102365)
        const onDidSaveTextDocument = new Set();
        disposables.push(vscode.workspace.onDidSaveTextDocument(e => {
            onDidSaveTextDocument.add(e);
        }));
        const doc = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(doc);
        if (saveAll) {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(doc.uri, new vscode.Position(0, 0), 'Hello World');
            await vscode.workspace.applyEdit(edit);
            assert_1.default.ok(doc.isDirty);
            await vscode.workspace.saveAll(false); // requires dirty documents
        }
        else {
            const res = await vscode.workspace.save(doc.uri); // enforces to save even when not dirty
            assert_1.default.ok(res?.toString() === doc.uri.toString());
        }
        assert_1.default.ok(onDidSaveTextDocument);
        assert_1.default.ok(Array.from(onDidSaveTextDocument).find(e => e.uri.toString() === file.toString()), 'did Save: ' + file.toString());
        (0, utils_1.disposeAll)(disposables);
        return (0, utils_1.deleteFile)(file);
    }
    test('encoding: text document encodings', async () => {
        const uri1 = await (0, utils_1.createRandomFile)();
        const uri2 = await (0, utils_1.createRandomFile)(new Uint8Array([0xEF, 0xBB, 0xBF]) /* UTF-8 with BOM */);
        const uri3 = await (0, utils_1.createRandomFile)(new Uint8Array([0xFF, 0xFE]) /* UTF-16 LE BOM */);
        const uri4 = await (0, utils_1.createRandomFile)(new Uint8Array([0xFE, 0xFF]) /* UTF-16 BE BOM */);
        const doc1 = await vscode.workspace.openTextDocument(uri1);
        assert_1.default.strictEqual(doc1.encoding, 'utf8');
        const doc2 = await vscode.workspace.openTextDocument(uri2);
        assert_1.default.strictEqual(doc2.encoding, 'utf8bom');
        const doc3 = await vscode.workspace.openTextDocument(uri3);
        assert_1.default.strictEqual(doc3.encoding, 'utf16le');
        const doc4 = await vscode.workspace.openTextDocument(uri4);
        assert_1.default.strictEqual(doc4.encoding, 'utf16be');
        const doc5 = await vscode.workspace.openTextDocument({ content: 'Hello World' });
        assert_1.default.strictEqual(doc5.encoding, 'utf8');
    });
    test('encoding: openTextDocument', async () => {
        const uri1 = await (0, utils_1.createRandomFile)();
        let doc1 = await vscode.workspace.openTextDocument(uri1, { encoding: 'cp1252' });
        assert_1.default.strictEqual(doc1.encoding, 'cp1252');
        let listener;
        const documentChangePromise = new Promise(resolve => {
            listener = vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document.uri.toString() === uri1.toString()) {
                    resolve();
                }
            });
        });
        doc1 = await vscode.workspace.openTextDocument(uri1, { encoding: 'utf16le' });
        assert_1.default.strictEqual(doc1.encoding, 'utf16le');
        await documentChangePromise;
        const doc2 = await vscode.workspace.openTextDocument({ encoding: 'utf16be' });
        assert_1.default.strictEqual(doc2.encoding, 'utf16be');
        const doc3 = await vscode.workspace.openTextDocument({ content: 'Hello World', encoding: 'utf16le' });
        assert_1.default.strictEqual(doc3.encoding, 'utf16le');
        listener?.dispose();
    });
    test('encoding: openTextDocument - throws for dirty documents', async () => {
        const uri1 = await (0, utils_1.createRandomFile)();
        const doc1 = await vscode.workspace.openTextDocument(uri1, { encoding: 'cp1252' });
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc1.uri, new vscode.Position(0, 0), 'Hello World');
        await vscode.workspace.applyEdit(edit);
        assert_1.default.strictEqual(doc1.isDirty, true);
        let err;
        try {
            await vscode.workspace.decode(new Uint8Array([0, 0, 0, 0]), doc1.uri);
        }
        catch (e) {
            err = e;
        }
        assert_1.default.ok(err);
    });
    test('encoding: openTextDocument - multiple requests with different encoding work', async () => {
        const uri1 = await (0, utils_1.createRandomFile)();
        const doc1P = vscode.workspace.openTextDocument(uri1);
        const doc2P = vscode.workspace.openTextDocument(uri1, { encoding: 'cp1252' });
        const [doc1, doc2] = await Promise.all([doc1P, doc2P]);
        assert_1.default.strictEqual(doc1.encoding, 'cp1252');
        assert_1.default.strictEqual(doc2.encoding, 'cp1252');
    });
    test('encoding: decode', async function () {
        const uri = root.with({ path: path_1.posix.join(root.path, 'file.txt') });
        // without setting
        assert_1.default.strictEqual(await vscode.workspace.decode(Buffer.from('Hello World'), uri), 'Hello World');
        assert_1.default.strictEqual(await vscode.workspace.decode(Buffer.from('Hellö Wörld'), uri), 'Hellö Wörld');
        assert_1.default.strictEqual(await vscode.workspace.decode(new Uint8Array([0xEF, 0xBB, 0xBF, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]), uri), 'Hello World'); // UTF-8 with BOM
        assert_1.default.strictEqual(await vscode.workspace.decode(new Uint8Array([0xFE, 0xFF, 0, 72, 0, 101, 0, 108, 0, 108, 0, 111, 0, 32, 0, 87, 0, 111, 0, 114, 0, 108, 0, 100]), uri), 'Hello World'); // UTF-16 BE with BOM
        assert_1.default.strictEqual(await vscode.workspace.decode(new Uint8Array([0xFF, 0xFE, 72, 0, 101, 0, 108, 0, 108, 0, 111, 0, 32, 0, 87, 0, 111, 0, 114, 0, 108, 0, 100, 0]), uri), 'Hello World'); // UTF-16 LE with BOM
        assert_1.default.strictEqual(await vscode.workspace.decode(new Uint8Array([0, 72, 0, 101, 0, 108, 0, 108, 0, 111, 0, 32, 0, 87, 0, 111, 0, 114, 0, 108, 0, 100]), uri), 'Hello World');
        assert_1.default.strictEqual(await vscode.workspace.decode(new Uint8Array([72, 0, 101, 0, 108, 0, 108, 0, 111, 0, 32, 0, 87, 0, 111, 0, 114, 0, 108, 0, 100, 0]), uri), 'Hello World');
        // with auto-guess encoding
        try {
            await vscode.workspace.getConfiguration('files', uri).update('autoGuessEncoding', true, vscode.ConfigurationTarget.Global);
            assert_1.default.strictEqual(await vscode.workspace.decode(new Uint8Array([72, 101, 108, 108, 0xF6, 32, 87, 0xF6, 114, 108, 100]), uri), 'Hellö Wörld');
        }
        finally {
            await vscode.workspace.getConfiguration('files', uri).update('autoGuessEncoding', false, vscode.ConfigurationTarget.Global);
        }
        // with encoding setting
        try {
            await vscode.workspace.getConfiguration('files', uri).update('encoding', 'windows1252', vscode.ConfigurationTarget.Global);
            assert_1.default.strictEqual(await vscode.workspace.decode(new Uint8Array([72, 101, 108, 108, 0xF6, 32, 87, 0xF6, 114, 108, 100]), uri), 'Hellö Wörld');
        }
        finally {
            await vscode.workspace.getConfiguration('files', uri).update('encoding', 'utf8', vscode.ConfigurationTarget.Global);
        }
        // with encoding provided
        assert_1.default.strictEqual(await vscode.workspace.decode(new Uint8Array([72, 101, 108, 108, 0xF6, 32, 87, 0xF6, 114, 108, 100]), uri, { encoding: 'windows1252' }), 'Hellö Wörld');
        assert_1.default.strictEqual(await vscode.workspace.decode(Buffer.from('Hello World'), uri, { encoding: 'foobar123' }), 'Hello World');
        // binary
        let err;
        try {
            await vscode.workspace.decode(new Uint8Array([0, 0, 0, 0]), uri);
        }
        catch (e) {
            err = e;
        }
        assert_1.default.ok(err);
    });
    test('encoding: encode', async function () {
        const uri = root.with({ path: path_1.posix.join(root.path, 'file.txt') });
        // without setting
        assert_1.default.strictEqual((await vscode.workspace.encode('Hello World', uri)).toString(), 'Hello World');
        // with encoding setting
        try {
            await vscode.workspace.getConfiguration('files', uri).update('encoding', 'utf8bom', vscode.ConfigurationTarget.Global);
            assert_1.default.ok(equalsUint8Array(await vscode.workspace.encode('Hello World', uri), new Uint8Array([0xEF, 0xBB, 0xBF, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100])));
            await vscode.workspace.getConfiguration('files', uri).update('encoding', 'utf16le', vscode.ConfigurationTarget.Global);
            assert_1.default.ok(equalsUint8Array(await vscode.workspace.encode('Hello World', uri), new Uint8Array([0xFF, 0xFE, 72, 0, 101, 0, 108, 0, 108, 0, 111, 0, 32, 0, 87, 0, 111, 0, 114, 0, 108, 0, 100, 0])));
            await vscode.workspace.getConfiguration('files', uri).update('encoding', 'utf16be', vscode.ConfigurationTarget.Global);
            assert_1.default.ok(equalsUint8Array(await vscode.workspace.encode('Hello World', uri), new Uint8Array([0xFE, 0xFF, 0, 72, 0, 101, 0, 108, 0, 108, 0, 111, 0, 32, 0, 87, 0, 111, 0, 114, 0, 108, 0, 100])));
            await vscode.workspace.getConfiguration('files', uri).update('encoding', 'cp1252', vscode.ConfigurationTarget.Global);
            assert_1.default.ok(equalsUint8Array(await vscode.workspace.encode('Hellö Wörld', uri), new Uint8Array([72, 101, 108, 108, 0xF6, 32, 87, 0xF6, 114, 108, 100])));
        }
        finally {
            await vscode.workspace.getConfiguration('files', uri).update('encoding', 'utf8', vscode.ConfigurationTarget.Global);
        }
        // with encoding provided
        assert_1.default.ok(equalsUint8Array(await vscode.workspace.encode('Hello World', uri, { encoding: 'utf8' }), new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100])));
        assert_1.default.ok(equalsUint8Array(await vscode.workspace.encode('Hello World', uri, { encoding: 'utf8bom' }), new Uint8Array([0xEF, 0xBB, 0xBF, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100])));
        assert_1.default.ok(equalsUint8Array(await vscode.workspace.encode('Hello World', uri, { encoding: 'utf16le' }), new Uint8Array([0xFF, 0xFE, 72, 0, 101, 0, 108, 0, 108, 0, 111, 0, 32, 0, 87, 0, 111, 0, 114, 0, 108, 0, 100, 0])));
        assert_1.default.ok(equalsUint8Array(await vscode.workspace.encode('Hello World', uri, { encoding: 'utf16be' }), new Uint8Array([0xFE, 0xFF, 0, 72, 0, 101, 0, 108, 0, 108, 0, 111, 0, 32, 0, 87, 0, 111, 0, 114, 0, 108, 0, 100])));
        assert_1.default.ok(equalsUint8Array(await vscode.workspace.encode('Hellö Wörld', uri, { encoding: 'cp1252' }), new Uint8Array([72, 101, 108, 108, 0xF6, 32, 87, 0xF6, 114, 108, 100])));
        assert_1.default.ok(equalsUint8Array(await vscode.workspace.encode('Hello World', uri, { encoding: 'foobar123' }), new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100])));
    });
    function equalsUint8Array(a, b) {
        if (a === b) {
            return true;
        }
        if (a.byteLength !== b.byteLength) {
            return false;
        }
        for (let i = 0; i < a.byteLength; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }
        return true;
    }
    test('encoding: save text document with a different encoding', async () => {
        const originalText = 'Hellö\nWörld';
        const uri = await (0, utils_1.createRandomFile)(originalText);
        let doc = await vscode.workspace.openTextDocument(uri);
        assert_1.default.strictEqual(doc.encoding, 'utf8');
        const text = doc.getText();
        assert_1.default.strictEqual(text, originalText);
        const buf = await vscode.workspace.encode(text, uri, { encoding: 'windows1252' });
        await vscode.workspace.fs.writeFile(uri, buf);
        doc = await vscode.workspace.openTextDocument(uri, { encoding: 'windows1252' });
        assert_1.default.strictEqual(doc.encoding, 'windows1252');
        const updatedText = doc.getText();
        assert_1.default.strictEqual(updatedText, text);
    });
    test('encoding: utf8bom does not explode (https://github.com/microsoft/vscode/issues/242132)', async function () {
        const buffer = [0xEF, 0xBB, 0xBF, 72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100];
        const uri = await (0, utils_1.createRandomFile)(new Uint8Array(buffer) /* UTF-8 with BOM */);
        let doc = await vscode.workspace.openTextDocument(uri);
        assert_1.default.strictEqual(doc.encoding, 'utf8bom');
        doc = await vscode.workspace.openTextDocument(uri, { encoding: 'utf8bom' });
        assert_1.default.strictEqual(doc.encoding, 'utf8bom');
        const decoded = await vscode.workspace.decode(new Uint8Array(buffer), uri, { encoding: 'utf8bom' });
        assert_1.default.strictEqual(decoded, 'Hello World');
        const encoded = await vscode.workspace.encode('Hello World', uri, { encoding: 'utf8bom' });
        assert_1.default.ok(equalsUint8Array(encoded, new Uint8Array(buffer)));
    });
});
//# sourceMappingURL=workspace.test.js.map