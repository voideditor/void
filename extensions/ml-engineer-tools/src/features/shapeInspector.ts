import * as vscode from 'vscode';

export class ShapeInspector implements vscode.HoverProvider {
    private tensorPatterns = [
        // PyTorch patterns
        /torch\.(?:zeros|ones|randn|rand|empty|full)\s*\(\s*([^)]+)\)/g,
        /torch\.tensor\s*\(\s*([^,)]+)(?:,\s*dtype=[^,)]+)?(?:,\s*device=[^,)]+)?\)/g,
        /\.(?:view|reshape|permute|transpose)\s*\(\s*([^)]+)\)/g,
        /nn\.(?:Linear|Conv2d|Conv1d|ConvTranspose2d)\s*\(\s*([^)]+)\)/g,
        
        // TensorFlow patterns
        /tf\.(?:zeros|ones|random\.normal|random\.uniform|constant)\s*\(\s*([^,)]+)/g,
        /tf\.Variable\s*\(\s*([^,)]+)/g,
        /tf\.reshape\s*\(\s*[^,]+,\s*([^)]+)\)/g,
        /tf\.keras\.layers\.(?:Dense|Conv2D|Conv1D)\s*\(\s*([^,)]+)/g,
        
        // NumPy patterns
        /np\.(?:zeros|ones|random\.randn|random\.rand|empty|full)\s*\(\s*([^)]+)\)/g,
        /np\.array\s*\(\s*([^,)]+)/g,
        /\.reshape\s*\(\s*([^)]+)\)/g,
    ];

    private shapeComments = new Map<string, string>();

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        if (!vscode.workspace.getConfiguration('mlTools').get('enableShapeInspection')) {
            return;
        }

        const line = document.lineAt(position.line);
        const wordRange = document.getWordRangeAtPosition(position);
        
        if (!wordRange) {
            return;
        }

        const word = document.getText(wordRange);
        const lineText = line.text;

        // Check if hovering over a tensor variable
        const tensorInfo = this.analyzeTensorShape(lineText, word, document, position);
        
        if (tensorInfo) {
            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            
            markdown.appendMarkdown(`**🔍 Tensor Shape Analysis**\n\n`);
            markdown.appendMarkdown(`**Variable:** \`${word}\`\n\n`);
            markdown.appendMarkdown(`**Shape:** \`${tensorInfo.shape}\`\n\n`);
            
            if (tensorInfo.dtype) {
                markdown.appendMarkdown(`**Data Type:** \`${tensorInfo.dtype}\`\n\n`);
            }
            
            if (tensorInfo.device) {
                markdown.appendMarkdown(`**Device:** \`${tensorInfo.device}\`\n\n`);
            }
            
            if (tensorInfo.memoryUsage) {
                markdown.appendMarkdown(`**Memory:** \`${tensorInfo.memoryUsage}\`\n\n`);
            }

            if (tensorInfo.framework) {
                markdown.appendMarkdown(`**Framework:** \`${tensorInfo.framework}\`\n\n`);
            }

            // Add quick actions
            markdown.appendMarkdown(`---\n\n`);
            markdown.appendMarkdown(`[Toggle GPU/CPU](command:mlTools.toggleGPU) | `);
            markdown.appendMarkdown(`[Check Memory](command:mlTools.checkMemoryUsage)`);

            return new vscode.Hover(markdown, wordRange);
        }

        return;
    }

    private analyzeTensorShape(lineText: string, word: string, document: vscode.TextDocument, position: vscode.Position) {
        // Look for tensor creation patterns
        for (const pattern of this.tensorPatterns) {
            pattern.lastIndex = 0; // Reset regex
            const match = pattern.exec(lineText);
            
            if (match && lineText.includes(word)) {
                const shapeInfo = this.parseShapeFromMatch(match, lineText);
                return {
                    shape: shapeInfo.shape,
                    dtype: shapeInfo.dtype,
                    device: shapeInfo.device,
                    framework: this.detectFramework(lineText),
                    memoryUsage: this.estimateMemoryUsage(shapeInfo.shape, shapeInfo.dtype)
                };
            }
        }

        // Look for variable assignments and track shapes
        const variablePattern = new RegExp(`${word}\\s*=\\s*(.+)`);
        const varMatch = variablePattern.exec(lineText);
        
        if (varMatch) {
            const assignment = varMatch[1];
            return this.analyzeAssignment(assignment, word);
        }

        // Look for method calls that might change shape
        const methodPattern = new RegExp(`${word}\\.(?:view|reshape|permute|transpose|squeeze|unsqueeze)\\s*\\(([^)]+)\\)`);
        const methodMatch = methodPattern.exec(lineText);
        
        if (methodMatch) {
            return {
                shape: this.parseShapeString(methodMatch[1]),
                framework: this.detectFramework(lineText),
                dtype: 'inferred',
                device: 'inferred'
            };
        }

        return null;
    }

    private parseShapeFromMatch(match: RegExpExecArray, lineText: string) {
        const shapeStr = match[1];
        const shape = this.parseShapeString(shapeStr);
        
        return {
            shape,
            dtype: this.extractDataType(lineText),
            device: this.extractDevice(lineText)
        };
    }

    private parseShapeString(shapeStr: string): string {
        // Clean up the shape string
        let cleaned = shapeStr.trim();
        
        // Handle common patterns
        if (cleaned.includes('[') && cleaned.includes(']')) {
            // Extract dimensions from brackets
            const dimensions = cleaned.match(/\d+/g);
            if (dimensions) {
                return `(${dimensions.join(', ')})`;
            }
        }
        
        // Handle tuple format
        if (cleaned.includes('(') && cleaned.includes(')')) {
            return cleaned;
        }
        
        // Handle comma-separated values
        if (cleaned.includes(',')) {
            const parts = cleaned.split(',').map(p => p.trim()).filter(p => /^\d+$/.test(p));
            if (parts.length > 0) {
                return `(${parts.join(', ')})`;
            }
        }
        
        // Handle single dimension
        if (/^\d+$/.test(cleaned)) {
            return `(${cleaned},)`;
        }
        
        return '(unknown)';
    }

    private extractDataType(lineText: string): string | undefined {
        const dtypePatterns = [
            /dtype\s*=\s*(torch\.\w+|tf\.\w+|\w+)/,
            /\.(?:float|int|long|double|half)\(\)/,
            /astype\s*\(\s*([^)]+)\)/
        ];
        
        for (const pattern of dtypePatterns) {
            const match = pattern.exec(lineText);
            if (match) {
                return match[1];
            }
        }
        
        return undefined;
    }

    private extractDevice(lineText: string): string | undefined {
        const devicePatterns = [
            /device\s*=\s*['"]([^'"]+)['"]/,
            /\.(?:cuda|cpu)\(\)/,
            /\.to\s*\(\s*['"]([^'"]+)['"]\)/
        ];
        
        for (const pattern of devicePatterns) {
            const match = pattern.exec(lineText);
            if (match) {
                return match[1];
            }
        }
        
        return undefined;
    }

    private detectFramework(lineText: string): string {
        if (lineText.includes('torch.') || lineText.includes('nn.')) {
            return 'PyTorch';
        }
        if (lineText.includes('tf.') || lineText.includes('tensorflow')) {
            return 'TensorFlow';
        }
        if (lineText.includes('np.') || lineText.includes('numpy')) {
            return 'NumPy';
        }
        return 'Unknown';
    }

    private estimateMemoryUsage(shape: string, dtype?: string): string {
        const dimensions = shape.match(/\d+/g);
        if (!dimensions) {
            return 'unknown';
        }
        
        const totalElements = dimensions.reduce((acc, dim) => acc * parseInt(dim), 1);
        const bytesPerElement = this.getBytesPerElement(dtype);
        const totalBytes = totalElements * bytesPerElement;
        
        if (totalBytes < 1024) {
            return `${totalBytes} bytes`;
        } else if (totalBytes < 1024 * 1024) {
            return `${(totalBytes / 1024).toFixed(1)} KB`;
        } else if (totalBytes < 1024 * 1024 * 1024) {
            return `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
        } else {
            return `${(totalBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        }
    }

    private getBytesPerElement(dtype?: string): number {
        if (!dtype) return 4; // Default to float32
        
        if (dtype.includes('float64') || dtype.includes('double')) return 8;
        if (dtype.includes('float32') || dtype.includes('float')) return 4;
        if (dtype.includes('float16') || dtype.includes('half')) return 2;
        if (dtype.includes('int64') || dtype.includes('long')) return 8;
        if (dtype.includes('int32') || dtype.includes('int')) return 4;
        if (dtype.includes('int16') || dtype.includes('short')) return 2;
        if (dtype.includes('int8') || dtype.includes('byte')) return 1;
        if (dtype.includes('bool')) return 1;
        
        return 4; // Default
    }

    private analyzeAssignment(assignment: string, variableName: string) {
        // This would analyze more complex assignments
        // For now, return basic info
        return {
            shape: '(inferred)',
            framework: this.detectFramework(assignment),
            dtype: 'inferred',
            device: 'inferred'
        };
    }
}