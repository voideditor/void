"""
Create SVG with embedded character image
"""

import os
import base64
from PIL import Image
import io

def create_svg_with_embedded_image(png_path):
    """Create SVG with embedded PNG image"""
    
    # Open and resize image to 16x16
    img = Image.open(png_path)
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    
    # Resize to 16x16 for title bar
    img = img.resize((16, 16), Image.Resampling.LANCZOS)
    
    # Convert to base64
    buffered = io.BytesIO()
    img.save(buffered, format="PNG")
    img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
    
    # Create SVG with embedded image
    svg_content = f'''<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <image 
    x="0" 
    y="0" 
    width="16" 
    height="16" 
    href="data:image/png;base64,{img_base64}"
    preserveAspectRatio="xMidYMid meet"
  />
</svg>'''
    
    return svg_content

def main():
    character_png = r"C:\dsCodeAssistant\okds\media\character.png"
    target_svg = r"C:\dsCodeAssistant\src\vs\workbench\browser\media\code-icon.svg"
    
    if not os.path.exists(character_png):
        print(f"Error: Character image not found at {character_png}")
        return
    
    # Backup original if exists
    if os.path.exists(target_svg):
        backup = target_svg + ".bak"
        if not os.path.exists(backup):
            import shutil
            shutil.copy2(target_svg, backup)
            print(f"Backed up: {target_svg}")
    
    # Create and save SVG
    svg_content = create_svg_with_embedded_image(character_png)
    
    with open(target_svg, 'w', encoding='utf-8') as f:
        f.write(svg_content)
    
    print(f"Created: {target_svg}")
    print("\nSVG with embedded character image created successfully!")
    print("Restart the application to see the new icon in the title bar.")

if __name__ == "__main__":
    main()