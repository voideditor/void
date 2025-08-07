"""
Convert ICO file to various PNG sizes for OKDS AI Assistant
"""

import os
import sys
from PIL import Image

def extract_and_save_png_sizes(ico_path):
    """Extract images from ICO and save as PNG in various sizes"""
    
    root_dir = os.path.join(os.path.dirname(__file__), '..', '..')
    
    # Open the ICO file
    ico = Image.open(ico_path)
    
    # Get the largest size available in the ICO
    sizes_available = []
    for size in ico.info.get('sizes', [(32, 32)]):
        sizes_available.append(size)
    
    # Use the largest size as base
    if sizes_available:
        largest_size = max(sizes_available, key=lambda x: x[0])
        ico.size = largest_size
        ico.load()
    
    # Convert to RGBA if not already
    if ico.mode != 'RGBA':
        ico = ico.convert('RGBA')
    
    # Sizes we need
    required_sizes = {
        70: os.path.join(root_dir, 'resources', 'win32', 'code_70x70.png'),
        150: os.path.join(root_dir, 'resources', 'win32', 'code_150x150.png'),
        192: os.path.join(root_dir, 'resources', 'server', 'code-192.png'),
        512: os.path.join(root_dir, 'resources', 'server', 'code-512.png'),
        512: os.path.join(root_dir, 'resources', 'linux', 'code.png'),  # Linux uses 512px
    }
    
    print(f"Converting ICO to PNG formats...")
    print(f"Source ICO has sizes: {sizes_available}")
    
    for size, path in required_sizes.items():
        # Resize the image
        resized = ico.resize((size, size), Image.Resampling.LANCZOS)
        
        # Save as PNG
        resized.save(path, 'PNG')
        print(f"  Created {size}x{size} PNG at: {os.path.basename(path)}")
    
    # Also copy the ICO to other needed locations
    import shutil
    
    # Copy to build folder if it exists
    build_ico_path = os.path.join(root_dir, '.build', 'electron', 'resources', 'win32', 'code.ico')
    if os.path.exists(os.path.dirname(build_ico_path)):
        os.makedirs(os.path.dirname(build_ico_path), exist_ok=True)
        shutil.copy2(ico_path, build_ico_path)
        print(f"  Copied ICO to build folder")
    
    print("\nIcon conversion complete!")
    print("Restart the application to see the new icons.")

if __name__ == "__main__":
    ico_file = r"C:\dsCodeAssistant\.claude\favicon.ico"
    
    if not os.path.exists(ico_file):
        print(f"Error: ICO file not found at {ico_file}")
        sys.exit(1)
    
    try:
        extract_and_save_png_sizes(ico_file)
    except Exception as e:
        print(f"Error converting icons: {e}")
        sys.exit(1)