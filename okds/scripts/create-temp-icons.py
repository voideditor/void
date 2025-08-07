"""
Create temporary OKDS icons with text placeholder
"""

import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Installing Pillow library...")
    os.system(f"{sys.executable} -m pip install Pillow")
    from PIL import Image, ImageDraw, ImageFont

def create_okds_icon(size):
    """Create a simple OKDS icon with gradient background"""
    # Create new image with white background
    img = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw gradient background (orange to yellow)
    for i in range(size):
        color_r = 255
        color_g = int(140 + (i / size) * 80)  # Gradient from orange to yellow
        color_b = 0
        draw.rectangle([(0, i), (size, i+1)], fill=(color_r, color_g, color_b, 255))
    
    # Draw border
    border_width = max(2, size // 50)
    draw.rectangle(
        [(border_width, border_width), (size-border_width, size-border_width)],
        outline=(100, 100, 100, 255),
        width=border_width
    )
    
    # Add text "OK!"
    text = "OK!"
    try:
        # Try to use a better font if available
        font_size = size // 3
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        # Use default font if Arial is not available
        font = ImageFont.load_default()
    
    # Get text size
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # Center the text
    x = (size - text_width) // 2
    y = (size - text_height) // 2
    
    # Draw text with shadow
    shadow_offset = max(1, size // 100)
    draw.text((x + shadow_offset, y + shadow_offset), text, fill=(50, 50, 50, 200), font=font)
    draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)
    
    # Add subtitle if size is large enough
    if size >= 128:
        subtitle = "AI Assistant"
        try:
            subtitle_font = ImageFont.truetype("arial.ttf", size // 8)
        except:
            subtitle_font = ImageFont.load_default()
        
        bbox = draw.textbbox((0, 0), subtitle, font=subtitle_font)
        subtitle_width = bbox[2] - bbox[0]
        subtitle_x = (size - subtitle_width) // 2
        subtitle_y = y + text_height + (size // 20)
        
        draw.text((subtitle_x, subtitle_y), subtitle, fill=(255, 255, 255, 255), font=subtitle_font)
    
    return img

def save_ico(images, filepath):
    """Save multiple PIL images as a single ICO file"""
    images[0].save(filepath, format='ICO', sizes=[(img.width, img.height) for img in images])

def main():
    root_dir = os.path.join(os.path.dirname(__file__), '..', '..')
    
    print("Creating OKDS AI Assistant temporary icons...")
    
    # Create icons in various sizes
    sizes = [16, 32, 48, 64, 128, 256, 512, 1024]
    icons = {}
    
    for size in sizes:
        icons[size] = create_okds_icon(size)
        print(f"  Created {size}x{size} icon")
    
    # Save Windows icons
    print("\nSaving Windows icons...")
    
    # Main Windows icon (multiple sizes in one .ico)
    ico_sizes = [icons[16], icons[32], icons[48], icons[256]]
    ico_path = os.path.join(root_dir, 'resources', 'win32', 'code.ico')
    save_ico(ico_sizes, ico_path)
    print(f"  Saved: {ico_path}")
    
    # PNG versions for Windows
    icons[150] = create_okds_icon(150)
    icons[150].save(os.path.join(root_dir, 'resources', 'win32', 'code_150x150.png'))
    print(f"  Saved: resources/win32/code_150x150.png")
    
    icons[70] = create_okds_icon(70)
    icons[70].save(os.path.join(root_dir, 'resources', 'win32', 'code_70x70.png'))
    print(f"  Saved: resources/win32/code_70x70.png")
    
    # Save Linux icon
    print("\nSaving Linux icon...")
    linux_icon_path = os.path.join(root_dir, 'resources', 'linux', 'code.png')
    icons[512].save(linux_icon_path)
    print(f"  Saved: {linux_icon_path}")
    
    # Save server icons (for web)
    print("\nSaving server/web icons...")
    
    # Favicon
    favicon_path = os.path.join(root_dir, 'resources', 'server', 'favicon.ico')
    favicon_sizes = [icons[16], icons[32], icons[48]]
    save_ico(favicon_sizes, favicon_path)
    print(f"  Saved: {favicon_path}")
    
    # PWA icons
    icons[192] = create_okds_icon(192)
    icons[192].save(os.path.join(root_dir, 'resources', 'server', 'code-192.png'))
    print(f"  Saved: resources/server/code-192.png")
    
    icons[512].save(os.path.join(root_dir, 'resources', 'server', 'code-512.png'))
    print(f"  Saved: resources/server/code-512.png")
    
    print("\n[SUCCESS] Temporary icons created!")
    print("\nNote: These are placeholder icons. For production, you should:")
    print("1. Use your actual brand images (OK! logo and character mascot)")
    print("2. Create professional icons using image editing software")
    print("3. Consider using icon generation services for better quality")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())