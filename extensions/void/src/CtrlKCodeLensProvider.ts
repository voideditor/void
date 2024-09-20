import * as vscode from 'vscode';
import { ApiConfig,sendLLMMessage } from './common/sendLLMMessage'; 
import { ApprovalCodeLensProvider } from './ApprovalCodeLensProvider';
import { SuggestedEdit } from './ApprovalCodeLensProvider';

export class CtrlKCodeLensProvider {
    private decoration: vscode.TextEditorDecorationType;
    private apiConfig: ApiConfig | null = {
        anthropic: { apikey: 'your-anthropic-api-key' },
        openai: { apikey: 'your-openai-api-key' },
        greptile: { apikey: 'your-greptile-api-key', githubPAT: 'your-github-pat', repoinfo: { remote: 'github', repository: 'voideditor/void', branch: 'main' }},
        ollama: { endpoint: 'your-ollama-endpoint', model: 'your-model' },
        whichApi: 'openai' // or 'anthropic', 'greptile', etc.
    };

    // highlight
    constructor() {
        this.decoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: '#3c3c3c',
            border: '1px solid #565656',
            borderRadius: '3px'
        });
    }

    public async showInlineInput(editor: vscode.TextEditor, range: vscode.Range) {
        editor.setDecorations(this.decoration, [range]);

        const result = await vscode.window.showInputBox({
            prompt: "Enter your prompt here",
            placeHolder: "Enter your input here",
            ignoreFocusOut: true   // Keep the input box open when focus is lost
        });
        if (result) {
            const highlightedCode = editor.document.getText(range);
            
            const { abort } = sendLLMMessage({
                // Send the user's prompt to llm.
                messages: [{ role: 'user', content: result + highlightedCode }],
                onText: (newText, fullText) => {

                },
                onFinalMessage: async (content) => {
                    // Create a SuggestedEdit object 
                    const suggestedEdit: SuggestedEdit = {
                        startLine: range.start.line,
                        endLine: range.end.line,
                        originalStartLine: range.start.line,
                        originalEndLine: range.end.line,
                        originalContent: highlightedCode, // The original highlighted code
                        newContent: content // The response from the LLM
                    };

                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        // Send to approvalProvider for accept/reject
                        const approvalProvider = new ApprovalCodeLensProvider();
                        await approvalProvider.addNewApprovals(editor, [suggestedEdit]);
                    }
                },
                apiConfig: this.apiConfig
            });
        }

        editor.setDecorations(this.decoration, []);
    }
}
