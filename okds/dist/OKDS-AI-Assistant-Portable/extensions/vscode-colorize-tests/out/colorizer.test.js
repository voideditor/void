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
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
require("mocha");
const path_1 = require("path");
const vscode_1 = require("vscode");
async function assertUnchangedTokens(fixturesPath, resultsPath, treeSitterResultsPath, fixture, done) {
    const testFixurePath = (0, path_1.join)(fixturesPath, fixture);
    const tokenizers = [{ command: '_workbench.captureSyntaxTokens', resultsPath }, { command: '_workbench.captureTreeSitterSyntaxTokens', resultsPath: treeSitterResultsPath }];
    try {
        await Promise.all(tokenizers.map(async (tokenizer) => {
            const data = await vscode_1.commands.executeCommand(tokenizer.command, vscode_1.Uri.file(testFixurePath));
            if (!fs.existsSync(tokenizer.resultsPath)) {
                fs.mkdirSync(tokenizer.resultsPath);
            }
            const resultPath = (0, path_1.join)(tokenizer.resultsPath, fixture.replace('.', '_') + '.json');
            if (fs.existsSync(resultPath)) {
                const previousData = JSON.parse(fs.readFileSync(resultPath).toString());
                try {
                    assert.deepStrictEqual(data, previousData);
                }
                catch (e) {
                    fs.writeFileSync(resultPath, JSON.stringify(data, null, '\t'), { flag: 'w' });
                    if (Array.isArray(data) && Array.isArray(previousData) && data.length === previousData.length) {
                        for (let i = 0; i < data.length; i++) {
                            const d = data[i];
                            const p = previousData[i];
                            if (d.c !== p.c || hasThemeChange(d.r, p.r)) {
                                throw e;
                            }
                        }
                        // different but no tokenization ot color change: no failure
                    }
                    else {
                        throw e;
                    }
                }
            }
            else {
                fs.writeFileSync(resultPath, JSON.stringify(data, null, '\t'));
            }
        }));
        done();
    }
    catch (e) {
        done(e);
    }
}
function hasThemeChange(d, p) {
    const keys = Object.keys(d);
    for (const key of keys) {
        if (d[key] !== p[key]) {
            return true;
        }
    }
    return false;
}
suite('colorization', () => {
    const testPath = (0, path_1.normalize)((0, path_1.join)(__dirname, '../test'));
    const fixturesPath = (0, path_1.join)(testPath, 'colorize-fixtures');
    const resultsPath = (0, path_1.join)(testPath, 'colorize-results');
    const treeSitterResultsPath = (0, path_1.join)(testPath, 'colorize-tree-sitter-results');
    let originalSettingValues;
    suiteSetup(async function () {
        originalSettingValues = [
            vscode_1.workspace.getConfiguration('editor.experimental').get('preferTreeSitter.typescript'),
            vscode_1.workspace.getConfiguration('editor.experimental').get('preferTreeSitter.ini'),
            vscode_1.workspace.getConfiguration('editor.experimental').get('preferTreeSitter.regex'),
            vscode_1.workspace.getConfiguration('editor.experimental').get('preferTreeSitter.css')
        ];
        await vscode_1.workspace.getConfiguration('editor.experimental').update('preferTreeSitter.typescript', true, vscode_1.ConfigurationTarget.Global);
        await vscode_1.workspace.getConfiguration('editor.experimental').update('preferTreeSitter.ini', true, vscode_1.ConfigurationTarget.Global);
        await vscode_1.workspace.getConfiguration('editor.experimental').update('preferTreeSitter.regex', true, vscode_1.ConfigurationTarget.Global);
        await vscode_1.workspace.getConfiguration('editor.experimental').update('preferTreeSitter.css', true, vscode_1.ConfigurationTarget.Global);
    });
    suiteTeardown(async function () {
        await vscode_1.workspace.getConfiguration('editor.experimental').update('preferTreeSitter.typescript', originalSettingValues[0], vscode_1.ConfigurationTarget.Global);
        await vscode_1.workspace.getConfiguration('editor.experimental').update('preferTreeSitter.ini', originalSettingValues[1], vscode_1.ConfigurationTarget.Global);
        await vscode_1.workspace.getConfiguration('editor.experimental').update('preferTreeSitter.regex', originalSettingValues[2], vscode_1.ConfigurationTarget.Global);
        await vscode_1.workspace.getConfiguration('editor.experimental').update('preferTreeSitter.css', originalSettingValues[3], vscode_1.ConfigurationTarget.Global);
    });
    for (const fixture of fs.readdirSync(fixturesPath)) {
        test(`colorize: ${fixture}`, function (done) {
            vscode_1.commands.executeCommand('workbench.action.closeAllEditors').then(() => {
                assertUnchangedTokens(fixturesPath, resultsPath, treeSitterResultsPath, fixture, done);
            });
        });
    }
});
//# sourceMappingURL=colorizer.test.js.map