// OKDS Override for VoidOnboarding.tsx
// This file overrides the VoidIcon component to show OKDS branding

import React, { useEffect, useRef } from 'react'
import { useAccessor } from '../react-use/useAccessor'
import { ColorScheme } from '../../../../../../../platform/theme/common/theme'

export const VoidIcon = () => {
	const accessor = useAccessor()
	const themeService = accessor.get('IThemeService')

	const divRef = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
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

	// Return OKDS branded icon instead of void cube
	return (
		<div ref={divRef} style={{ 
			width: '220px', 
			height: '220px',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			flexDirection: 'column'
		}}>
			<img 
				src="void_icons/code.ico" 
				alt="OKDS AI Assistant"
				style={{ 
					width: '150px', 
					height: '150px',
					objectFit: 'contain'
				}}
			/>
			<div style={{
				marginTop: '20px',
				fontSize: '24px',
				fontWeight: 'bold',
				background: 'linear-gradient(135deg, #FFA500 0%, #FF6B6B 100%)',
				WebkitBackgroundClip: 'text',
				WebkitTextFillColor: 'transparent',
				backgroundClip: 'text'
			}}>
				OKDS AI Assistant
			</div>
		</div>
	)
}