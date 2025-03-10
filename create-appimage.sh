#!/bin/bash
set -e  # Exit on error
set -x  # Print commands as they are executed

# Configuration
APP_NAME="void"
APP_VERSION="1.0.0"
ARCH="x86_64"

export ARCH

# Check if void binary exists in current directory
if [ ! -f "./void" ]; then
    echo "Error: void binary not found in current directory"
    exit 1
fi

# Check if icon exists
if [ ! -f "./void.png" ]; then
    echo "Error: void.png icon not found in current directory"
    exit 1
fi

# Create temporary directory
TEMP_DIR="$(mktemp -d)"
echo "Created temporary directory: $TEMP_DIR"
APP_DIR="$TEMP_DIR/$APP_NAME.AppDir"

# Create basic AppDir structure
mkdir -pv "$APP_DIR/usr/bin"
mkdir -pv "$APP_DIR/usr/lib"
mkdir -pv "$APP_DIR/usr/share/applications"
mkdir -pv "$APP_DIR/usr/share/icons/hicolor/256x256/apps"

# Exclude create-appimage.sh and appimagetool-x86_64.AppImage from being copied
echo "Copying files excluding create-appimage.sh and appimagetool-x86_64.AppImage..."
for file in ./*; do
    if [[ "$file" != "./create-appimage.sh" && "$file" != "./appimagetool-x86_64.AppImage" ]]; then
        cp -rv "$file" "$APP_DIR/usr/bin/"
    fi
done

# Copy the icon to required locations
cp -v ./void.png "$APP_DIR/void.png"
cp -v ./void.png "$APP_DIR/usr/share/icons/hicolor/256x256/apps/void.png"

# Copy dependencies with error checking
echo "Copying dependencies..."
for lib in $(ldd ./void | grep "=> /" | awk '{print $3}'); do
    if [ -f "$lib" ]; then
        cp -v "$lib" "$APP_DIR/usr/lib/" || echo "Failed to copy $lib"
    else
        echo "Warning: Library $lib not found"
    fi
done

# Create desktop file with error checking
echo "Creating desktop file..."
if ! cat > "$APP_DIR/$APP_NAME.desktop" <<EOF
[Desktop Entry]
Name=$APP_NAME
Exec=void
Icon=void
Type=Application
Categories=Utility;
Comment=Void Linux Application
EOF
then
    echo "Error creating desktop file"
    exit 1
fi

# Make desktop file executable
chmod +x "$APP_DIR/$APP_NAME.desktop"

# Copy the desktop file to the applications directory
cp -v "$APP_DIR/$APP_NAME.desktop" "$APP_DIR/usr/share/applications/"

# Create AppRun with error checking
echo "Creating AppRun..."
if ! cat > "$APP_DIR/AppRun" <<EOF
#!/bin/bash
cd "\$(dirname "\$0")/usr/bin"
export LD_LIBRARY_PATH="\$APPDIR/usr/lib:\$LD_LIBRARY_PATH"
exec ./void "\$@"
EOF
then
    echo "Error creating AppRun"
    exit 1
fi

# Make AppRun executable
chmod +x "$APP_DIR/AppRun"

# Download appimagetool if not present in the current directory
if [ ! -f "./appimagetool-x86_64.AppImage" ]; then
    echo "Downloading appimagetool-x86_64.AppImage..."
    wget "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x appimagetool-x86_64.AppImage
else
    echo "appimagetool-x86_64.AppImage is already present."
fi

# Create the AppImage
echo "Creating AppImage..."
ARCH=x86_64 ./appimagetool-x86_64.AppImage "$APP_DIR" "${APP_NAME}-${APP_VERSION}-${ARCH}.AppImage"

# Cleanup
echo "Cleaning up..."
rm -rf "$TEMP_DIR"

echo "AppImage creation complete!"
