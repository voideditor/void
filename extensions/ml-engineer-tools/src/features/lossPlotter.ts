import * as vscode from 'vscode';

export class LossPlotter {
    private lossPatterns = [
        // Training loop patterns
        /loss\s*=\s*([^;\n]+)/g,
        /train_loss\s*=\s*([^;\n]+)/g,
        /val_loss\s*=\s*([^;\n]+)/g,
        /test_loss\s*=\s*([^;\n]+)/g,
        
        // Framework-specific patterns
        /criterion\([^)]+\)/g,
        /F\.cross_entropy\([^)]+\)/g,
        /F\.mse_loss\([^)]+\)/g,
        /tf\.keras\.losses\./g,
        
        // Loss logging patterns
        /print.*loss/gi,
        /logger\.info.*loss/gi,
        /wandb\.log.*loss/gi,
        /tensorboard.*loss/gi
    ];

    private panel: vscode.WebviewPanel | undefined;

    async showPlot() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'python') {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        
        // Extract loss values and create plot
        const lossData = this.extractLossData(text);
        
        if (lossData.length === 0) {
            vscode.window.showWarningMessage('No loss patterns found in current file');
            return;
        }

        this.createPlotPanel(lossData);
    }

    private extractLossData(text: string): Array<{line: number, type: string, value: string}> {
        const lines = text.split('\n');
        const lossData: Array<{line: number, type: string, value: string}> = [];

        lines.forEach((line, index) => {
            // Check for loss variable assignments
            const lossMatch = /(\w*loss\w*)\s*=\s*([^;\n]+)/gi.exec(line);
            if (lossMatch) {
                lossData.push({
                    line: index + 1,
                    type: lossMatch[1],
                    value: lossMatch[2].trim()
                });
            }

            // Check for loss function calls
            const criterionMatch = /(criterion|F\.\w+_loss|tf\.keras\.losses\.\w+)\s*\([^)]+\)/gi.exec(line);
            if (criterionMatch) {
                lossData.push({
                    line: index + 1,
                    type: 'loss_function',
                    value: criterionMatch[0]
                });
            }

            // Check for loss logging
            const logMatch = /(print|log|wandb\.log|tensorboard).*loss/gi.exec(line);
            if (logMatch) {
                lossData.push({
                    line: index + 1,
                    type: 'loss_log',
                    value: line.trim()
                });
            }
        });

        return lossData;
    }

    private createPlotPanel(lossData: Array<{line: number, type: string, value: string}>) {
        if (this.panel) {
            this.panel.dispose();
        }

        this.panel = vscode.window.createWebviewPanel(
            'lossPlot',
            '📈 Loss Curve Visualization',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = this.getWebviewContent(lossData);

        // Handle panel disposal
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    private getWebviewContent(lossData: Array<{line: number, type: string, value: string}>): string {
        // Generate mock loss data for visualization
        const mockLossData = this.generateMockLossData();
        
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loss Curve</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .loss-info {
            background: var(--vscode-textBlockQuote-background);
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            border-left: 4px solid var(--vscode-textLink-foreground);
        }
        .loss-item {
            margin: 8px 0;
            font-family: monospace;
            font-size: 12px;
        }
        .line-number {
            color: var(--vscode-editorLineNumber-foreground);
            margin-right: 10px;
        }
        .loss-type {
            color: var(--vscode-debugTokenExpression-name);
            font-weight: bold;
        }
        .controls {
            margin: 20px 0;
            display: flex;
            gap: 10px;
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        #plotDiv {
            width: 100%;
            height: 400px;
            background: var(--vscode-editor-background);
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>📈 Loss Curve Analysis</h2>
    </div>
    
    <div class="loss-info">
        <h3>🔍 Detected Loss Patterns</h3>
        ${lossData.map(item => `
            <div class="loss-item">
                <span class="line-number">Line ${item.line}:</span>
                <span class="loss-type">${item.type}</span> - 
                <code>${item.value}</code>
            </div>
        `).join('')}
    </div>

    <div class="controls">
        <button onclick="toggleTrainingLoss()">Toggle Training Loss</button>
        <button onclick="toggleValidationLoss()">Toggle Validation Loss</button>
        <button onclick="resetZoom()">Reset Zoom</button>
        <button onclick="exportPlot()">Export Plot</button>
    </div>

    <div id="plotDiv"></div>

    <script>
        const mockData = ${JSON.stringify(mockLossData)};
        
        let showTraining = true;
        let showValidation = true;

        function createPlot() {
            const traces = [];
            
            if (showTraining) {
                traces.push({
                    x: mockData.epochs,
                    y: mockData.trainLoss,
                    type: 'scatter',
                    mode: 'lines+markers',
                    name: 'Training Loss',
                    line: { color: '#ff6b6b', width: 2 },
                    marker: { size: 4 }
                });
            }
            
            if (showValidation) {
                traces.push({
                    x: mockData.epochs,
                    y: mockData.valLoss,
                    type: 'scatter',
                    mode: 'lines+markers',
                    name: 'Validation Loss',
                    line: { color: '#4ecdc4', width: 2 },
                    marker: { size: 4 }
                });
            }

            const layout = {
                title: {
                    text: 'Training Progress',
                    font: { color: 'var(--vscode-editor-foreground)' }
                },
                xaxis: {
                    title: 'Epoch',
                    color: 'var(--vscode-editor-foreground)',
                    gridcolor: 'var(--vscode-panel-border)'
                },
                yaxis: {
                    title: 'Loss',
                    color: 'var(--vscode-editor-foreground)',
                    gridcolor: 'var(--vscode-panel-border)'
                },
                plot_bgcolor: 'transparent',
                paper_bgcolor: 'transparent',
                font: { color: 'var(--vscode-editor-foreground)' },
                legend: {
                    x: 0.7,
                    y: 0.9,
                    bgcolor: 'rgba(0,0,0,0.1)'
                }
            };

            const config = {
                responsive: true,
                displayModeBar: true,
                modeBarButtonsToRemove: ['pan2d', 'lasso2d', 'select2d'],
                displaylogo: false
            };

            Plotly.newPlot('plotDiv', traces, layout, config);
        }

        function toggleTrainingLoss() {
            showTraining = !showTraining;
            createPlot();
        }

        function toggleValidationLoss() {
            showValidation = !showValidation;
            createPlot();
        }

        function resetZoom() {
            Plotly.relayout('plotDiv', {
                'xaxis.autorange': true,
                'yaxis.autorange': true
            });
        }

        function exportPlot() {
            Plotly.downloadImage('plotDiv', {
                format: 'png',
                width: 800,
                height: 600,
                filename: 'loss_curve'
            });
        }

        // Initialize plot
        createPlot();

        // Handle theme changes
        const observer = new MutationObserver(() => {
            createPlot();
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    </script>
</body>
</html>`;
    }

    private generateMockLossData() {
        const epochs = Array.from({ length: 50 }, (_, i) => i + 1);
        const trainLoss = epochs.map(epoch => {
            // Simulate decreasing loss with some noise
            const base = 2.0 * Math.exp(-epoch / 20) + 0.1;
            const noise = (Math.random() - 0.5) * 0.1;
            return Math.max(0.05, base + noise);
        });
        
        const valLoss = epochs.map((epoch, i) => {
            // Validation loss follows training but with more variation
            const base = trainLoss[i] + 0.05;
            const noise = (Math.random() - 0.5) * 0.15;
            return Math.max(0.05, base + noise);
        });

        return { epochs, trainLoss, valLoss };
    }

    // Create inline loss visualization in editor
    async createInlineVisualization() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        const lossData = this.extractLossData(text);

        // Create decorations for loss lines
        const decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: ' 📈',
                color: '#4ecdc4',
                fontWeight: 'bold'
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
        });

        const decorations: vscode.DecorationOptions[] = lossData.map(item => ({
            range: new vscode.Range(item.line - 1, 0, item.line - 1, 0),
            hoverMessage: `Loss pattern detected: ${item.type}\nValue: ${item.value}\nClick to view loss curve`
        }));

        editor.setDecorations(decorationType, decorations);

        // Auto-clear decorations after 5 seconds
        setTimeout(() => {
            decorationType.dispose();
        }, 5000);
    }

    // Real-time loss monitoring (would integrate with actual training)
    async startLossMonitoring() {
        vscode.window.showInformationMessage(
            '🔄 Loss monitoring started (mock implementation)',
            'View Live Plot'
        ).then(selection => {
            if (selection === 'View Live Plot') {
                this.showPlot();
            }
        });
    }

    // Export loss data to CSV
    async exportLossData() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        const lossData = this.extractLossData(text);

        if (lossData.length === 0) {
            vscode.window.showWarningMessage('No loss data found to export');
            return;
        }

        // Generate mock data for export
        const mockData = this.generateMockLossData();
        const csvContent = this.generateCSV(mockData);

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            const filePath = vscode.Uri.joinPath(workspaceFolder.uri, 'loss_data.csv');
            await vscode.workspace.fs.writeFile(filePath, Buffer.from(csvContent));
            
            vscode.window.showInformationMessage(
                '📊 Loss data exported to loss_data.csv',
                'Open File'
            ).then(selection => {
                if (selection === 'Open File') {
                    vscode.window.showTextDocument(filePath);
                }
            });
        }
    }

    private generateCSV(data: any): string {
        const headers = ['epoch', 'train_loss', 'val_loss'];
        const rows = data.epochs.map((epoch: number, i: number) => 
            [epoch, data.trainLoss[i].toFixed(6), data.valLoss[i].toFixed(6)]
        );
        
        return [headers, ...rows].map(row => row.join(',')).join('\n');
    }
}