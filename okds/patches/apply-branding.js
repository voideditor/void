/**
 * OKDS Branding Patch Script
 * This script applies OKDS AI Assistant branding to Void
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');

// Files to patch with text replacements
const textReplacements = [
    {
        file: 'src/vs/workbench/contrib/void/browser/voidSettingsPane.ts',
        replacements: [
            { from: "Void's Settings", to: "OKDS AI Assistant Settings" },
            { from: "Void: Toggle Settings", to: "OKDS AI Assistant: Toggle Settings" }
        ]
    },
    {
        file: 'src/vs/workbench/contrib/void/electron-main/voidUpdateMainService.ts',
        replacements: [
            { from: "Restart Void to update!", to: "Restart OKDS AI Assistant to update!" },
            { from: "A new version of Void is available!", to: "A new version of OKDS AI Assistant is available!" },
            { from: "Void is up-to-date!", to: "OKDS AI Assistant is up-to-date!" }
        ]
    },
    {
        file: 'src/vs/workbench/browser/actions/layoutActions.ts',
        replacements: [
            { from: "Move Void Side Bar Left", to: "Move OKDS AI Assistant Side Bar Left" },
            { from: "Move Void Side Bar Right", to: "Move OKDS AI Assistant Side Bar Right" }
        ]
    },
    {
        file: 'README.md',
        replacements: [
            { from: "# Welcome to Void.", to: "# Welcome to OKDS AI Assistant." },
            { from: "Void is the open-source Cursor alternative.", to: "OKDS AI Assistant is an AI-powered code editor based on Void." }
        ]
    },
    {
        file: 'resources/win32/VisualElementsManifest.xml',
        replacements: [
            { from: 'ShortDisplayName="Void"', to: 'ShortDisplayName="OKDS AI Assistant"' }
        ]
    }
];

// React component files that need patching
const reactFiles = [
    'src/vs/workbench/contrib/void/browser/react/src/void-onboarding/VoidOnboarding.tsx',
    'src/vs/workbench/contrib/void/browser/react/src/sidebar-tsx/main/LoggedOutView.tsx',
    'src/vs/workbench/contrib/void/browser/react/src/sidebar-tsx/main/threads/ThreadContainer.tsx'
];

// Apply text replacements
console.log('🎨 Applying OKDS AI Assistant branding...\n');

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
            content = content.replace(new RegExp(from, 'g'), to);
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
    
    // Replace common Void references in React components
    content = content.replace(/Welcome to Void/g, 'Welcome to OKDS AI Assistant');
    content = content.replace(/Void Editor/g, 'OKDS AI Assistant');
    content = content.replace(/"Void"/g, '"OKDS AI Assistant"');
    content = content.replace(/'Void'/g, "'OKDS AI Assistant'");
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Updated React component: ${file}`);
});

// Copy product.json override
const productOverride = path.join(__dirname, '..', 'overrides', 'product.json');
const productTarget = path.join(rootDir, 'product.json');

if (fs.existsSync(productOverride)) {
    fs.copyFileSync(productOverride, productTarget);
    console.log('\n✅ Applied product.json override');
}

console.log('\n🎉 OKDS AI Assistant branding applied successfully!');
console.log('📝 Note: You need to rebuild the project for changes to take effect:');
console.log('   1. npm run buildreact');
console.log('   2. npm run compile');
console.log('   3. .\\scripts\\code.bat');