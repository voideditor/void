import * as vscode from 'vscode';

export class NaNDetector {
    private nanPronePatterns = [
        // Layers prone to NaN
        { pattern: /nn\.ReLU\(\)/g, risk: 'medium', message: 'ReLU can cause dead neurons' },
        { pattern: /nn\.Sigmoid\(\)/g, risk: 'high', message: 'Sigmoid prone to vanishing gradients' },
        { pattern: /nn\.Tanh\(\)/g, risk: 'medium', message: 'Tanh can saturate' },
        { pattern: /nn\.Linear\([^)]*\)/g, risk: 'medium', message: 'Linear layer without proper initialization' },
        { pattern: /nn\.LSTM\([^)]*\)/g, risk: 'high', message: 'LSTM prone to exploding gradients' },
        { pattern: /nn\.GRU\([^)]*\)/g, risk: 'high', message: 'GRU prone to exploding gradients' },
        
        // Activation functions
        { pattern: /F\.sigmoid\(/g, risk: 'high', message: 'Sigmoid activation prone to saturation' },
        { pattern: /F\.tanh\(/g, risk: 'medium', message: 'Tanh activation can saturate' },
        { pattern: /F\.softmax\(/g, risk: 'medium', message: 'Softmax can overflow without proper scaling' },
        
        // Operations prone to NaN
        { pattern: /torch\.log\(/g, risk: 'high', message: 'Log of zero or negative values causes NaN' },
        { pattern: /torch\.sqrt\(/g, risk: 'medium', message: 'Square root of negative values causes NaN' },
        { pattern: /torch\.div\(/g, risk: 'high', message: 'Division by zero causes NaN/Inf' },
        { pattern: /\/(?!\*)/g, risk: 'high', message: 'Division operation - check for zero denominators' },
        
        // Loss functions
        { pattern: /F\.cross_entropy\(/g, risk: 'medium', message: 'Cross entropy can explode with extreme logits' },
        { pattern: /F\.nll_loss\(/g, risk: 'medium', message: 'NLL loss requires log probabilities' },
        { pattern: /F\.mse_loss\(/g, risk: 'low', message: 'MSE can grow very large' },
        
        // Batch normalization without proper setup
        { pattern: /nn\.BatchNorm[12]d\([^)]*\)/g, risk: 'medium', message: 'BatchNorm requires proper training/eval mode' },
        
        // Large learning rates patterns
        { pattern: /lr\s*=\s*[1-9]\d*\.?\d*/g, risk: 'high', message: 'Large learning rate can cause instability' },
        { pattern: /learning_rate\s*=\s*[1-9]\d*\.?\d*/g, risk: 'high', message: 'Large learning rate can cause instability' },
        
        // Gradient operations
        { pattern: /\.backward\(\)/g, risk: 'medium', message: 'Check for gradient explosion/vanishing' },
        { pattern: /torch\.autograd\.grad\(/g, risk: 'medium', message: 'Manual gradient computation can be unstable' }
    ];

    private decorationTypes = {
        high: vscode.window.createTextEditorDecorationType({
            textDecoration: 'underline wavy',
            color: '#ff4444',
            backgroundColor: 'rgba(255, 68, 68, 0.1)',
            border: '1px solid rgba(255, 68, 68, 0.3)',
            borderRadius: '3px'
        }),
        medium: vscode.window.createTextEditorDecorationType({
            textDecoration: 'underline wavy',
            color: '#ffaa00',
            backgroundColor: 'rgba(255, 170, 0, 0.1)',
            border: '1px solid rgba(255, 170, 0, 0.3)',
            borderRadius: '3px'
        }),
        low: vscode.window.createTextEditorDecorationType({
            textDecoration: 'underline',
            color: '#ffdd00',
            backgroundColor: 'rgba(255, 221, 0, 0.05)'
        })
    };

    async detectNaNProne(document: vscode.TextDocument) {
        if (!vscode.workspace.getConfiguration('mlTools').get('enableNaNDetection')) {
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== document) {
            return;
        }

        const text = document.getText();
        const detections = this.analyzeForNaNRisks(text);
        
        this.applyDecorations(editor, detections);
    }

    private analyzeForNaNRisks(text: string): Array<{
        range: vscode.Range,
        risk: 'high' | 'medium' | 'low',
        message: string,
        suggestion?: string
    }> {
        const lines = text.split('\n');
        const detections: Array<{
            range: vscode.Range,
            risk: 'high' | 'medium' | 'low',
            message: string,
            suggestion?: string
        }> = [];

        lines.forEach((line, lineIndex) => {
            this.nanPronePatterns.forEach(({ pattern, risk, message }) => {
                pattern.lastIndex = 0; // Reset regex
                let match;
                
                while ((match = pattern.exec(line)) !== null) {
                    const startPos = match.index;
                    const endPos = match.index + match[0].length;
                    
                    const range = new vscode.Range(
                        lineIndex, startPos,
                        lineIndex, endPos
                    );

                    const suggestion = this.getSuggestion(match[0], risk);
                    
                    detections.push({
                        range,
                        risk: risk as 'high' | 'medium' | 'low',
                        message,
                        suggestion
                    });
                }
            });

            // Additional context-aware analysis
            const contextRisks = this.analyzeContextualRisks(line, lineIndex);
            detections.push(...contextRisks);
        });

        return detections;
    }

    private analyzeContextualRisks(line: string, lineIndex: number): Array<{
        range: vscode.Range,
        risk: 'high' | 'medium' | 'low',
        message: string,
        suggestion?: string
    }> {
        const risks: Array<{
            range: vscode.Range,
            risk: 'high' | 'medium' | 'low',
            message: string,
            suggestion?: string
        }> = [];

        // Check for uninitialized weights
        if (line.includes('nn.Linear') && !line.includes('weight_init') && !line.includes('xavier') && !line.includes('kaiming')) {
            const match = line.match(/nn\.Linear\([^)]*\)/);
            if (match) {
                const startPos = line.indexOf(match[0]);
                const endPos = startPos + match[0].length;
                
                risks.push({
                    range: new vscode.Range(lineIndex, startPos, lineIndex, endPos),
                    risk: 'medium',
                    message: 'Linear layer without explicit weight initialization',
                    suggestion: 'Consider using Xavier or Kaiming initialization'
                });
            }
        }

        // Check for missing gradient clipping in RNN/LSTM training
        if ((line.includes('LSTM') || line.includes('GRU')) && !line.includes('clip_grad')) {
            risks.push({
                range: new vscode.Range(lineIndex, 0, lineIndex, line.length),
                risk: 'high',
                message: 'RNN/LSTM without gradient clipping',
                suggestion: 'Add torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm)'
            });
        }

        // Check for batch size of 1 with BatchNorm
        if (line.includes('BatchNorm') && line.includes('batch_size=1')) {
            risks.push({
                range: new vscode.Range(lineIndex, 0, lineIndex, line.length),
                risk: 'high',
                message: 'BatchNorm with batch size 1 causes division by zero',
                suggestion: 'Use GroupNorm or LayerNorm instead'
            });
        }

        return risks;
    }

    private getSuggestion(pattern: string, risk: string): string {
        const suggestions: { [key: string]: string } = {
            'nn.Sigmoid()': 'Consider using nn.ReLU() or nn.GELU() instead',
            'nn.Tanh()': 'Consider using nn.ReLU() or add residual connections',
            'F.sigmoid': 'Use torch.sigmoid with gradient clipping',
            'torch.log': 'Add epsilon: torch.log(x + 1e-8)',
            'torch.sqrt': 'Use torch.sqrt(torch.clamp(x, min=0))',
            'torch.div': 'Add epsilon to denominator or use torch.where',
            'nn.LSTM': 'Add gradient clipping and proper initialization',
            'nn.GRU': 'Add gradient clipping and proper initialization',
            'F.cross_entropy': 'Use label smoothing or gradient clipping',
            'lr=': 'Start with smaller learning rate (1e-3 to 1e-4)',
            'learning_rate=': 'Use learning rate scheduler'
        };

        for (const [key, suggestion] of Object.entries(suggestions)) {
            if (pattern.includes(key)) {
                return suggestion;
            }
        }

        return 'Review this pattern for potential numerical instability';
    }

    private applyDecorations(editor: vscode.TextEditor, detections: Array<{
        range: vscode.Range,
        risk: 'high' | 'medium' | 'low',
        message: string,
        suggestion?: string
    }>) {
        // Clear existing decorations
        Object.values(this.decorationTypes).forEach(decoration => {
            editor.setDecorations(decoration, []);
        });

        // Group detections by risk level
        const groupedDetections = {
            high: [] as vscode.DecorationOptions[],
            medium: [] as vscode.DecorationOptions[],
            low: [] as vscode.DecorationOptions[]
        };

        detections.forEach(detection => {
            const hoverMessage = new vscode.MarkdownString();
            hoverMessage.isTrusted = true;
            hoverMessage.appendMarkdown(`**⚠️ NaN Risk (${detection.risk.toUpperCase()})**\n\n`);
            hoverMessage.appendMarkdown(`${detection.message}\n\n`);
            
            if (detection.suggestion) {
                hoverMessage.appendMarkdown(`**💡 Suggestion:** ${detection.suggestion}\n\n`);
            }
            
            hoverMessage.appendMarkdown(`[Fix Automatically](command:mlTools.fixNaNRisk?${encodeURIComponent(JSON.stringify({
                range: detection.range,
                suggestion: detection.suggestion
            }))}) | [Learn More](https://pytorch.org/docs/stable/notes/numerical_accuracy.html)`);

            groupedDetections[detection.risk].push({
                range: detection.range,
                hoverMessage
            });
        });

        // Apply decorations
        editor.setDecorations(this.decorationTypes.high, groupedDetections.high);
        editor.setDecorations(this.decorationTypes.medium, groupedDetections.medium);
        editor.setDecorations(this.decorationTypes.low, groupedDetections.low);
    }

    // Auto-fix common NaN risks
    async fixNaNRisk(args: { range: vscode.Range, suggestion: string }) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const text = document.getText(args.range);
        const fixedText = this.applyAutoFix(text, args.suggestion);

        if (fixedText !== text) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, args.range, fixedText);
            await vscode.workspace.applyEdit(edit);

            vscode.window.showInformationMessage('🔧 Applied NaN risk fix');
        }
    }

    private applyAutoFix(text: string, suggestion: string): string {
        // Simple auto-fixes for common patterns
        const fixes: { [key: string]: (text: string) => string } = {
            'torch.log': (text) => text.replace(/torch\.log\(([^)]+)\)/, 'torch.log($1 + 1e-8)'),
            'torch.sqrt': (text) => text.replace(/torch\.sqrt\(([^)]+)\)/, 'torch.sqrt(torch.clamp($1, min=0))'),
            'nn.Sigmoid()': (text) => text.replace(/nn\.Sigmoid\(\)/, 'nn.ReLU()'),
            'F.sigmoid': (text) => text.replace(/F\.sigmoid\(([^)]+)\)/, 'F.relu($1)'),
            'division': (text) => text.replace(/\/\s*([^\/\*\n;]+)/, '/ (torch.clamp($1, min=1e-8))')
        };

        for (const [pattern, fixFunction] of Object.entries(fixes)) {
            if (suggestion.toLowerCase().includes(pattern.toLowerCase()) || text.includes(pattern)) {
                return fixFunction(text);
            }
        }

        return text;
    }

    // Generate NaN safety report
    async generateSafetyReport() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        const detections = this.analyzeForNaNRisks(text);

        const report = this.createSafetyReport(detections);
        this.showReportPanel(report);
    }

    private createSafetyReport(detections: Array<{
        range: vscode.Range,
        risk: 'high' | 'medium' | 'low',
        message: string,
        suggestion?: string
    }>): string {
        const riskCounts = {
            high: detections.filter(d => d.risk === 'high').length,
            medium: detections.filter(d => d.risk === 'medium').length,
            low: detections.filter(d => d.risk === 'low').length
        };

        const totalRisks = riskCounts.high + riskCounts.medium + riskCounts.low;
        const riskScore = (riskCounts.high * 3 + riskCounts.medium * 2 + riskCounts.low * 1) / Math.max(totalRisks, 1);

        let safetyGrade = 'A';
        if (riskScore > 2.5) safetyGrade = 'D';
        else if (riskScore > 2) safetyGrade = 'C';
        else if (riskScore > 1.5) safetyGrade = 'B';

        return `
# 🛡️ NaN Safety Report

## Overall Safety Grade: ${safetyGrade}
**Risk Score:** ${riskScore.toFixed(2)}/3.0

## Risk Summary
- 🔴 **High Risk:** ${riskCounts.high} issues
- 🟡 **Medium Risk:** ${riskCounts.medium} issues  
- 🟢 **Low Risk:** ${riskCounts.low} issues

## Detailed Findings
${detections.map((detection, index) => `
### ${index + 1}. Line ${detection.range.start.line + 1} - ${detection.risk.toUpperCase()} Risk
**Issue:** ${detection.message}
${detection.suggestion ? `**Suggestion:** ${detection.suggestion}` : ''}
`).join('')}

## Recommendations
${riskCounts.high > 0 ? '- 🚨 Address high-risk issues immediately' : ''}
${riskCounts.medium > 3 ? '- ⚠️ Consider refactoring medium-risk patterns' : ''}
- 🧪 Add numerical stability tests
- 📊 Monitor loss curves for NaN/Inf values
- 🔍 Use gradient clipping for RNN/LSTM models
        `;
    }

    private showReportPanel(report: string) {
        const panel = vscode.window.createWebviewPanel(
            'nanSafetyReport',
            '🛡️ NaN Safety Report',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );

        panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px; 
            line-height: 1.6;
            color: var(--vscode-editor-foreground);
            background: var(--vscode-editor-background);
        }
        h1, h2, h3 { color: var(--vscode-textLink-foreground); }
        code { 
            background: var(--vscode-textBlockQuote-background); 
            padding: 2px 4px; 
            border-radius: 3px; 
        }
        .high-risk { color: #ff4444; }
        .medium-risk { color: #ffaa00; }
        .low-risk { color: #ffdd00; }
    </style>
</head>
<body>
    <div id="content"></div>
    <script>
        const report = ${JSON.stringify(report)};
        document.getElementById('content').innerHTML = 
            report.replace(/\\n/g, '<br>')
                  .replace(/🔴/g, '<span class="high-risk">🔴</span>')
                  .replace(/🟡/g, '<span class="medium-risk">🟡</span>')
                  .replace(/🟢/g, '<span class="low-risk">🟢</span>');
    </script>
</body>
</html>`;
    }
}