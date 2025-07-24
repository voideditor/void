import * as vscode from 'vscode';
import { ShapeInspector } from './features/shapeInspector';
import { GPUToggler } from './features/gpuToggler';
import { ImportCleaner } from './features/importCleaner';
import { LossPlotter } from './features/lossPlotter';
import { SeedSynchronizer } from './features/seedSynchronizer';
import { SmartPaste } from './features/smartPaste';
import { TensorSelector } from './features/tensorSelector';
import { NaNDetector } from './features/nanDetector';
import { MemoryMonitor } from './features/memoryMonitor';
import { GradientVisualizer } from './features/gradientVisualizer';
import { TypeHintAdder } from './features/typeHintAdder';
import { TestGenerator } from './features/testGenerator';
import { FrameworkConverter } from './features/frameworkConverter';
import { ArchitectureVisualizer } from './features/architectureVisualizer';
import { TrainingTimeEstimator } from './features/trainingTimeEstimator';
import { CodeColorizer } from './features/codeColorizer';
import { HyperparameterTweaker } from './features/hyperparameterTweaker';

export function activate(context: vscode.ExtensionContext) {
    console.log('ML Engineer Tools extension is now active!');

    // Initialize feature modules
    const shapeInspector = new ShapeInspector();
    const gpuToggler = new GPUToggler();
    const importCleaner = new ImportCleaner();
    const lossPlotter = new LossPlotter();
    const seedSynchronizer = new SeedSynchronizer();
    const smartPaste = new SmartPaste();
    const tensorSelector = new TensorSelector();
    const nanDetector = new NaNDetector();
    const memoryMonitor = new MemoryMonitor();
    const gradientVisualizer = new GradientVisualizer();
    const typeHintAdder = new TypeHintAdder();
    const testGenerator = new TestGenerator();
    const frameworkConverter = new FrameworkConverter();
    const architectureVisualizer = new ArchitectureVisualizer();
    const trainingTimeEstimator = new TrainingTimeEstimator();
    const codeColorizer = new CodeColorizer();
    const hyperparameterTweaker = new HyperparameterTweaker();

    // Register commands
    const commands = [
        vscode.commands.registerCommand('mlTools.toggleGPU', () => gpuToggler.toggle()),
        vscode.commands.registerCommand('mlTools.cleanImports', () => importCleaner.cleanUnused()),
        vscode.commands.registerCommand('mlTools.showLossPlot', () => lossPlotter.showPlot()),
        vscode.commands.registerCommand('mlTools.syncSeeds', () => seedSynchronizer.syncSeeds()),
        vscode.commands.registerCommand('mlTools.visualizeGradients', () => gradientVisualizer.visualize()),
        vscode.commands.registerCommand('mlTools.addTypeHints', () => typeHintAdder.addHints()),
        vscode.commands.registerCommand('mlTools.generateTest', () => testGenerator.generate()),
        vscode.commands.registerCommand('mlTools.convertFramework', () => frameworkConverter.convert()),
        vscode.commands.registerCommand('mlTools.deployModel', () => deployModel()),
        vscode.commands.registerCommand('mlTools.showArchitecture', () => architectureVisualizer.show()),
        vscode.commands.registerCommand('mlTools.estimateTrainingTime', () => trainingTimeEstimator.estimate()),
        vscode.commands.registerCommand('mlTools.checkMemoryUsage', () => memoryMonitor.checkUsage())
    ];

    // Register providers
    const providers = [
        vscode.languages.registerHoverProvider('python', shapeInspector),
        vscode.languages.registerDocumentSemanticTokensProvider('python', codeColorizer, codeColorizer.legend),
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'python' && vscode.workspace.getConfiguration('mlTools').get('enableAutoImportClean')) {
                importCleaner.cleanUnused();
            }
        }),
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && editor.document.languageId === 'python') {
                nanDetector.detectNaNProne(editor.document);
                memoryMonitor.updateDecorations(editor);
            }
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'python') {
                // Update decorations on text change
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document === event.document) {
                    nanDetector.detectNaNProne(event.document);
                    memoryMonitor.updateDecorations(editor);
                }
            }
        })
    ];

    // Register paste handler for smart paste
    vscode.commands.registerCommand('type', (args) => {
        if (args.text && vscode.workspace.getConfiguration('mlTools').get('enableSmartPaste')) {
            smartPaste.handlePaste(args.text);
        } else {
            vscode.commands.executeCommand('default:type', args);
        }
    });

    // Register multi-cursor and selection enhancements
    vscode.commands.registerCommand('mlTools.selectTensorBlock', () => tensorSelector.selectBlock());
    vscode.commands.registerCommand('mlTools.addMultiCursor', () => tensorSelector.addMultiCursor());

    // Register hyperparameter tweaker
    vscode.commands.registerCommand('mlTools.openHyperparameterSlider', (range: vscode.Range) => {
        hyperparameterTweaker.openSlider(range);
    });

    // Add all disposables to context
    context.subscriptions.push(...commands, ...providers);

    // Show welcome message
    vscode.window.showInformationMessage('🚀 ML Engineer Tools activated! Ready to supercharge your ML workflow!');
}

async function deployModel() {
    const options = ['Azure ML', 'AWS SageMaker', 'Google AI Platform', 'Hugging Face Hub'];
    const choice = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select deployment platform'
    });
    
    if (choice) {
        vscode.window.showInformationMessage(`🚀 Deploying to ${choice}... (Feature coming soon!)`);
    }
}

export function deactivate() {
    console.log('ML Engineer Tools extension deactivated');
}