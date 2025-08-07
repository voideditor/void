"""
Convert void_icons for OKDS AI Assistant
"""

import os
import sys
from PIL import Image

def convert_icons():
    """Convert void_icons to various formats needed"""
    
    root_dir = r"C:\dsCodeAssistant"
    ico_path = os.path.join(root_dir, "void_icons", "code.ico")
    
    # Open ICO file
    ico = Image.open(ico_path)
    
    # Get the largest size from ICO
    sizes_available = ico.info.get('sizes', [(32, 32)])
    if sizes_available:
        largest_size = max(sizes_available, key=lambda x: x[0])
        ico.size = largest_size
        ico.load()
    
    # Convert to RGBA
    if ico.mode != 'RGBA':
        ico = ico.convert('RGBA')
    
    # Linux icon (512x512)
    linux_icon = ico.resize((512, 512), Image.Resampling.LANCZOS)
    linux_icon.save(os.path.join(root_dir, "resources", "linux", "code.png"))
    print("Created Linux icon: resources/linux/code.png")
    
    # Windows PNG variants
    ico_70 = ico.resize((70, 70), Image.Resampling.LANCZOS)
    ico_70.save(os.path.join(root_dir, "resources", "win32", "code_70x70.png"))
    print("Created Windows icon: resources/win32/code_70x70.png")
    
    ico_150 = ico.resize((150, 150), Image.Resampling.LANCZOS)
    ico_150.save(os.path.join(root_dir, "resources", "win32", "code_150x150.png"))
    print("Created Windows icon: resources/win32/code_150x150.png")
    
    # Server/PWA icons
    ico_192 = ico.resize((192, 192), Image.Resampling.LANCZOS)
    ico_192.save(os.path.join(root_dir, "resources", "server", "code-192.png"))
    print("Created PWA icon: resources/server/code-192.png")
    
    ico_512 = ico.resize((512, 512), Image.Resampling.LANCZOS)
    ico_512.save(os.path.join(root_dir, "resources", "server", "code-512.png"))
    print("Created PWA icon: resources/server/code-512.png")
    
    print("\nAll icons converted successfully!")

if __name__ == "__main__":
    try:
        convert_icons()
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)