"""
Use the favicon.ico as the cube replacement
"""

import os
from PIL import Image

def convert_ico_to_png(ico_path, png_path, size=(220, 220)):
    """Convert ICO to PNG with specified size"""
    
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
    
    # Resize to target size
    resized = ico.resize(size, Image.Resampling.LANCZOS)
    
    # Save as PNG
    resized.save(png_path, 'PNG')
    print(f"Converted: {png_path}")

def main():
    ico_path = r"C:\dsCodeAssistant\.claude\favicon.ico"
    
    if not os.path.exists(ico_path):
        print(f"Error: {ico_path} not found")
        return
    
    # Target to replace
    target = r"C:\dsCodeAssistant\src\vs\workbench\browser\parts\editor\media\void_cube_noshadow.png"
    
    print("Replacing cube with favicon...")
    
    # Convert and save
    convert_ico_to_png(ico_path, target)
    
    # Also update void_icons folder
    void_icons_target = r"C:\dsCodeAssistant\void_icons\logo_cube_noshadow.png"
    os.makedirs(os.path.dirname(void_icons_target), exist_ok=True)
    convert_ico_to_png(ico_path, void_icons_target)
    
    print("\nCube images replaced with favicon!")
    print("Restart the application to see the changes.")

if __name__ == "__main__":
    main()