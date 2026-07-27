import { describe, expect, it } from 'vitest'
import { forcedLangOptions } from './dictation-lang'

describe('forcedLangOptions', () => {
	it('overrides a stored auto with the hotkey language', () => {
		expect(forcedLangOptions({ lang: 'auto', beam_size: 5 }, 'en')).toEqual({ lang: 'en', beam_size: 5 })
	})

	it('overrides a stale pinned language with the hotkey language', () => {
		// A profile pinned by the removed display-locale clobber (§11) must not
		// leak through: the hotkey always wins.
		expect(forcedLangOptions({ lang: 'en' }, 'ar').lang).toBe('ar')
	})

	it('adds lang when the stored options somehow lack one', () => {
		expect(forcedLangOptions({}, 'en').lang).toBe('en')
	})
})
