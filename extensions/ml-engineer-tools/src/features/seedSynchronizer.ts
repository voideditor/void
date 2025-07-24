import * as vscode from 'vscode';

export class SeedSynchronizer {
    private seedPatterns = [
        // NumPy
        { pattern: /np\.random\.seed\(\d+\)/g, replacement: 'np.random.seed(SEED)', import: 'import numpy as np' },
        
        // PyTorch
        { pattern: /torch\.manual_seed\(\d+\)/g, replacement: 'torch.manual_seed(SEED)', import: 'import torch' },
        { pattern: /torch\.cuda\.manual_seed\(\d+\)/g, replacement: 'torch.cuda.manual_seed(SEED)', import: 'import torch' },
        { pattern: /torch\.cuda\.manual_seed_all\(\d+\)/g, replacement: 'torch.cuda.manual_seed_all(SEED)', import: 'import torch' },
        
        // TensorFlow
        { pattern: /tf\.random\.set_seed\(\d+\)/g, replacement: 'tf.random.set_seed(SEED)', import: 'import tensorflow as tf' },
        { pattern: /tf\.set_random_seed\(\d+\)/g, replacement: 'tf.set_random_seed(SEED)', import: 'import tensorflow as tf' },
        
        // Python random
        { pattern: /random\.seed\(\d+\)/g, replacement: 'random.seed(SEED)', import: 'import random' },
        
        // Scikit-learn
        { pattern: /random_state\s*=\s*\d+/g, replacement: 'random_state=SEED', import: '' },
        
        // Pandas
        { pattern: /\.sample\([^)]*random_state\s*=\s*\d+/g, replacement: (match: string) => match.replace(/random_state\s*=\s*\d+/, 'random_state=SEED'), import: '' }
    ];

