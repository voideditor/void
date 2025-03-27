// added by VSCodium
import { language } from '../../../vs/base/common/platform.js';

const DEFAULT_LABEL = 'Release:';
const LABELS: { [key: string]: string } = {
	'en': DEFAULT_LABEL,
	'fr': 'Révision :',
	'ru': 'Релиз:',
	'zh-hans': '发布版本:',
	'zh-hant': '發布版本:',
};

export function getReleaseString(): string {
	return LABELS[language] ?? DEFAULT_LABEL;
}
