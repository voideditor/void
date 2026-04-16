# Dockerfile for ide.orcest.ai (VS Code fork) - Render.com deploy
# Requires X11 libs for native-keymap, node-pty, etc.

FROM node:20-bookworm-slim

# Install build deps for native modules (native-keymap, node-pty, etc.)
# ripgrep: @vscode/ripgrep postinstall downloads from GitHub and gets 403 in cloud builds
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    libxkbfile-dev \
    libx11-dev \
    libxrandr-dev \
    libxi-dev \
    libxtst-dev \
    libxrender-dev \
    libxfixes-dev \
    libxext-dev \
    libxkbcommon-dev \
    libsecret-1-dev \
    libkrb5-dev \
    git \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy source (postinstall needs full tree for build/, remote/, etc.)
COPY . .

# Install deps - requires X11 libs above for native-keymap, node-pty
# Use --ignore-scripts to skip @vscode/ripgrep postinstall (403 from GitHub in cloud builds),
# supply system ripgrep, run postinstall (with install not rebuild for subdirs), then rebuild native modules
RUN npm i --ignore-scripts \
    && mkdir -p node_modules/@vscode/ripgrep/bin \
    && cp /usr/bin/rg node_modules/@vscode/ripgrep/bin/rg \
    && VSCODE_USE_SYSTEM_RIPGREP=1 npm rebuild \
    && mkdir -p build/node_modules/@vscode/ripgrep/bin \
    && cp /usr/bin/rg build/node_modules/@vscode/ripgrep/bin/rg \
    && (cd build && npm rebuild) \
    && mkdir -p remote/node_modules/@vscode/ripgrep/bin \
    && cp /usr/bin/rg remote/node_modules/@vscode/ripgrep/bin/rg \
    && (cd remote && npm rebuild)

# Build: React components first, then compile produces out/ (server + workbench), compile-web adds extension web bundles
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run buildreact \
    && npm run compile \
    && npm run compile-web

# VSCODE_DEV=1 tells the server to use the dev workbench template which loads CSS
# dynamically via import maps. Without this, the server expects a bundled workbench.css
# that is only produced by the full packaging pipeline (gulp vscode-web-min), not by
# npm run compile.
ENV VSCODE_DEV=1

# Render sets PORT; use code-server (production) not code-web (test harness)
EXPOSE 10000
CMD ["sh", "-c", "node out/server-main.js --host 0.0.0.0 --port ${PORT:-10000} --without-connection-token --accept-server-license-terms"]
