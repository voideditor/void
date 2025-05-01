import { Color, RGBA } from '../../../../../base/common/color.js';
import { registerColor } from '../../../../../platform/theme/common/colorUtils.js';


// Widget colors
export const acceptBg = '#1a7431'
export const acceptAllBg = '#1e8538'
export const acceptBorder = '1px solid #145626'
export const rejectBg = '#b42331'
export const rejectAllBg = '#cf2838'
export const rejectBorder = '1px solid #8e1c27'
export const buttonFontSize = '11px'
export const buttonTextColor = 'white'


// editCodeService colors
export const greenBG = new Color(new RGBA(155, 185, 85, .1)); // default is RGBA(155, 185, 85, .2)
export const redBG = new Color(new RGBA(255, 0, 0, .1)); // default is RGBA(255, 0, 0, .2)
export const sweepBG = new Color(new RGBA(100, 100, 100, .2));
export const highlightBG = new Color(new RGBA(100, 100, 100, .1));
export const sweepIdxBG = new Color(new RGBA(100, 100, 100, .5));


const configOfBG = (color: Color) => {
	return { dark: color, light: color, hcDark: color, hcLight: color, }
}

// gets converted to --vscode-void-greenBG, see void.css, asCssVariable
registerColor('void.greenBG', configOfBG(greenBG), '', true);
registerColor('void.redBG', configOfBG(redBG), '', true);
registerColor('void.sweepBG', configOfBG(sweepBG), '', true);
registerColor('void.highlightBG', configOfBG(highlightBG), '', true);
registerColor('void.sweepIdxBG', configOfBG(sweepIdxBG), '', true);
