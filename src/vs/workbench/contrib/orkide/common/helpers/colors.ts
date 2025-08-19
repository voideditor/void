/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Color, RGBA } from '../../../../../base/common/color.js';
import { registerColor } from '../../../../../platform/theme/common/colorUtils.js';

// editCodeService colors
const sweepBG = new Color(new RGBA(100, 100, 100, .2));
const highlightBG = new Color(new RGBA(100, 100, 100, .1));
const sweepIdxBG = new Color(new RGBA(100, 100, 100, .5));

const acceptBG = new Color(new RGBA(155, 185, 85, .1)); // default is RGBA(155, 185, 85, .2)
const rejectBG = new Color(new RGBA(255, 0, 0, .1)); // default is RGBA(255, 0, 0, .2)

// Widget colors
export const acceptAllBg = 'rgb(30, 133, 56)'
export const acceptBg = 'rgb(26, 116, 48)'
export const acceptBorder = '1px solid rgb(20, 86, 38)'

export const rejectAllBg = 'rgb(207, 40, 56)'
export const rejectBg = 'rgb(180, 35, 49)'
export const rejectBorder = '1px solid rgb(142, 28, 39)'

export const buttonFontSize = '11px'
export const buttonTextColor = 'white'



const configOfBG = (color: Color) => {
	return { dark: color, light: color, hcDark: color, hcLight: color, }
}

// gets converted to --vscode-void-greenBG, see void.css, asCssVariable
registerColor('void.greenBG', configOfBG(acceptBG), '', true);
registerColor('void.redBG', configOfBG(rejectBG), '', true);
registerColor('void.sweepBG', configOfBG(sweepBG), '', true);
registerColor('void.highlightBG', configOfBG(highlightBG), '', true);
registerColor('void.sweepIdxBG', configOfBG(sweepIdxBG), '', true);
