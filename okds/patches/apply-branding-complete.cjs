/**
 * OKDS Complete Branding Patch Script
 * This script applies ALL OKDS AI Assistant branding to Void
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');

// Files to patch with text replacements
const textReplacements = [
    // Settings Panel Header
    {
        file: 'src/vs/workbench/contrib/void/browser/voidSettingsPane.ts',
        replacements: [
            { from: "Void's Settings", to: "OKDS AI Assistant Settings" },
            { from: "Void: Toggle Settings", to: "OKDS AI Assistant: Toggle Settings" }
        ]
    },
    {
        file: 'src/vs/workbench/contrib/void/browser/sidebarActions.ts',
        replacements: [
            { from: "Void's Settings", to: "OKDS AI Assistant Settings" }
        ]
    },
    // File Menu
    {
        file: 'src/vs/workbench/contrib/files/browser/fileActions.contribution.ts',
        replacements: [
            { from: "Open Void Settings", to: "Open OKDS AI Assistant Settings" },
            { from: "&&Open Void Settings", to: "&&Open OKDS AI Assistant Settings" }
        ]
    },
    // Update Messages
    {
        file: 'src/vs/workbench/contrib/void/electron-main/voidUpdateMainService.ts',
        replacements: [
            { from: "Restart Void to update!", to: "Restart OKDS AI Assistant to update!" },
            { from: "A new version of Void is available!", to: "A new version of OKDS AI Assistant is available!" },
            { from: "Void is up-to-date!", to: "OKDS AI Assistant is up-to-date!" }
        ]
    },
    // Layout Actions
    {
        file: 'src/vs/workbench/browser/actions/layoutActions.ts',
        replacements: [
            { from: "Move Void Side Bar Left", to: "Move OKDS AI Assistant Side Bar Left" },
            { from: "Move Void Side Bar Right", to: "Move OKDS AI Assistant Side Bar Right" }
        ]
    },
    // README
    {
        file: 'README.md',
        replacements: [
            { from: "# Welcome to Void.", to: "# Welcome to OKDS AI Assistant." },
            { from: "Void is the open-source Cursor alternative.", to: "OKDS AI Assistant is an AI-powered code editor based on Void." }
        ]
    },
    // Windows Manifest
    {
        file: 'resources/win32/VisualElementsManifest.xml',
        replacements: [
            { from: 'ShortDisplayName="Void"', to: 'ShortDisplayName="OKDS AI Assistant"' }
        ]
    },
    // Sidebar Actions - Settings Gear Title
    {
        file: 'src/vs/workbench/contrib/void/browser/sidebarActions.ts',
        replacements: [
            { from: "`Void's Settings`", to: "`OKDS AI Assistant Settings`" }
        ]
    },
    // Additional Service Files
    {
        file: 'src/vs/workbench/contrib/void/electron-main/llmMessage/sendLLMMessage.ts',
        replacements: [
            { from: "Void's Settings", to: "OKDS AI Assistant Settings" }
        ]
    },
    {
        file: 'src/vs/workbench/contrib/void/common/sendLLMMessageService.ts',
        replacements: [
            { from: "Void's Settings", to: "OKDS AI Assistant Settings" }
        ]
    },
    {
        file: 'src/vs/platform/telemetry/common/telemetryService.ts',
        replacements: [
            { from: "Void's Settings", to: "OKDS AI Assistant Settings" }
        ]
    }
];

// React component files that need patching
const reactFiles = [
    'src/vs/workbench/contrib/void/browser/react/src/void-onboarding/VoidOnboarding.tsx',
    'src/vs/workbench/contrib/void/browser/react/src/sidebar-tsx/main/LoggedOutView.tsx',
    'src/vs/workbench/contrib/void/browser/react/src/sidebar-tsx/main/threads/ThreadContainer.tsx',
    'src/vs/workbench/contrib/void/browser/react/src/void-settings-tsx/Settings.tsx'
];

// Apply text replacements
console.log('🎨 Applying COMPLETE OKDS AI Assistant branding...\n');

textReplacements.forEach(({ file, replacements }) => {
    const filePath = path.join(rootDir, file);
    
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  File not found: ${file}`);
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    replacements.forEach(({ from, to }) => {
        if (content.includes(from)) {
            content = content.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), to);
            modified = true;
            console.log(`✅ Replaced "${from}" with "${to}" in ${file}`);
        }
    });
    
    if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
    }
});

// Apply React component patches
reactFiles.forEach(file => {
    const filePath = path.join(rootDir, file);
    
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️  React file not found: ${file}`);
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    // Replace common Void references in React components
    const replacements = [
        { from: /Welcome to Void/g, to: 'Welcome to OKDS AI Assistant' },
        { from: /Void Editor/g, to: 'OKDS AI Assistant' },
        { from: /Void's Settings/g, to: 'OKDS AI Assistant Settings' },
        { from: /"Void"/g, to: '"OKDS AI Assistant"' },
        { from: /'Void'/g, to: "'OKDS AI Assistant'" },
        { from: /\{`Void's Settings`\}/g, to: '{`OKDS AI Assistant Settings`}' }
    ];
    
    replacements.forEach(({ from, to }) => {
        if (from.test(content)) {
            content = content.replace(from, to);
            modified = true;
            console.log(`✅ Updated React component: ${file}`);
        }
    });
    
    if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
    }
});

// Copy product.json override
const productOverride = path.join(__dirname, '..', 'overrides', 'product.json');
const productTarget = path.join(rootDir, 'product.json');

if (fs.existsSync(productOverride)) {
    fs.copyFileSync(productOverride, productTarget);
    console.log('\n✅ Applied product.json override');
}

// Update Electron App Name in package.json (for taskbar)
const packageJsonPath = path.join(rootDir, 'package.json');
if (fs.existsSync(packageJsonPath)) {
    let packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    packageJson.productName = 'OKDS AI Assistant';
    packageJson.displayName = 'OKDS AI Assistant';
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
    console.log('✅ Updated package.json with OKDS AI Assistant branding');
}

console.log('\n🎉 COMPLETE OKDS AI Assistant branding applied successfully!');
console.log('📝 Note: React components need rebuilding:');
console.log('   1. npm run buildreact');
console.log('   2. Restart OKDS AI Assistant');