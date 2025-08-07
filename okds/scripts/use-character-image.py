"""
Use the provided character image for all icons
This script assumes you have saved the character image as character.png
"""

import os
import shutil
from PIL import Image

def process_character_image(input_path, output_path, size):
    """Process character image to specified size"""
    
    # Open image
    img = Image.open(input_path)
    
    # Convert to RGBA if needed
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    
    # Resize maintaining aspect ratio
    img.thumbnail(size, Image.Resampling.LANCZOS)
    
    # Create new image with exact size and center the character
    new_img = Image.new('RGBA', size, (255, 255, 255, 0))
    
    # Calculate position to center
    x = (size[0] - img.width) // 2
    y = (size[1] - img.height) // 2
    
    # Paste centered
    new_img.paste(img, (x, y), img if img.mode == 'RGBA' else None)
    
    # Save
    new_img.save(output_path, 'PNG')
    print(f"Created: {output_path}")

def main():
    root_dir = r"C:\dsCodeAssistant"
    
    # Path to your character image - you need to save it first
    character_image = r"C:\dsCodeAssistant\okds\media\character.png"
    
    print("=" * 50)
    print("IMPORTANT: Please save your character image as:")
    print(f"  {character_image}")
    print("Then run this script again.")
    print("=" * 50)
    
    if not os.path.exists(character_image):
        print("\nCharacter image not found!")
        print("Please save the smiling character image to the path above.")
        return
    
    # Images to replace
    targets = [
        # Cube image in welcome screen
        (r"C:\dsCodeAssistant\src\vs\workbench\browser\parts\editor\media\void_cube_noshadow.png", (220, 220)),
        
        # Logo in resources
        (r"C:\dsCodeAssistant\resources\win32\logo_cube_noshadow.png", (220, 220)),
        
        # Void icons folder
        (r"C:\dsCodeAssistant\void_icons\logo_cube_noshadow.png", (220, 220)),
        (r"C:\dsCodeAssistant\void_icons\cubecircled.png", (128, 128)),
        
        # Windows icons
        (r"C:\dsCodeAssistant\resources\win32\code_70x70.png", (70, 70)),
        (r"C:\dsCodeAssistant\resources\win32\code_150x150.png", (150, 150)),
        
        # Server icons
        (r"C:\dsCodeAssistant\resources\server\code-192.png", (192, 192)),
        (r"C:\dsCodeAssistant\resources\server\code-512.png", (512, 512)),
        
        # Linux icon
        (r"C:\dsCodeAssistant\resources\linux\code.png", (512, 512))
    ]
    
    print("\nReplacing all icons with character image...")
    
    for target_path, size in targets:
        if os.path.exists(os.path.dirname(target_path)):
            # Backup original if not already backed up
            backup_path = target_path + ".bak"
            if os.path.exists(target_path) and not os.path.exists(backup_path):
                shutil.copy2(target_path, backup_path)
                print(f"Backed up: {target_path}")
            
            # Process and save character image
            try:
                process_character_image(character_image, target_path, size)
            except Exception as e:
                print(f"Error processing {target_path}: {e}")
        else:
            print(f"Directory not found for: {target_path}")
    
    print("\n✅ All icons replaced with character image!")
    print("Please restart the application to see the changes.")

if __name__ == "__main__":
    main()