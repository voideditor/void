"""
Create OKDS SVG icon to replace VS Code icon
"""

import os

def create_okds_svg():
    """Create an OKDS branded SVG icon"""
    
    svg_content = '''<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Background gradient -->
  <defs>
    <linearGradient id="okdsGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#FFA500;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#FF6B6B;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Background circle -->
  <circle cx="8" cy="8" r="7.5" fill="url(#okdsGradient)" stroke="white" stroke-width="0.5"/>
  
  <!-- OK text -->
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" 
        font-family="Arial, sans-serif" font-size="6" font-weight="bold" fill="white">
    OK
  </text>
</svg>'''
    
    return svg_content

def save_svg(content, path):
    """Save SVG content to file"""
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Created: {path}")

def main():
    root_dir = r"C:\dsCodeAssistant"
    
    # Create OKDS SVG
    svg_content = create_okds_svg()
    
    # Save to replace code-icon.svg
    target_path = os.path.join(root_dir, "src", "vs", "workbench", "browser", "media", "code-icon.svg")
    
    # Backup original
    backup_path = target_path + ".bak"
    if os.path.exists(target_path) and not os.path.exists(backup_path):
        import shutil
        shutil.copy2(target_path, backup_path)
        print(f"Backed up: {target_path}")
    
    # Save new SVG
    save_svg(svg_content, target_path)
    
    # Also create a copy in okds folder
    okds_svg_path = os.path.join(root_dir, "okds", "media", "okds-icon.svg")
    os.makedirs(os.path.dirname(okds_svg_path), exist_ok=True)
    save_svg(svg_content, okds_svg_path)
    
    print("\nOKDS SVG icon created!")
    print("The VS Code icon in the title bar will now show OKDS branding.")

if __name__ == "__main__":
    main()