    async syncSeeds() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'python') {
            return;
        }

        const seedValue = vscode.workspace.getConfiguration('mlTools').get('defaultSeed', 42);
        const document = editor.document;
        const text = document.getText();
        
        const result = this.synchronizeSeeds(text, seedValue);
        
        if (result.modified) {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(text.length)
            );
            edit.replace(document.uri, fullRange, result.text);
            await vscode.workspace.applyEdit(edit);

            // Add missing imports if needed
            if (result.missingImports.length > 0) {
                await this.addMissingImports(result.missingImports);
            }

            vscode.window.showInformationMessage(
                `🎲 Synchronized ${result.changedCount} seed${result.changedCount > 1 ? 's' : ''} to ${seedValue}`,
                { modal: false }
            );
        } else {
            // No seeds found, add seed initialization block
            await this.addSeedInitialization(seedValue);
        }
    }

    private synchronizeSeeds(text: string, seedValue: number): {
        text: string,
        modified: boolean,
        changedCount: number,
        missingImports: string[]
    } {
        let result = text;
        let changedCount = 0;
        const missingImports = new Set<string>();
        const existingImports = this.getExistingImports(text);

        // Replace SEED placeholder with actual value in patterns
        const processedPatterns = this.seedPatterns.map(pattern => ({
            ...pattern,
            replacement: pattern.replacement.replace('SEED', seedValue.toString())
        }));

        // Apply each pattern
        processedPatterns.forEach(({ pattern, replacement, import: importStatement }) => {
            const matches = result.match(pattern);
            if (matches) {
                result = result.replace(pattern, replacement);
                changedCount += matches.length;
                
                // Track required imports
                if (importStatement && !existingImports.includes(importStatement)) {
                    missingImports.add(importStatement);
                }
            }
        });

        // Handle special case for pandas sample with complex regex
        const pandasSamplePattern = /\.sample\([^)]*random_state\s*=\s*\d+[^)]*/g;
        result = result.replace(pandasSamplePattern, (match) => {
            changedCount++;
            return match.replace(/random_state\s*=\s*\d+/, `random_state=${seedValue}`);
        });

        return {
            text: result,
            modified: changedCount > 0,
            changedCount,
            missingImports: Array.from(missingImports)
        };
    }

    private getExistingImports(text: string): string[] {
        const lines = text.split('\n');
        return lines.filter(line => {
            const trimmed = line.trim();
            return trimmed.startsWith('import ') || trimmed.startsWith('from ');
        });
    }

    private async addMissingImports(imports: string[]) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        const lines = text.split('\n');
        
        // Find the best position to insert imports
        let insertPosition = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('import ') || line.startsWith('from ') || line.startsWith('#') || line === '') {
                insertPosition = i + 1;
            } else {
                break;
            }
        }

        const importsText = imports.join('\n') + '\n';
        const position = new vscode.Position(insertPosition, 0);
        
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, position, importsText);
        await vscode.workspace.applyEdit(edit);
    }

    private async addSeedInitialization(seedValue: number) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const frameworks = await this.detectFrameworks();
        const seedBlock = this.generateSeedBlock(seedValue, frameworks);
        
        if (seedBlock) {
            const document = editor.document;
            const text = document.getText();
            const lines = text.split('\n');
            
            // Find position after imports
            let insertPosition = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('import ') || line.startsWith('from ') || line.startsWith('#') || line === '') {
                    insertPosition = i + 1;
                } else {
                    break;
                }
            }

            const position = new vscode.Position(insertPosition, 0);
            const edit = new vscode.WorkspaceEdit();
            edit.insert(document.uri, position, seedBlock);
            await vscode.workspace.applyEdit(edit);

            vscode.window.showInformationMessage(
                `🎲 Added seed initialization block with seed ${seedValue}`,
                { modal: false }
            );
        }
    }

    private async detectFrameworks(): Promise<string[]> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return [];
        }

        const text = editor.document.getText();
        const frameworks: string[] = [];

        // Detect frameworks based on imports and usage
        if (text.includes('import numpy') || text.includes('np.')) {
            frameworks.push('numpy');
        }
        if (text.includes('import torch') || text.includes('torch.')) {
            frameworks.push('pytorch');
        }
        if (text.includes('import tensorflow') || text.includes('tf.')) {
            frameworks.push('tensorflow');
        }
        if (text.includes('import random') || text.includes('random.')) {
            frameworks.push('random');
        }
        if (text.includes('sklearn') || text.includes('random_state')) {
            frameworks.push('sklearn');
        }

        return frameworks;
    }

    private generateSeedBlock(seedValue: number, frameworks: string[]): string {
        const lines: string[] = [];
        
        lines.push('# Set random seeds for reproducibility');
        
        if (frameworks.includes('random')) {
            lines.push(`random.seed(${seedValue})`);
        }
        
        if (frameworks.includes('numpy')) {
            lines.push(`np.random.seed(${seedValue})`);
        }
        
        if (frameworks.includes('pytorch')) {
            lines.push(`torch.manual_seed(${seedValue})`);
            lines.push(`torch.cuda.manual_seed(${seedValue})`);
            lines.push(`torch.cuda.manual_seed_all(${seedValue})`);
            lines.push('torch.backends.cudnn.deterministic = True');
            lines.push('torch.backends.cudnn.benchmark = False');
        }
        
        if (frameworks.includes('tensorflow')) {
            lines.push(`tf.random.set_seed(${seedValue})`);
        }
        
        if (frameworks.length === 0) {
            // Default seed setup for common ML workflows
            lines.push(`import random`);
            lines.push(`import numpy as np`);
            lines.push(`random.seed(${seedValue})`);
            lines.push(`np.random.seed(${seedValue})`);
        }
        
        lines.push(''); // Empty line after seed block
        
        return lines.join('\n');
    }

    // Random seed generator with dice roll animation
    async randomizeSeed() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // Show dice roll animation
        const progress = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "🎲 Rolling dice...",
            cancellable: false
        }, async (progress) => {
            const diceFrames = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
            
            for (let i = 0; i < 10; i++) {
                const frame = diceFrames[i % diceFrames.length];
                progress.report({ message: `${frame} Rolling...` });
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            return Math.floor(Math.random() * 10000);
        });

        // Update configuration with new seed
        await vscode.workspace.getConfiguration('mlTools').update('defaultSeed', progress, vscode.ConfigurationTarget.Workspace);
        
        // Apply the new seed
        await this.syncSeeds();
        
        vscode.window.showInformationMessage(
            `🎲 New random seed: ${progress}`,
            { modal: false }
        );
    }

    // Preset seed values
    async showSeedPresets() {
        const presets = [
            { label: '42', description: 'The Answer to Everything', detail: 'Most popular ML seed' },
            { label: '123', description: 'Simple and memorable', detail: 'Easy to type' },
            { label: '2024', description: 'Current year', detail: 'Time-based seed' },
            { label: '1337', description: 'Leet speak', detail: 'For the culture' },
            { label: '0', description: 'Zero seed', detail: 'Minimal seed value' },
            { label: '🎲 Random', description: 'Generate random seed', detail: 'Let fate decide' }
        ];

        const selected = await vscode.window.showQuickPick(presets, {
            placeHolder: 'Select a seed value',
            matchOnDescription: true
        });

        if (selected) {
            if (selected.label === '🎲 Random') {
                await this.randomizeSeed();
            } else {
                const seedValue = parseInt(selected.label);
                await vscode.workspace.getConfiguration('mlTools').update('defaultSeed', seedValue, vscode.ConfigurationTarget.Workspace);
                await this.syncSeeds();
            }
        }
    }
}