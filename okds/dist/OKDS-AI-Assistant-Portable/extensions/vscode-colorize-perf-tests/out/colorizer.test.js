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
const fs = __importStar(require("fs"));
require("mocha");
const path_1 = require("path");
const vscode_1 = require("vscode");
function findBestsAndWorsts(results) {
    let bestParse;
    let bestCapture;
    let bestMetadata;
    let bestCombined;
    let worstParse;
    let worstCapture;
    let worstMetadata;
    let worstCombined;
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.parseTime && result.captureTime && result.metadataTime) {
            // Tree Sitter
            const combined = result.parseTime + result.captureTime + result.metadataTime;
            if (bestParse === undefined || result.parseTime < bestParse) {
                bestParse = result.parseTime;
            }
            if (bestCapture === undefined || result.captureTime < bestCapture) {
                bestCapture = result.captureTime;
            }
            if (bestMetadata === undefined || result.metadataTime < bestMetadata) {
                bestMetadata = result.metadataTime;
            }
            if (bestCombined === undefined || combined < bestCombined) {
                bestCombined = combined;
            }
            if (i !== 0) {
                if (worstParse === undefined || result.parseTime > worstParse) {
                    worstParse = result.parseTime;
                }
                if (worstCapture === undefined || result.captureTime > worstCapture) {
                    worstCapture = result.captureTime;
                }
                if (worstMetadata === undefined || result.metadataTime > worstMetadata) {
                    worstMetadata = result.metadataTime;
                }
                if (worstCombined === undefined || combined > worstCombined) {
                    worstCombined = combined;
                }
            }
        }
        else if (result.tokenizeTime) {
            // TextMate
            if (bestCombined === undefined || result.tokenizeTime < bestCombined) {
                bestCombined = result.tokenizeTime;
            }
            if (i !== 0 && (worstCombined === undefined || result.tokenizeTime > worstCombined)) {
                worstCombined = result.tokenizeTime;
            }
        }
    }
    return {
        bestParse,
        bestCapture,
        bestMetadata,
        bestCombined: bestCombined,
        worstParse,
        worstCapture,
        worstMetadata,
        worstCombined: worstCombined,
    };
}
async function runCommand(command, file, times) {
    const results = [];
    for (let i = 0; i < times; i++) {
        results.push(await vscode_1.commands.executeCommand(command, file));
    }
    return results;
}
async function doTest(file, times) {
    const treeSitterResults = await runCommand('_workbench.colorizeTreeSitterTokens', file, times);
    const { bestParse, bestCapture, bestMetadata, bestCombined, worstParse, worstCapture, worstMetadata, worstCombined } = findBestsAndWorsts(treeSitterResults);
    const textMateResults = await runCommand('_workbench.colorizeTextMateTokens', file, times);
    const textMateBestWorst = findBestsAndWorsts(textMateResults);
    const toString = (time, charLength) => {
        // truncate time to charLength characters
        return time.toString().slice(0, charLength).padEnd(charLength, ' ');
    };
    const numLength = 7;
    const resultString = `                        | First   | Best    | Worst   |
| --------------------- | ------- | ------- | ------- |
| TreeSitter (parse)    | ${toString(treeSitterResults[0].parseTime, numLength)} | ${toString(bestParse, numLength)} | ${toString(worstParse, numLength)} |
| TreeSitter (capture)  | ${toString(treeSitterResults[0].captureTime, numLength)} | ${toString(bestCapture, numLength)} | ${toString(worstCapture, numLength)} |
| TreeSitter (metadata) | ${toString(treeSitterResults[0].metadataTime, numLength)} | ${toString(bestMetadata, numLength)} | ${toString(worstMetadata, numLength)} |
| TreeSitter (total)    | ${toString(treeSitterResults[0].parseTime + treeSitterResults[0].captureTime + treeSitterResults[0].metadataTime, numLength)} | ${toString(bestCombined, numLength)} | ${toString(worstCombined, numLength)} |
| TextMate              | ${toString(textMateResults[0].tokenizeTime, numLength)} | ${toString(textMateBestWorst.bestCombined, numLength)} | ${toString(textMateBestWorst.worstCombined, numLength)} |
`;
    console.log(`File ${(0, path_1.basename)(file.fsPath)}:`);
    console.log(resultString);
}
suite('Tokenization Performance', () => {
    const testPath = (0, path_1.normalize)((0, path_1.join)(__dirname, '../test'));
    const fixturesPath = (0, path_1.join)(testPath, 'colorize-fixtures');
    let originalSettingValue;
    suiteSetup(async function () {
        originalSettingValue = vscode_1.workspace.getConfiguration('editor').get('experimental.preferTreeSitter');
        await vscode_1.workspace.getConfiguration('editor').update('experimental.preferTreeSitter', ["typescript"], vscode_1.ConfigurationTarget.Global);
    });
    suiteTeardown(async function () {
        await vscode_1.workspace.getConfiguration('editor').update('experimental.preferTreeSitter', originalSettingValue, vscode_1.ConfigurationTarget.Global);
    });
    for (const fixture of fs.readdirSync(fixturesPath)) {
        test(`Full file colorize: ${fixture}`, async function () {
            await vscode_1.commands.executeCommand('workbench.action.closeAllEditors');
            await doTest(vscode_1.Uri.file((0, path_1.join)(fixturesPath, fixture)), 6);
        });
    }
});
//# sourceMappingURL=colorizer.test.js.map