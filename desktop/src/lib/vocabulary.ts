// Custom vocabulary: user-supplied names, acronyms, and domain terms that
// whisper consistently mishears ("Claude" → "clod"). One entry per line.
// A plain line is a bias term fed to whisper's init prompt; a "wrong = right"
// line additionally becomes a deterministic whole-word replacement applied to
// partial and final transcripts. One shared list serves both dictation
// languages (owner decision — names like "Claude" appear mid-Arabic too).

export interface VocabularyCorrection {
	from: string
	to: string
}

export interface Vocabulary {
	terms: string[]
	corrections: VocabularyCorrection[]
}

// Whisper truncates an over-long init prompt (keeping the tail, ~224 tokens);
// cap the glossary so the composed prompt stays comfortably inside. Whole
// terms are dropped beyond the cap — earlier lines win.
const GLOSSARY_MAX_CHARS = 600

export function parseVocabulary(raw: string): Vocabulary {
	const terms: string[] = []
	const seenTerms = new Set<string>()
	const corrections = new Map<string, VocabularyCorrection>()

	const addTerm = (term: string) => {
		if (!seenTerms.has(term)) {
			seenTerms.add(term)
			terms.push(term)
		}
	}

	for (const rawLine of raw.split(/\r?\n/)) {
		const line = rawLine.trim()
		if (!line) continue
		const separator = line.indexOf('=')
		if (separator === -1) {
			addTerm(line)
			continue
		}
		const from = line.slice(0, separator).trim()
		const to = line.slice(separator + 1).trim()
		// A half-written rule ("clod =") is skipped entirely — its left side
		// must never become a bias term, that would bias whisper TOWARD the
		// mishearing.
		if (!from || !to) continue
		const key = from.toLowerCase()
		// A duplicate `from` loses entirely (first rule wins) — including its
		// right-hand side, which must not bias recognition for an inert rule.
		if (!corrections.has(key)) {
			corrections.set(key, { from, to })
			addTerm(to)
		}
	}

	return { terms, corrections: [...corrections.values()] }
}

// A bare comma list appended AFTER the user's own init prompt: whisper's
// prompt is decoder priming, not instructions — scaffold words ("Glossary:")
// spend tokens and can echo into output — and truncation keeps the prompt
// tail, so appending is what lets the terms survive a long user prompt.
export function vocabularyPrompt(existingInitPrompt: string, terms: string[]): string {
	const existing = existingInitPrompt.trim()
	if (terms.length === 0) return existing
	const kept: string[] = []
	let length = 0
	for (const term of terms) {
		const added = term.length + (kept.length > 0 ? 2 : 0)
		if (length + added > GLOSSARY_MAX_CHARS) break
		kept.push(term)
		length += added
	}
	if (kept.length === 0) return existing
	const glossary = `${kept.join(', ')}.`
	return [existing, glossary].filter(Boolean).join(' ')
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const collapseKey = (text: string) => text.toLowerCase().replace(/\s+/g, ' ')

// Whole-word, case-insensitive, single-pass replacement. A single alternation
// with a callback (never String.replace with a pattern string) so that rules
// cannot cascade (clod→cloud plus cloud→Claude must map "clod" to "cloud",
// not "Claude") and so `$` in the user's replacement is inserted literally.
// Word boundaries via Unicode lookarounds — JS \b does not work for Arabic.
export function applyCorrections(text: string, corrections: VocabularyCorrection[]): string {
	if (corrections.length === 0 || !text) return text
	const byKey = new Map(corrections.map((correction) => [collapseKey(correction.from), correction.to]))
	const alternatives = corrections
		.map((correction) => correction.from)
		.sort((a, b) => b.length - a.length)
		// Spaces in a multi-word rule match any whitespace run, so a rule can
		// hit across the \n that separates raw transcript segments.
		.map((from) => escapeRegex(from).replace(/ /g, '\\s+'))
	const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu')
	return text.replace(pattern, (match) => byKey.get(collapseKey(match)) ?? match)
}
