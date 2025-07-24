import * as vscode from 'vscode';

export class MemoryMonitor {
    private memoryIntensivePatterns = [
        // Model creation patterns
        { pattern: /nn\.(?:Linear|Conv2d|Conv1d|ConvTranspose2d|LSTM|GRU|Transformer)\s*\([^)]+\)/g, type: 'model_layer', multiplier: 1.0 },
        { pattern: /torch\.(?:zeros|ones|randn|rand|empty|full)\s*\(\s*\[([^\]]+)\]/g, type: 'tensor_creation', multiplier: 1.0 },
        { pattern: /torch\.tensor\s*\([^)]+\)/g, type: 'tensor_creation', multiplier: 0.5 },
        
        // Data loading patterns
        { pattern: /DataLoader\s*\([^)]+batch_size\s*=\s*(\d+)/g, type: 'data_loading', multiplier: 2.0 },
        { pattern: /\.cuda\(\)/g, type: 'gpu_transfer', multiplier: 1.0 },
        { pattern: /\.to\(['"]cuda['"]\)/g, type: 'gpu_transfer', multiplier: 1.0 },
        
        // Training operations
        { pattern: /\.backward\(\)/g, type: 'gradient_computation', multiplier: 2.0 },
        { pattern: /optimizer\.step\(\)/g, type: 'optimizer_step', multiplier: 0.5 },
        
        // Attention mechanisms
        { pattern: /(?:MultiheadAttention|SelfAttention|CrossAttention)\s*\([^)]+\)/g, type: 'attention', multiplier: 3.0 },
        
        // Batch operations
        { pattern: /torch\.(?:cat|stack|repeat|expand)\s*\([^)]+\)/g, type: 'batch_operation', multiplier: 1.5 }
    ];

    private decorationType = vscode.window.createTextEditorDecorationType({
        after: {
            margin: '0 0 0 20px',
            fontWeight: 'bold',
            fontStyle: 'italic'
        }
    });

    async updateDecorations(editor: vscode.TextEditor) {
        if (!vscode.workspace.getConfiguration('mlTools').get('enableMemoryMonitoring')) {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        const memoryUsages = this.analyzeMemoryUsage(text);
        
        const decorations: vscode.DecorationOptions[] = memoryUsages.map(usage => ({
            range: new vscode.Range(usage.line, 0, usage.line, 0),
            renderOptions: {
                after: {
                    contentText: ` 🧠 ${usage.estimatedMemory}`,
                    color: this.getMemoryColor(usage.severity),
                    backgroundColor: this.getMemoryBackgroundColor(usage.severity)
                }
            },
            hoverMessage: this.createMemoryHoverMessage(usage)
        }));

        editor.setDecorations(this.decorationType, decorations);
    }

    private analyzeMemoryUsage(text: string): Array<{
        line: number,
        operation: string,
        estimatedMemory: string,
        severity: 'low' | 'medium' | 'high',
        details: string
    }> {
        const lines = text.split('\n');
        const usages: Array<{
            line: number,
            operation: string,
            estimatedMemory: string,
            severity: 'low' | 'medium' | 'high',
            details: string
        }> = [];

        lines.forEach((line, lineIndex) => {
            this.memoryIntensivePatterns.forEach(({ pattern, type, multiplier }) => {
                pattern.lastIndex = 0; // Reset regex
                let match;
                
                while ((match = pattern.exec(line)) !== null) {
                    const memoryEstimate = this.estimateMemoryUsage(match[0], type, multiplier);
                    if (memoryEstimate.bytes > 1024 * 1024) { // Only show if > 1MB
                        usages.push({
                            line: lineIndex,
                            operation: match[0],
                            estimatedMemory: memoryEstimate.formatted,
                            severity: this.getMemorySeverity(memoryEstimate.bytes),
                            details: `${type} operation - ${memoryEstimate.explanation}`
                        });
                    }
                }
            });

            // Analyze batch size impact
            const batchSizeMatch = /batch_size\s*=\s*(\d+)/g.exec(line);
            if (batchSizeMatch) {
                const batchSize = parseInt(batchSizeMatch[1]);
                if (batchSize > 32) {
                    const memoryImpact = this.estimateBatchMemoryImpact(batchSize);
                    usages.push({
                        line: lineIndex,
                        operation: `batch_size=${batchSize}`,
                        estimatedMemory: memoryImpact.formatted,
                        severity: this.getMemorySeverity(memoryImpact.bytes),
                        details: `Large batch size - consider reducing if OOM occurs`
                    });
                }
            }
        });

        return usages;
    }

    private estimateMemoryUsage(operation: string, type: string, multiplier: number): {
        bytes: number,
        formatted: string,
        explanation: string
    } {
        let baseBytes = 0;
        let explanation = '';

        switch (type) {
            case 'model_layer':
                baseBytes = this.estimateLayerMemory(operation);
                explanation = 'Layer parameters + activations';
                break;
            case 'tensor_creation':
                baseBytes = this.estimateTensorMemory(operation);
                explanation = 'Tensor storage';
                break;
            case 'data_loading':
                baseBytes = this.estimateDataLoaderMemory(operation);
                explanation = 'Batch data in memory';
                break;
            case 'gpu_transfer':
                baseBytes = 50 * 1024 * 1024; // Assume 50MB average
                explanation = 'GPU memory allocation';
                break;
            case 'gradient_computation':
                baseBytes = 100 * 1024 * 1024; // Assume 100MB for gradients
                explanation = 'Gradient storage (2x forward pass)';
                break;
            case 'attention':
                baseBytes = this.estimateAttentionMemory(operation);
                explanation = 'Attention matrix storage';
                break;
            case 'batch_operation':
                baseBytes = 20 * 1024 * 1024; // Assume 20MB
                explanation = 'Temporary tensor operations';
                break;
            default:
                baseBytes = 10 * 1024 * 1024; // Default 10MB
                explanation = 'Estimated operation memory';
        }

        const totalBytes = Math.floor(baseBytes * multiplier);
        return {
            bytes: totalBytes,
            formatted: this.formatBytes(totalBytes),
            explanation
        };
    }

    private estimateLayerMemory(operation: string): number {
        // Extract parameters from layer definition
        const linearMatch = /Linear\s*\(\s*(\d+)\s*,\s*(\d+)/g.exec(operation);
        if (linearMatch) {
            const inputSize = parseInt(linearMatch[1]);
            const outputSize = parseInt(linearMatch[2]);
            // Parameters: input_size * output_size * 4 bytes (float32) + bias
            return (inputSize * outputSize + outputSize) * 4;
        }

        const convMatch = /Conv2d\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g.exec(operation);
        if (convMatch) {
            const inChannels = parseInt(convMatch[1]);
            const outChannels = parseInt(convMatch[2]);
            const kernelSize = parseInt(convMatch[3]);
            // Parameters: in_channels * out_channels * kernel_size^2 * 4 bytes
            return inChannels * outChannels * kernelSize * kernelSize * 4;
        }

        const lstmMatch = /LSTM\s*\(\s*(\d+)\s*,\s*(\d+)/g.exec(operation);
        if (lstmMatch) {
            const inputSize = parseInt(lstmMatch[1]);
            const hiddenSize = parseInt(lstmMatch[2]);
            // LSTM has 4 gates, each with input and hidden weights
            return 4 * (inputSize * hiddenSize + hiddenSize * hiddenSize) * 4;
        }

        return 1024 * 1024; // Default 1MB
    }

    private estimateTensorMemory(operation: string): number {
        // Extract shape from tensor creation
        const shapeMatch = /\[([^\]]+)\]/g.exec(operation);
        if (shapeMatch) {
            const dimensions = shapeMatch[1].split(',').map(d => parseInt(d.trim())).filter(d => !isNaN(d));
            if (dimensions.length > 0) {
                const totalElements = dimensions.reduce((acc, dim) => acc * dim, 1);
                return totalElements * 4; // Assume float32
            }
        }

        // Extract from torch.zeros, etc.
        const torchMatch = /torch\.\w+\s*\(\s*([^,)]+)/g.exec(operation);
        if (torchMatch) {
            const sizeStr = torchMatch[1].trim();
            if (sizeStr.includes('(') && sizeStr.includes(')')) {
                const dimensions = sizeStr.match(/\d+/g);
                if (dimensions) {
                    const totalElements = dimensions.reduce((acc, dim) => acc * parseInt(dim), 1);
                    return totalElements * 4;
                }
            }
        }

        return 1024 * 1024; // Default 1MB
    }

    private estimateDataLoaderMemory(operation: string): number {
        const batchSizeMatch = /batch_size\s*=\s*(\d+)/g.exec(operation);
        if (batchSizeMatch) {
            const batchSize = parseInt(batchSizeMatch[1]);
            // Assume average sample size of 1MB (images, text, etc.)
            return batchSize * 1024 * 1024;
        }
        return 32 * 1024 * 1024; // Default batch memory
    }

    private estimateAttentionMemory(operation: string): number {
        // Attention memory is O(sequence_length^2 * batch_size * num_heads)
        // Assume default values: seq_len=512, batch=32, heads=8
        const seqLen = 512;
        const batchSize = 32;
        const numHeads = 8;
        return seqLen * seqLen * batchSize * numHeads * 4; // float32
    }

    private estimateBatchMemoryImpact(batchSize: number): { bytes: number, formatted: string } {
        // Estimate memory impact of large batch size
        const bytesPerSample = 1024 * 1024; // Assume 1MB per sample
        const totalBytes = batchSize * bytesPerSample;
        return {
            bytes: totalBytes,
            formatted: this.formatBytes(totalBytes)
        };
    }

    private formatBytes(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        } else if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        } else if (bytes < 1024 * 1024 * 1024) {
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        } else {
            return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        }
    }

    private getMemorySeverity(bytes: number): 'low' | 'medium' | 'high' {
        if (bytes > 1024 * 1024 * 1024) { // > 1GB
            return 'high';
        } else if (bytes > 100 * 1024 * 1024) { // > 100MB
            return 'medium';
        } else {
            return 'low';
        }
    }

    private getMemoryColor(severity: 'low' | 'medium' | 'high'): string {
        switch (severity) {
            case 'high': return '#ff4444';
            case 'medium': return '#ffaa00';
            case 'low': return '#4ecdc4';
        }
    }

    private getMemoryBackgroundColor(severity: 'low' | 'medium' | 'high'): string {
        switch (severity) {
            case 'high': return 'rgba(255, 68, 68, 0.1)';
            case 'medium': return 'rgba(255, 170, 0, 0.1)';
            case 'low': return 'rgba(78, 205, 196, 0.1)';
        }
    }

    private createMemoryHoverMessage(usage: {
        operation: string,
        estimatedMemory: string,
        severity: 'low' | 'medium' | 'high',
        details: string
    }): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        
        markdown.appendMarkdown(`**🧠 Memory Usage Estimate**\n\n`);
        markdown.appendMarkdown(`**Operation:** \`${usage.operation}\`\n\n`);
        markdown.appendMarkdown(`**Estimated Memory:** \`${usage.estimatedMemory}\`\n\n`);
        markdown.appendMarkdown(`**Severity:** ${usage.severity.toUpperCase()}\n\n`);
        markdown.appendMarkdown(`**Details:** ${usage.details}\n\n`);
        
        if (usage.severity === 'high') {
            markdown.appendMarkdown(`⚠️ **High memory usage detected!**\n\n`);
            markdown.appendMarkdown(`Consider:\n`);
            markdown.appendMarkdown(`- Reducing batch size\n`);
            markdown.appendMarkdown(`- Using gradient checkpointing\n`);
            markdown.appendMarkdown(`- Implementing model parallelism\n\n`);
        }
        
        markdown.appendMarkdown(`[Check GPU Memory](command:mlTools.checkMemoryUsage) | [Optimize Memory](command:mlTools.optimizeMemory)`);
        
        return markdown;
    }

    async checkUsage() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        const memoryUsages = this.analyzeMemoryUsage(text);
        
        const totalMemory = memoryUsages.reduce((sum, usage) => {
            const bytes = this.parseMemoryString(usage.estimatedMemory);
            return sum + bytes;
        }, 0);

        const report = this.generateMemoryReport(memoryUsages, totalMemory);
        this.showMemoryReportPanel(report);
    }

    private parseMemoryString(memoryStr: string): number {
        const match = /([0-9.]+)\s*(B|KB|MB|GB)/g.exec(memoryStr);
        if (match) {
            const value = parseFloat(match[1]);
            const unit = match[2];
            switch (unit) {
                case 'B': return value;
                case 'KB': return value * 1024;
                case 'MB': return value * 1024 * 1024;
                case 'GB': return value * 1024 * 1024 * 1024;
            }
        }
        return 0;
    }

    private generateMemoryReport(usages: Array<{
        line: number,
        operation: string,
        estimatedMemory: string,
        severity: 'low' | 'medium' | 'high',
        details: string
    }>, totalMemory: number): string {
        const severityCounts = {
            high: usages.filter(u => u.severity === 'high').length,
            medium: usages.filter(u => u.severity === 'medium').length,
            low: usages.filter(u => u.severity === 'low').length
        };

        return `
# 🧠 Memory Usage Report

## Summary
**Total Estimated Memory:** ${this.formatBytes(totalMemory)}
**Operations Analyzed:** ${usages.length}

### Severity Breakdown
- 🔴 **High Memory:** ${severityCounts.high} operations
- 🟡 **Medium Memory:** ${severityCounts.medium} operations  
- 🟢 **Low Memory:** ${severityCounts.low} operations

## Detailed Analysis
${usages.map((usage, index) => `
### ${index + 1}. Line ${usage.line + 1} - ${usage.severity.toUpperCase()} Memory
**Operation:** \`${usage.operation}\`
**Estimated Memory:** \`${usage.estimatedMemory}\`
**Details:** ${usage.details}
`).join('')}

## Optimization Recommendations
${severityCounts.high > 0 ? '- 🚨 Consider reducing batch sizes for high-memory operations' : ''}
${totalMemory > 8 * 1024 * 1024 * 1024 ? '- ⚠️ Total memory usage exceeds 8GB - consider model optimization' : ''}
- 🔧 Use gradient checkpointing for large models
- 📊 Monitor GPU memory usage during training
- 🔄 Consider mixed precision training (FP16)
        `;
    }

    private showMemoryReportPanel(report: string) {
        const panel = vscode.window.createWebviewPanel(
            'memoryReport',
            '🧠 Memory Usage Report',
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
        .high-memory { color: #ff4444; }
        .medium-memory { color: #ffaa00; }
        .low-memory { color: #4ecdc4; }
    </style>
</head>
<body>
    <div id="content"></div>
    <script>
        const report = ${JSON.stringify(report)};
        document.getElementById('content').innerHTML = 
            report.replace(/\\n/g, '<br>')
                  .replace(/🔴/g, '<span class="high-memory">🔴</span>')
                  .replace(/🟡/g, '<span class="medium-memory">🟡</span>')
                  .replace(/🟢/g, '<span class="low-memory">🟢</span>');
    </script>
</body>
</html>`;
    }
}