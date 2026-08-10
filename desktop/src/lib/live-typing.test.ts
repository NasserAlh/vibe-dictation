import { describe, expect, it } from 'vitest'
import { injectionDiff, isLikelyPartialHallucination, stableLivePrefix } from './live-typing'

describe('stableLivePrefix', () => {
	it('returns empty for empty or single-word partials', () => {
		expect(stableLivePrefix('')).toBe('')
		expect(stableLivePrefix('hello')).toBe('')
	})

	it('holds back the trailing (still-changing) word', () => {
		expect(stableLivePrefix('hello world how')).toBe('hello world')
	})

	it('keeps everything when the partial ends a sentence', () => {
		expect(stableLivePrefix('hello world.')).toBe('hello world.')
		expect(stableLivePrefix('كيف حالك؟')).toBe('كيف حالك؟')
	})

	it('collapses segment newlines so Enter is never typed', () => {
		expect(stableLivePrefix('hello\nworld\nagain')).toBe('hello world')
	})
})

describe('isLikelyPartialHallucination', () => {
	it('catches the classic silence hallucinations', () => {
		expect(isLikelyPartialHallucination('Thank you.')).toBe(true)
		expect(isLikelyPartialHallucination('Thanks for watching!')).toBe(true)
		expect(isLikelyPartialHallucination('شكراً.')).toBe(true)
		expect(isLikelyPartialHallucination('ترجمة نانسي قنقر')).toBe(true)
	})

	it('never flags real dictation containing the phrase', () => {
		expect(isLikelyPartialHallucination('Thank you for the report, Ahmed')).toBe(false)
		expect(isLikelyPartialHallucination('please send the final report')).toBe(false)
		expect(isLikelyPartialHallucination('شكرا على التقرير النهائي')).toBe(false)
	})
})

describe('injectionDiff', () => {
	it('appends when the new text extends the old', () => {
		expect(injectionDiff('hello ', 'hello world')).toEqual({ backspaces: 0, text: 'world' })
	})

	it('is a no-op for identical text', () => {
		expect(injectionDiff('same', 'same')).toEqual({ backspaces: 0, text: '' })
	})

	it('types everything on first injection', () => {
		expect(injectionDiff('', 'hello')).toEqual({ backspaces: 0, text: 'hello' })
	})

	it('backspaces the divergent tail on revision', () => {
		// Common prefix is 'I want to me'; delete 'at', type 'et you'.
		expect(injectionDiff('I want to meat', 'I want to meet you')).toEqual({ backspaces: 2, text: 'et you' })
	})

	it('handles Arabic revisions', () => {
		const diff = injectionDiff('أرسل التغيير', 'أرسل التقرير النهائي')
		expect(diff.backspaces).toBe('التغيير'.length - 'الت'.length)
		expect(diff.text).toBe('قرير النهائي')
	})

	it('deletes when the new text is shorter', () => {
		expect(injectionDiff('hello world', 'hello')).toEqual({ backspaces: 6, text: '' })
	})
})
