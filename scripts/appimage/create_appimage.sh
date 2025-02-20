#!/bin/bash

# Exit on error
set -e

# Check platform
platform=$(uname)

if [[ "$platform" == "Darwin" ]]; then
    echo "Running on macOS. Note that the AppImage created will only work on Linux systems."
    if ! command -v docker &> /dev/null; then
        echo "Docker Desktop for Mac is not installed. Please install it from https://www.docker.com/products/docker-desktop"
        exit 1
    fi
elif [[ "$platform" == "Linux" ]]; then
    echo "Running on Linux. Proceeding with AppImage creation..."
else
    echo "This script is intended to run on macOS or Linux. Current platform: $platform"
    exit 1
fi

# Enable BuildKit
export DOCKER_BUILDKIT=1

BUILD_IMAGE_NAME="void-appimage-builder"

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Please start Docker first."
    exit 1
fi

# Check and install Buildx if needed
if ! docker buildx version >/dev/null 2>&1; then
    echo "Installing Docker Buildx..."
    mkdir -p ~/.docker/cli-plugins/
    curl -SL https://github.com/docker/buildx/releases/download/v0.13.1/buildx-v0.13.1.linux-amd64 -o ~/.docker/cli-plugins/docker-buildx
    chmod +x ~/.docker/cli-plugins/docker-buildx
fi

# Download appimagetool if not present
if [ ! -f "appimagetool" ]; then
    echo "Downloading appimagetool..."
    wget -O appimagetool "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x appimagetool
fi

# Delete any existing AppImage to avoid bloating the build
rm -f Void-x86_64.AppImage

# Create build Dockerfile
echo "Creating build Dockerfile..."
cat > Dockerfile.build << 'EOF'
# syntax=docker/dockerfile:1
FROM ubuntu:20.04

# Install required dependencies
RUN apt-get update && apt-get install -y \
    libfuse2 \
    libglib2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxss1 \
    libxtst6 \
    libnss3 \
    libasound2 \
    libdrm2 \
    libgbm1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
EOF

# Create .dockerignore file
echo "Creating .dockerignore file..."
cat > .dockerignore << EOF
Dockerfile.build
.dockerignore
.git
.gitignore
.DS_Store
*~
*.swp
*.swo
*.tmp
*.bak
*.log
*.err
node_modules/
venv/
*.egg-info/
*.tox/
dist/
EOF

# Build Docker image without cache
echo "Building Docker image (no cache)..."
docker build --no-cache -t "$BUILD_IMAGE_NAME" -f Dockerfile.build .

# Create AppImage using local appimagetool
echo "Creating AppImage..."
docker run --rm --privileged -v "$(pwd):/app" "$BUILD_IMAGE_NAME" bash -c '
cd /app && \
rm -rf VoidApp.AppDir && \
mkdir -p VoidApp.AppDir/usr/bin VoidApp.AppDir/usr/lib VoidApp.AppDir/usr/share/applications && \
find . -maxdepth 1 ! -name VoidApp.AppDir ! -name "." ! -name ".." -exec cp -r {} VoidApp.AppDir/usr/bin/ \; && \
cp void.png VoidApp.AppDir/ && \
echo "[Desktop Entry]" > VoidApp.AppDir/void.desktop && \
echo "Name=Void" >> VoidApp.AppDir/void.desktop && \
echo "Exec=void" >> VoidApp.AppDir/void.desktop && \
echo "Icon=void" >> VoidApp.AppDir/void.desktop && \
echo "Type=Application" >> VoidApp.AppDir/void.desktop && \
echo "Categories=Utility;" >> VoidApp.AppDir/void.desktop && \
echo "Comment=Void Linux Application" >> VoidApp.AppDir/void.desktop && \
chmod +x VoidApp.AppDir/void.desktop && \
cp VoidApp.AppDir/void.desktop VoidApp.AppDir/usr/share/applications/ && \
echo "#!/bin/bash" > VoidApp.AppDir/AppRun && \
echo "HERE=\$(dirname \"\$(readlink -f \"\${0}\")\")" >> VoidApp.AppDir/AppRun && \
echo "export PATH=\${HERE}/usr/bin:\${PATH}" >> VoidApp.AppDir/AppRun && \
echo "export LD_LIBRARY_PATH=\${HERE}/usr/lib:\${LD_LIBRARY_PATH}" >> VoidApp.AppDir/AppRun && \
echo "exec \${HERE}/usr/bin/void --no-sandbox \"\$@\"" >> VoidApp.AppDir/AppRun && \
chmod +x VoidApp.AppDir/AppRun && \
chmod -R 755 VoidApp.AppDir && \

# Strip unneeded symbols from the binary to reduce size
strip --strip-unneeded VoidApp.AppDir/usr/bin/void

ls -la VoidApp.AppDir/ && \
ARCH=x86_64 ./appimagetool -n VoidApp.AppDir Void-x86_64.AppImage
'

# Clean up
rm -rf VoidApp.AppDir .dockerignore appimagetool

echo "AppImage creation complete! Your AppImage is: Void-x86_64.AppImage"
