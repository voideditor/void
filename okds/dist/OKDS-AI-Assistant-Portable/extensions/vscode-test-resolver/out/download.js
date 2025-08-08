"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadAndUnzipVSCodeServer = downloadAndUnzipVSCodeServer;
const https = __importStar(require("https"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const cp = __importStar(require("child_process"));
const url_1 = require("url");
function ensureFolderExists(loc) {
    if (!fs.existsSync(loc)) {
        const parent = path.dirname(loc);
        if (parent) {
            ensureFolderExists(parent);
        }
        fs.mkdirSync(loc);
    }
}
function getDownloadUrl(updateUrl, commit, platform, quality) {
    return `${updateUrl}/commit:${commit}/server-${platform}/${quality}`;
}
async function downloadVSCodeServerArchive(updateUrl, commit, quality, destDir, log) {
    ensureFolderExists(destDir);
    const platform = process.platform === 'win32' ? 'win32-x64' : process.platform === 'darwin' ? 'darwin' : 'linux-x64';
    const downloadUrl = getDownloadUrl(updateUrl, commit, platform, quality);
    return new Promise((resolve, reject) => {
        log(`Downloading VS Code Server from: ${downloadUrl}`);
        const requestOptions = (0, url_1.parse)(downloadUrl);
        https.get(requestOptions, res => {
            if (res.statusCode !== 302) {
                reject('Failed to get VS Code server archive location');
                res.resume(); // read the rest of the response data and discard it
                return;
            }
            const archiveUrl = res.headers.location;
            if (!archiveUrl) {
                reject('Failed to get VS Code server archive location');
                res.resume(); // read the rest of the response data and discard it
                return;
            }
            const archiveRequestOptions = (0, url_1.parse)(archiveUrl);
            const archivePath = path.resolve(destDir, `vscode-server-${commit}.${archiveUrl.endsWith('.zip') ? 'zip' : 'tgz'}`);
            const outStream = fs.createWriteStream(archivePath);
            outStream.on('finish', () => {
                resolve(archivePath);
            });
            outStream.on('error', err => {
                reject(err);
            });
            https.get(archiveRequestOptions, res => {
                res.pipe(outStream);
                res.on('error', err => {
                    reject(err);
                });
            });
        });
    });
}
/**
 * Unzip a .zip or .tar.gz VS Code archive
 */
function unzipVSCodeServer(vscodeArchivePath, extractDir, destDir, log) {
    log(`Extracting ${vscodeArchivePath}`);
    if (vscodeArchivePath.endsWith('.zip')) {
        const tempDir = fs.mkdtempSync(path.join(destDir, 'vscode-server-extract'));
        if (process.platform === 'win32') {
            cp.spawnSync('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-NonInteractive',
                '-NoLogo',
                '-Command',
                `Microsoft.PowerShell.Archive\\Expand-Archive -Path "${vscodeArchivePath}" -DestinationPath "${tempDir}"`
            ]);
        }
        else {
            cp.spawnSync('unzip', [vscodeArchivePath, '-d', `${tempDir}`]);
        }
        fs.renameSync(path.join(tempDir, process.platform === 'win32' ? 'vscode-server-win32-x64' : 'vscode-server-darwin-x64'), extractDir);
    }
    else {
        // tar does not create extractDir by default
        if (!fs.existsSync(extractDir)) {
            fs.mkdirSync(extractDir);
        }
        cp.spawnSync('tar', ['-xzf', vscodeArchivePath, '-C', extractDir, '--strip-components', '1']);
    }
}
async function downloadAndUnzipVSCodeServer(updateUrl, commit, quality = 'stable', destDir, log) {
    const extractDir = path.join(destDir, commit);
    if (fs.existsSync(extractDir)) {
        log(`Found ${extractDir}. Skipping download.`);
    }
    else {
        log(`Downloading VS Code Server ${quality} - ${commit} into ${extractDir}.`);
        try {
            const vscodeArchivePath = await downloadVSCodeServerArchive(updateUrl, commit, quality, destDir, log);
            if (fs.existsSync(vscodeArchivePath)) {
                unzipVSCodeServer(vscodeArchivePath, extractDir, destDir, log);
                // Remove archive
                fs.unlinkSync(vscodeArchivePath);
            }
        }
        catch (err) {
            throw Error(`Failed to download and unzip VS Code ${quality} - ${commit}`);
        }
    }
    return Promise.resolve(extractDir);
}
//# sourceMappingURL=download.js.map