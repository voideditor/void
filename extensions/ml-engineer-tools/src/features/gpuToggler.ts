import * as vscode from 'vscode';

export class GPUToggler {
    private cudaPatterns = [
        /\.cuda\(\)/g,
        /\.to\(['"]cuda['"]\)/g,
        /device\s*=\s*['"]cuda['"]/g,
        /torch\.device\(['"]cuda['"]\)/g
    ];

    private cpuPatterns = [
        /\.cpu\(\)/g,
        /\.to\(['"]cpu['"]\)/g,
        /device\s*=\s*['"]cpu['"]/g,
        /torch\.device\(['"]cpu['"]\)/g
    ];

    async toggle() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !vscode.workspace.getConfiguration('mlTools').get('enableGPUToggle')) {
            return;
        }

        const document = editor.document;
        const selection = editor.selection;

        if (selection.isEmpty) {
            // Toggle entire document
            await this.toggleInDocument(editor);
        } else {
            // Toggle selection only
            await this.toggleInSelection(editor, selection);
        }
    }

    private async toggleInDocument(editor: vscode.TextEditor) {
        const document = editor.document;
        const text = document.getText();
        const newText = this.performToggle(text);

        if (newText !== text) {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(text.length)
            );
            edit.replace(document.uri, fullRange, newText);
            await vscode.workspace.applyEdit(edit);

            // Show notification
            const deviceType = this.detectPrimaryDevice(newText);
            vscode.window.showInformationMessage(
                `⚡ Toggled to ${deviceType.toUpperCase()} mode`,
                { modal: false }
            );
        }
    }

    private async toggleInSelection(editor: vscode.TextEditor, selection: vscode.Selection) {
        const document = editor.document;
        const selectedText = document.getText(selection);
        const newText = this.performToggle(selectedText);

        if (newText !== selectedText) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, selection, newText);
            await vscode.workspace.applyEdit(edit);

            // Show notification
            const deviceType = this.detectPrimaryDevice(newText);
            vscode.window.showInformationMessage(
                `⚡ Selection toggled to ${deviceType.toUpperCase()}`,
                { modal: false }
            );
        }
    }

    private performToggle(text: string): string {
        let result = text;

        // Check if text contains more CUDA or CPU references
        const cudaCount = this.countMatches(text, this.cudaPatterns);
        const cpuCount = this.countMatches(text, this.cpuPatterns);

        if (cudaCount > cpuCount) {
            // Convert CUDA to CPU
            result = this.convertCudaToCpu(result);
        } else if (cpuCount > 0) {
            // Convert CPU to CUDA
            result = this.convertCpuToCuda(result);
        } else {
            // No device specifications found, add CUDA by default
            result = this.addCudaToTensors(result);
        }

        return result;
    }

    private countMatches(text: string, patterns: RegExp[]): number {
        let count = 0;
        for (const pattern of patterns) {
            const matches = text.match(new RegExp(pattern.source, 'g'));
            if (matches) {
                count += matches.length;
            }
        }
        return count;
    }

    private convertCudaToCpu(text: string): string {
        let result = text;

        // Replace .cuda() with .cpu()
        result = result.replace(/\.cuda\(\)/g, '.cpu()');
        
        // Replace .to('cuda') with .to('cpu')
        result = result.replace(/\.to\(['"]cuda['"]\)/g, '.to(\'cpu\')');
        
        // Replace device='cuda' with device='cpu'
        result = result.replace(/device\s*=\s*['"]cuda['"]/g, 'device=\'cpu\'');
        
        // Replace torch.device('cuda') with torch.device('cpu')
        result = result.replace(/torch\.device\(['"]cuda['"]\)/g, 'torch.device(\'cpu\')');

        return result;
    }

    private convertCpuToCuda(text: string): string {
        let result = text;

        // Replace .cpu() with .cuda()
        result = result.replace(/\.cpu\(\)/g, '.cuda()');
        
        // Replace .to('cpu') with .to('cuda')
        result = result.replace(/\.to\(['"]cpu['"]\)/g, '.to(\'cuda\')');
        
        // Replace device='cpu' with device='cuda'
        result = result.replace(/device\s*=\s*['"]cpu['"]/g, 'device=\'cuda\'');
        
        // Replace torch.device('cpu') with torch.device('cuda')
        result = result.replace(/torch\.device\(['"]cpu['"]\)/g, 'torch.device(\'cuda\')');

        return result;
    }

    private addCudaToTensors(text: string): string {
        let result = text;

        // Add .cuda() to tensor creation functions
        const tensorCreationPatterns = [
            /(torch\.(?:zeros|ones|randn|rand|empty|full|tensor)\([^)]+\))/g,
            /(torch\.(?:FloatTensor|LongTensor|IntTensor)\([^)]+\))/g
        ];

        for (const pattern of tensorCreationPatterns) {
            result = result.replace(pattern, '$1.cuda()');
        }

        // Add device='cuda' to nn.Module constructors that don't have device specified
        result = result.replace(
            /(nn\.(?:Linear|Conv2d|Conv1d|ConvTranspose2d|BatchNorm2d|LayerNorm)\([^)]+)\)/g,
            (match, p1) => {
                if (!match.includes('device=')) {
                    return p1 + ', device=\'cuda\')';
                }
                return match;
            }
        );

        return result;
    }

    private detectPrimaryDevice(text: string): string {
        const cudaCount = this.countMatches(text, this.cudaPatterns);
        const cpuCount = this.countMatches(text, this.cpuPatterns);

        if (cudaCount > cpuCount) {
            return 'cuda';
        } else if (cpuCount > 0) {
            return 'cpu';
        }
        return 'unknown';
    }

    // Additional utility methods for smart device detection
    async detectAvailableDevices(): Promise<string[]> {
        const devices = ['cpu'];
        
        // In a real implementation, this would check for CUDA availability
        // For now, we'll assume CUDA is available
        devices.push('cuda');
        
        return devices;
    }

    async showDeviceQuickPick() {
        const devices = await this.detectAvailableDevices();
        const items = devices.map(device => ({
            label: device.toUpperCase(),
            description: device === 'cuda' ? '⚡ GPU acceleration' : '🖥️ CPU processing',
            detail: device === 'cuda' ? 'Faster training, higher memory usage' : 'Slower training, lower memory usage'
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select target device',
            matchOnDescription: true
        });

        if (selected) {
            await this.setTargetDevice(selected.label.toLowerCase());
        }
    }

    private async setTargetDevice(targetDevice: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        let newText = text;

        if (targetDevice === 'cuda') {
            newText = this.convertCpuToCuda(text);
            if (newText === text) {
                newText = this.addCudaToTensors(text);
            }
        } else if (targetDevice === 'cpu') {
            newText = this.convertCudaToCpu(text);
        }

        if (newText !== text) {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(text.length)
            );
            edit.replace(document.uri, fullRange, newText);
            await vscode.workspace.applyEdit(edit);

            vscode.window.showInformationMessage(
                `⚡ All tensors moved to ${targetDevice.toUpperCase()}`
            );
        }
    }
}