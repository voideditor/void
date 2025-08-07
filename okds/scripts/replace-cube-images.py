"""
Replace Void cube images with OKDS branding
"""

import os
import shutil
from PIL import Image, ImageDraw, ImageFont

def create_okds_logo_image(output_path, size=(220, 220)):
    """Create an OKDS logo image to replace the cube"""
    
    # Create transparent image
    img = Image.new('RGBA', size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    
    # Create gradient effect manually
    for y in range(size[1]):
        # Gradient from orange to red
        r = 255
        g = int(165 - (y / size[1]) * 65)  # From 165 (orange) to 100 (red-orange)
        b = 0
        alpha = 200  # Semi-transparent
        
        # Draw horizontal line
        draw.rectangle([(0, y), (size[0], y+1)], fill=(r, g, b, alpha))
    
    # Add OKDS text
    text = "OKDS"
    try:
        # Try to use a better font
        font_size = size[0] // 4
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        font = ImageFont.load_default()
    
    # Get text size
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # Center the text
    x = (size[0] - text_width) // 2
    y = (size[1] - text_height) // 2 - 10
    
    # Draw white text
    draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)
    
    # Add subtitle
    subtitle = "AI Assistant"
    try:
        subtitle_font = ImageFont.truetype("arial.ttf", size[0] // 10)
    except:
        subtitle_font = ImageFont.load_default()
    
    bbox = draw.textbbox((0, 0), subtitle, font=subtitle_font)
    subtitle_width = bbox[2] - bbox[0]
    subtitle_x = (size[0] - subtitle_width) // 2
    subtitle_y = y + text_height + 10
    
    draw.text((subtitle_x, subtitle_y), subtitle, fill=(255, 255, 255, 220), font=subtitle_font)
    
    # Save the image
    img.save(output_path, 'PNG')
    print(f"Created: {output_path}")

def main():
    root_dir = r"C:\dsCodeAssistant"
    
    # Paths to replace
    targets = [
        os.path.join(root_dir, "src", "vs", "workbench", "browser", "parts", "editor", "media", "void_cube_noshadow.png"),
        os.path.join(root_dir, "void_icons", "logo_cube_noshadow.png"),
        os.path.join(root_dir, "resources", "win32", "logo_cube_noshadow.png")
    ]
    
    print("Replacing Void cube images with OKDS branding...")
    
    for target in targets:
        if os.path.exists(target):
            # Backup original
            backup = target + ".bak"
            if not os.path.exists(backup):
                shutil.copy2(target, backup)
                print(f"Backed up: {target}")
            
            # Create new OKDS logo
            create_okds_logo_image(target)
        else:
            print(f"Not found: {target}")
    
    print("\n✅ Cube images replaced!")
    print("Restart the application to see the changes.")

if __name__ == "__main__":
    main()