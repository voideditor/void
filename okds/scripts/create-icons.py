"""
OKDS AI Assistant Icon Generator
This script creates placeholder icons for the OKDS AI Assistant
Note: In production, you should use proper image editing tools to create icons from your logo
"""

import os
import json

# Icon configuration
ICON_INFO = """
The OKDS AI Assistant icons need to be created from the provided brand images:
1. Main logo (OK! Data System) - for application icon
2. Character mascot (smiling character) - for simplified/small icons

Required icon files:
- Windows: .ico format (multiple sizes: 16x16, 32x32, 48x48, 256x256)
- macOS: .icns format
- Linux: .png format (various sizes)

To properly create these icons:
1. Use an image editor like GIMP, Photoshop, or online tools
2. Export the main logo as:
   - resources/win32/code.ico (Windows main icon)
   - resources/darwin/code.icns (macOS main icon)  
   - resources/linux/code.png (Linux main icon)
   - resources/server/favicon.ico (Web favicon)
   
3. Export size variants:
   - resources/win32/code_150x150.png
   - resources/win32/code_70x70.png
   - resources/server/code-192.png
   - resources/server/code-512.png

Manual steps required:
1. Open your image editor
2. Import the OKDS logo image
3. Create a square canvas (recommended: 1024x1024)
4. Center the logo with appropriate padding
5. Export to the formats listed above
"""

def create_icon_placeholder_info():
    """Create a JSON file with icon replacement instructions"""
    
    icon_paths = {
        "windows": {
            "main_icon": "resources/win32/code.ico",
            "large_png": "resources/win32/code_150x150.png",
            "small_png": "resources/win32/code_70x70.png",
            "installer_bmps": [
                "resources/win32/inno-big-100.bmp",
                "resources/win32/inno-big-125.bmp",
                "resources/win32/inno-big-150.bmp",
                "resources/win32/inno-big-175.bmp",
                "resources/win32/inno-big-200.bmp",
                "resources/win32/inno-big-225.bmp",
                "resources/win32/inno-big-250.bmp",
                "resources/win32/inno-small-100.bmp",
                "resources/win32/inno-small-125.bmp",
                "resources/win32/inno-small-150.bmp",
                "resources/win32/inno-small-175.bmp",
                "resources/win32/inno-small-200.bmp",
                "resources/win32/inno-small-225.bmp",
                "resources/win32/inno-small-250.bmp"
            ]
        },
        "macos": {
            "main_icon": "resources/darwin/code.icns"
        },
        "linux": {
            "main_icon": "resources/linux/code.png"
        },
        "server": {
            "favicon": "resources/server/favicon.ico",
            "pwa_192": "resources/server/code-192.png",
            "pwa_512": "resources/server/code-512.png"
        }
    }
    
    # Save icon paths info
    info_path = os.path.join(os.path.dirname(__file__), '..', 'icon-replacement-guide.json')
    with open(info_path, 'w', encoding='utf-8') as f:
        json.dump(icon_paths, f, indent=2)
    
    print("Icon replacement guide created at:", info_path)
    return icon_paths

def main():
    print("=" * 60)
    print("OKDS AI Assistant Icon Setup")
    print("=" * 60)
    print(ICON_INFO)
    print("=" * 60)
    
    # Create the guide file
    paths = create_icon_placeholder_info()
    
    print("\nNext Steps:")
    print("1. Use an image editor to create icons from your brand images")
    print("2. Save them to the paths listed in okds/icon-replacement-guide.json")
    print("3. Run 'npm run build' to include the new icons")
    print("\nTip: You can use online tools like:")
    print("   - https://www.icoconverter.com/ (for .ico files)")
    print("   - https://cloudconvert.com/png-to-icns (for .icns files)")
    print("   - https://realfavicongenerator.net/ (for favicons)")

if __name__ == "__main__":
    main()