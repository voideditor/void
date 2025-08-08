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
exports.activate = activate;
const jsoncParser = __importStar(require("jsonc-parser"));
const vscode = __importStar(require("vscode"));
function activate(context) {
    const tokenTypes = ['type', 'struct', 'class', 'interface', 'enum', 'parameterType', 'function', 'variable', 'testToken'];
    const tokenModifiers = ['static', 'abstract', 'deprecated', 'declaration', 'documentation', 'member', 'async', 'testModifier'];
    const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);
    const outputChannel = vscode.window.createOutputChannel('Semantic Tokens Test');
    const documentSemanticHighlightProvider = {
        provideDocumentSemanticTokens(document) {
            const builder = new vscode.SemanticTokensBuilder();
            function addToken(value, startLine, startCharacter, length) {
                const [type, ...modifiers] = value.split('.');
                const selectedModifiers = [];
                let tokenType = legend.tokenTypes.indexOf(type);
                if (tokenType === -1) {
                    if (type === 'notInLegend') {
                        tokenType = tokenTypes.length + 2;
                    }
                    else {
                        return;
                    }
                }
                let tokenModifiers = 0;
                for (const modifier of modifiers) {
                    const index = legend.tokenModifiers.indexOf(modifier);
                    if (index !== -1) {
                        tokenModifiers = tokenModifiers | 1 << index;
                        selectedModifiers.push(modifier);
                    }
                    else if (modifier === 'notInLegend') {
                        tokenModifiers = tokenModifiers | 1 << (legend.tokenModifiers.length + 2);
                        selectedModifiers.push(modifier);
                    }
                }
                builder.push(startLine, startCharacter, length, tokenType, tokenModifiers);
                outputChannel.appendLine(`line: ${startLine}, character: ${startCharacter}, length ${length}, ${type} (${tokenType}), ${selectedModifiers} ${tokenModifiers.toString(2)}`);
            }
            outputChannel.appendLine('---');
            const visitor = {
                onObjectProperty: (property, _offset, _length, startLine, startCharacter) => {
                    addToken(property, startLine, startCharacter, property.length + 2);
                },
                onLiteralValue: (value, _offset, length, startLine, startCharacter) => {
                    if (typeof value === 'string') {
                        addToken(value, startLine, startCharacter, length);
                    }
                }
            };
            jsoncParser.visit(document.getText(), visitor);
            return builder.build();
        }
    };
    context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ pattern: '**/*semantic-test.json' }, documentSemanticHighlightProvider, legend));
}
//# sourceMappingURL=colorizerTestMain.js.map