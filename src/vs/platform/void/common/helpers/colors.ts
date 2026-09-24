/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Color, RGBA } from '../../../../base/common/color.js';
import { registerColor } from '../../../../platform/theme/common/colorUtils.js';

// editCodeService colors
const sweepBG = new Color(new RGBA(100, 100, 100, .2));
const highlightBG = new Color(new RGBA(100, 100, 100, .1));
const sweepIdxBG = new Color(new RGBA(100, 100, 100, .5));

const acceptBGDark = new Color(new RGBA(155, 185, 85, .14));
const acceptBGLight = new Color(new RGBA(46, 160, 67, .2));
const acceptBorderDark = new Color(new RGBA(155, 185, 85, .8));
const acceptBorderLight = new Color(new RGBA(46, 160, 67, .9));

const rejectBGDark = new Color(new RGBA(255, 70, 70, .14));
const rejectBGLight = new Color(new RGBA(220, 38, 38, .2));
const rejectBorderDark = new Color(new RGBA(255, 120, 120, .8));
const rejectBorderLight = new Color(new RGBA(220, 38, 38, .9));

// Widget colors
export const acceptAllBg = 'rgb(30, 133, 56)'
export const acceptBg = 'rgb(26, 116, 48)'
export const acceptBorder = '1px solid rgb(20, 86, 38)'

export const rejectAllBg = 'rgb(207, 40, 56)'
export const rejectBg = 'rgb(180, 35, 49)'
export const rejectBorder = '1px solid rgb(142, 28, 39)'

export const buttonFontSize = '11px'
export const buttonTextColor = 'white'



const configOfTheme = ({ dark, light }: { dark: Color; light: Color }) => {
	return { dark, light, hcDark: dark, hcLight: light, }
}

// gets converted to --vscode-void-greenBG, see void.css, asCssVariable
registerColor('void.greenBG', configOfTheme({ dark: acceptBGDark, light: acceptBGLight }), '', true);
registerColor('void.redBG', configOfTheme({ dark: rejectBGDark, light: rejectBGLight }), '', true);
registerColor('void.greenBorder', configOfTheme({ dark: acceptBorderDark, light: acceptBorderLight }), '', true);
registerColor('void.redBorder', configOfTheme({ dark: rejectBorderDark, light: rejectBorderLight }), '', true);
registerColor('void.sweepBG', configOfTheme({ dark: sweepBG, light: sweepBG }), '', true);
registerColor('void.highlightBG', configOfTheme({ dark: highlightBG, light: highlightBG }), '', true);
registerColor('void.sweepIdxBG', configOfTheme({ dark: sweepIdxBG, light: sweepIdxBG }), '', true);
