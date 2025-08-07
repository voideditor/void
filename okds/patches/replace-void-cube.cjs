/**
 * OKDS Cube Replacement Patch
 * This patch replaces the Void cube icon with OKDS branding
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..');

// Patch VoidOnboarding component to use OKDS icon
function patchVoidOnboarding() {
    const filePath = path.join(rootDir, 'src/vs/workbench/contrib/void/browser/react/src/void-onboarding/VoidOnboarding.tsx');
    
    if (!fs.existsSync(filePath)) {
        console.log('⚠️  VoidOnboarding.tsx not found');
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace the VoidIcon component with OKDS branded version
    const voidIconComponent = `const VoidIcon = () => {
	const accessor = useAccessor()
	const themeService = accessor.get('IThemeService')

	const divRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		// void icon style
		const updateTheme = () => {
			const theme = themeService.getColorTheme().type
			const isDark = theme === ColorScheme.DARK || theme === ColorScheme.HIGH_CONTRAST_DARK
			if (divRef.current) {
				divRef.current.style.maxWidth = '220px'
				divRef.current.style.opacity = '50%'
				divRef.current.style.filter = isDark ? '' : 'invert(1)' //brightness(.5)
			}
		}
		updateTheme()
		const d = themeService.onDidColorThemeChange(updateTheme)
		return () => d.dispose()
	}, [])

	return <div ref={divRef} className='@@void-void-icon' />
}`;

    const okdsIconComponent = `const VoidIcon = () => {
	const accessor = useAccessor()
	const themeService = accessor.get('IThemeService')

	const divRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		// OKDS icon style
		const updateTheme = () => {
			const theme = themeService.getColorTheme().type
			const isDark = theme === ColorScheme.DARK || theme === ColorScheme.HIGH_CONTRAST_DARK
			if (divRef.current) {
				divRef.current.style.maxWidth = '220px'
				divRef.current.style.filter = isDark ? '' : 'invert(1)'
			}
		}
		updateTheme()
		const d = themeService.onDidColorThemeChange(updateTheme)
		return () => d.dispose()
	}, [])

	// Return OKDS text logo instead of cube
	return (
		<div ref={divRef} style={{ 
			width: '220px', 
			height: '150px',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			flexDirection: 'column',
			fontSize: '48px',
			fontWeight: 'bold',
			letterSpacing: '2px',
			background: 'linear-gradient(135deg, #FFA500 0%, #FF6B6B 100%)',
			WebkitBackgroundClip: 'text',
			WebkitTextFillColor: 'transparent',
			backgroundClip: 'text',
			textAlign: 'center'
		}}>
			OKDS
			<div style={{
				fontSize: '14px',
				marginTop: '10px',
				letterSpacing: '1px',
				fontWeight: 'normal',
				background: 'none',
				WebkitTextFillColor: 'currentColor',
				opacity: 0.7
			}}>
				AI Assistant
			</div>
		</div>
	)
}`;

    if (content.includes(voidIconComponent)) {
        content = content.replace(voidIconComponent, okdsIconComponent);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('✅ Patched VoidIcon component in VoidOnboarding.tsx');
    } else {
        console.log('⚠️  VoidIcon component not found in expected format');
        
        // Try simpler replacement
        if (content.includes("className='@@void-void-icon'")) {
            // Just replace the return statement
            content = content.replace(
                "return <div ref={divRef} className='@@void-void-icon' />",
                `return (
		<div ref={divRef} style={{ 
			width: '220px', 
			height: '150px',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			flexDirection: 'column',
			fontSize: '48px',
			fontWeight: 'bold',
			letterSpacing: '2px',
			background: 'linear-gradient(135deg, #FFA500 0%, #FF6B6B 100%)',
			WebkitBackgroundClip: 'text',
			WebkitTextFillColor: 'transparent',
			backgroundClip: 'text',
			textAlign: 'center'
		}}>
			OKDS
			<div style={{
				fontSize: '14px',
				marginTop: '10px',
				letterSpacing: '1px',
				fontWeight: 'normal',
				background: 'none',
				WebkitTextFillColor: 'currentColor',
				opacity: 0.7
			}}>
				AI Assistant
			</div>
		</div>
	)`
            );
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('✅ Patched VoidIcon return statement');
        }
    }
}

console.log('🎨 Replacing Void cube with OKDS branding...\n');
patchVoidOnboarding();
console.log('\n🎉 Cube replacement complete!');
console.log('📝 Now run: npm run buildreact');