import { describe, expect, it } from 'vitest'
import { applyCorrections, parseVocabulary, vocabularyPrompt } from './vocabulary'

describe('parseVocabulary', () => {
	it('collects plain lines as bias terms, trimmed, skipping empties', () => {
		const vocab = parseVocabulary('  Claude  \n\nKOTC\n')
		expect(vocab.terms).toEqual(['Claude', 'KOTC'])
		expect(vocab.corrections).toEqual([])
	})

	it('handles CRLF input', () => {
		expect(parseVocabulary('Claude\r\nKOTC').terms).toEqual(['Claude', 'KOTC'])
	})

	it('splits corrections on the first equals sign only', () => {
		const vocab = parseVocabulary('a = b = c')
		expect(vocab.corrections).toEqual([{ from: 'a', to: 'b = c' }])
	})

	it('adds correction right-hand sides to the bias terms', () => {
		const vocab = parseVocabulary('clod = Claude')
		expect(vocab.terms).toEqual(['Claude'])
		expect(vocab.corrections).toEqual([{ from: 'clod', to: 'Claude' }])
	})

	it('skips half-written rules entirely, never biasing toward the mishearing', () => {
		expect(parseVocabulary('clod =')).toEqual({ terms: [], corrections: [] })
		expect(parseVocabulary('= Claude')).toEqual({ terms: [], corrections: [] })
	})

	it('dedupes terms and keeps the first of duplicate froms', () => {
		const vocab = parseVocabulary('Claude\nclod = Claude\nCLOD = Cloud')
		expect(vocab.terms).toEqual(['Claude'])
		expect(vocab.corrections).toEqual([{ from: 'clod', to: 'Claude' }])
	})

	it('handles Arabic lines', () => {
		const vocab = parseVocabulary('ناقلات النفط الكويتية\nكلود = Claude')
		expect(vocab.terms).toEqual(['ناقلات النفط الكويتية', 'Claude'])
		expect(vocab.corrections).toEqual([{ from: 'كلود', to: 'Claude' }])
	})
})

describe('vocabularyPrompt', () => {
	it('is a strict no-op without terms', () => {
		expect(vocabularyPrompt('', [])).toBe('')
		expect(vocabularyPrompt('  existing  ', [])).toBe('existing')
	})

	it('renders terms as a bare comma list', () => {
		expect(vocabularyPrompt('', ['Claude', 'KOTC'])).toBe('Claude, KOTC.')
	})

	it('appends the glossary after the existing prompt so it survives tail truncation', () => {
		expect(vocabularyPrompt('Meeting notes.', ['Claude'])).toBe('Meeting notes. Claude.')
	})

	it('caps the glossary by dropping whole trailing terms', () => {
		const long = 'x'.repeat(598)
		const prompt = vocabularyPrompt('', [long, 'Claude'])
		expect(prompt).toBe(`${long}.`)
	})
})

describe('applyCorrections', () => {
	const rules = [{ from: 'clod', to: 'Claude' }]

	it('replaces case-insensitively and inserts the replacement verbatim', () => {
		expect(applyCorrections('Clod said clod. CLOD!', rules)).toBe('Claude said Claude. Claude!')
	})

	it('matches whole words only', () => {
		expect(applyCorrections('a clodhopper walked', rules)).toBe('a clodhopper walked')
	})

	it('respects Arabic word boundaries', () => {
		const arabicRules = [{ from: 'كلاود', to: 'Claude' }]
		expect(applyCorrections('قال كلاود ذلك', arabicRules)).toBe('قال Claude ذلك')
		expect(applyCorrections('قال الكلاود ذلك', arabicRules)).toBe('قال الكلاود ذلك')
	})

	it('matches multi-word rules across segment newlines', () => {
		const multiRules = [{ from: 'cloud code', to: 'Claude Code' }]
		expect(applyCorrections('I use cloud\ncode daily', multiRules)).toBe('I use Claude Code daily')
	})

	it('escapes regex metacharacters in rules', () => {
		const metaRules = [
			{ from: 'c++', to: 'C++' },
			{ from: 'dot net', to: '.NET' },
		]
		expect(applyCorrections('i like c++ and dot net', metaRules)).toBe('i like C++ and .NET')
	})

	it('inserts dollar signs literally', () => {
		const dollarRules = [{ from: 'a hundred bucks', to: '$100' }]
		expect(applyCorrections('costs a hundred bucks now', dollarRules)).toBe('costs $100 now')
	})

	it('prefers the longest match at a position', () => {
		const layered = [
			{ from: 'cloud', to: 'Claude' },
			{ from: 'cloud nine', to: 'Cloud Nine' },
		]
		expect(applyCorrections('on cloud nine with cloud', layered)).toBe('on Cloud Nine with Claude')
	})

	it('never cascades rules in a single pass', () => {
		const chain = [
			{ from: 'clod', to: 'cloud' },
			{ from: 'cloud', to: 'Claude' },
		]
		expect(applyCorrections('clod and cloud', chain)).toBe('cloud and Claude')
	})

	it('is the identity for empty rules', () => {
		expect(applyCorrections('anything at all', [])).toBe('anything at all')
	})
})
