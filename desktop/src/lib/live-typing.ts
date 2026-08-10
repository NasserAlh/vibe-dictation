import { normalizeWhitespace } from './transcript'

// The trailing words of a partial transcript churn as more audio arrives;
// only text up to the last completed word is worth typing at the cursor.
// A partial that already ends a sentence is fully stable. Whitespace is
// always collapsed — a raw multi-segment transcript contains newlines, and
// typing a newline sends Enter to the target (which submits chat boxes).
export function stableLivePrefix(text: string): string {
	const collapsed = normalizeWhitespace(text)
	if (!collapsed) return ''
	if (/[.!?؟…]$/.test(collapsed)) return collapsed
	const lastSpace = collapsed.lastIndexOf(' ')
	return lastSpace <= 0 ? '' : collapsed.slice(0, lastSpace)
}

// Whisper invents these when fed silence, breath, or keyboard noise — the
// classic YouTube-caption artifacts, English and Arabic (including the
// infamous translator credit). A partial consisting of nothing else is never
// typed. Partials only: a genuinely dictated "thank you" inside a longer
// utterance passes untouched, and the final pass is never filtered, so even
// a dictation that is exactly "thank you" still comes through — only its
// live echo waits for the final pass.
const PARTIAL_HALLUCINATIONS = new Set(
	[
		'thank',
		'thank you',
		'thank you very much',
		'thanks for watching',
		'thank you for watching',
		'thanks for listening',
		'you',
		'bye',
		'subscribe',
		'شكرا',
		'شكرا لك',
		'شكرا لكم',
		'شكرا جزيلا',
		'شكرا للمشاهدة',
		'اشتركوا في القناة',
		'ترجمة نانسي قنقر',
	].map(normalizeForHallucinationCheck),
)

function normalizeForHallucinationCheck(text: string): string {
	return text
		.toLowerCase()
		.replace(/[.,!?؟،؛:…'"«»()-]/g, '')
		.replace(/[ً-ْـ]/g, '') // Arabic diacritics + tatweel
		.replace(/\s+/g, ' ')
		.trim()
}

export function isLikelyPartialHallucination(text: string): boolean {
	return PARTIAL_HALLUCINATIONS.has(normalizeForHallucinationCheck(text))
}

// The minimal edit that turns the already-typed text into the next revision:
// delete the divergent tail, type the replacement. Counts are UTF-16 code
// units, which for the BMP text whisper emits (English and Arabic letters)
// is what edit controls treat as one backspace.
export function injectionDiff(injected: string, next: string): { backspaces: number; text: string } {
	let prefix = 0
	const limit = Math.min(injected.length, next.length)
	while (prefix < limit && injected[prefix] === next[prefix]) prefix++
	return { backspaces: injected.length - prefix, text: next.slice(prefix) }
}
