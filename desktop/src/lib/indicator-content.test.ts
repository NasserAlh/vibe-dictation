import { describe, expect, it } from 'vitest'
import { HINT_VISIBLE_MS, METER_MAX_PX, METER_REST_PX, METER_REST_THRESHOLD, badgeText, formatElapsed, isMeterResting, meterBarHeights, pillContent } from './indicator-content'

describe('meterBarHeights', () => {
	it('rests every bar at the resting height below the threshold', () => {
		expect(meterBarHeights(0)).toEqual([3, 3, 3, 3, 3])
		expect(meterBarHeights(METER_REST_THRESHOLD - 0.001)).toEqual([3, 3, 3, 3, 3])
		expect(isMeterResting(0.019)).toBe(true)
		expect(isMeterResting(0.02)).toBe(false)
	})

	it('scales the bars by the per-bar multipliers (0.6, 0.85, 1, 0.85, 0.6)', () => {
		const full = meterBarHeights(1)
		expect(full[2]).toBe(METER_MAX_PX)
		expect(full[0]).toBeCloseTo(METER_REST_PX + (METER_MAX_PX - METER_REST_PX) * 0.6)
		expect(full[1]).toBeCloseTo(METER_REST_PX + (METER_MAX_PX - METER_REST_PX) * 0.85)
		expect(full[3]).toBe(full[1])
		expect(full[4]).toBe(full[0])
		const half = meterBarHeights(0.5)
		expect(half[2]).toBeCloseTo(METER_REST_PX + (METER_MAX_PX - METER_REST_PX) * 0.5)
		expect(half[0]).toBeCloseTo(METER_REST_PX + (METER_MAX_PX - METER_REST_PX) * 0.5 * 0.6)
		// Monotonic in level.
		expect(meterBarHeights(0.8)[2]).toBeGreaterThan(half[2])
	})

	it('clamps out-of-range and non-finite levels', () => {
		expect(meterBarHeights(1.7)).toEqual(meterBarHeights(1))
		expect(meterBarHeights(-0.5)).toEqual([3, 3, 3, 3, 3])
		expect(meterBarHeights(Number.NaN)).toEqual([3, 3, 3, 3, 3])
		expect(isMeterResting(Number.NaN)).toBe(true)
	})
})

// Messages compile with the baseLocale strategy, so these assert English.

describe('formatElapsed', () => {
	it('formats m:ss and clamps negatives', () => {
		expect(formatElapsed(0)).toBe('0:00')
		expect(formatElapsed(7_400)).toBe('0:07')
		expect(formatElapsed(59_999)).toBe('0:59')
		expect(formatElapsed(60_000)).toBe('1:00')
		expect(formatElapsed(754_000)).toBe('12:34')
		expect(formatElapsed(-500)).toBe('0:00')
	})
})

describe('badgeText', () => {
	it('never mirrors: EN for English, ع for Arabic', () => {
		expect(badgeText('en')).toBe('EN')
		expect(badgeText('ar')).toBe('ع')
	})
})

describe('pillContent', () => {
	it('starting: grey spinner, no right slot', () => {
		expect(pillContent({ sessionId: 0, status: 'starting' }, 0)).toEqual({ ring: 'grey', left: 'spinner', label: 'Starting…', right: null, sub: null })
	})

	it('ready: green check with the shortcuts in the right slot', () => {
		const content = pillContent({ sessionId: 0, status: 'ready', shortcut: 'F9 EN · F10 AR' }, 0)
		expect(content).toEqual({ ring: 'green', left: 'check', label: 'Ready', right: { text: 'F9 EN · F10 AR' }, sub: null })
		// Legacy payloads carried the shortcuts in `message`.
		expect(pillContent({ sessionId: 0, status: 'ready', message: 'F9 / F10' }, 0).right).toEqual({ text: 'F9 / F10' })
		expect(pillContent({ sessionId: 0, status: 'ready' }, 0).right).toBeNull()
	})

	it('recording: red ring, level meter, badge, elapsed, destination, and the push-to-talk hint for 2 s', () => {
		const state = { sessionId: 3, status: 'recording' as const, lang: 'en' as const, output: 'type' as const, hint: 'release' as const, shortcut: 'F9', since: 1000 }
		expect(pillContent(state, 1000)).toEqual({
			ring: 'red',
			left: 'meter',
			label: 'Listening',
			right: { badge: 'en', elapsed: '0:00', destination: 'type' },
			sub: 'release to finish',
		})
		expect(pillContent(state, 1000 + HINT_VISIBLE_MS - 1).sub).toBe('release to finish')
		const later = pillContent(state, 1000 + 7_300)
		expect(later.sub).toBeNull()
		expect(later.right).toEqual({ badge: 'en', elapsed: '0:07', destination: 'type' })
	})

	it('recording: toggle hint names the shortcut, Arabic badge, clipboard destination', () => {
		const content = pillContent({ sessionId: 4, status: 'recording', lang: 'ar', output: 'clipboard', hint: 'toggle', shortcut: 'F10', since: 0 }, 500)
		expect(content.sub).toBe('F10 to stop')
		expect(content.right).toEqual({ badge: 'ar', elapsed: '0:00', destination: 'clipboard' })
		// A toggle hint without a known shortcut shows nothing rather than "undefined to stop".
		expect(pillContent({ sessionId: 4, status: 'recording', hint: 'toggle', since: 0 }, 0).sub).toBeNull()
	})

	it('recording without a clock reference counts from zero and shows the hint', () => {
		const content = pillContent({ sessionId: 5, status: 'recording', hint: 'release' }, 99_999)
		expect(content.right).toEqual({ elapsed: '0:00' })
		expect(content.sub).toBe('release to finish')
	})

	it('transcribing: blue spinner, phase-specific label, badge only on the right', () => {
		const base = { sessionId: 6, status: 'transcribing' as const, lang: 'en' as const, since: 10_000 }
		expect(pillContent({ ...base, phase: 'loading-model' }, 12_000)).toEqual({ ring: 'blue', left: 'spinner', label: 'Loading model…', right: { badge: 'en' }, sub: null })
		expect(pillContent({ ...base, phase: 'transcribing' }, 18_400).label).toBe('Transcribing 8 s…')
		expect(pillContent({ ...base, phase: 'formatting' }, 30_000).label).toBe('Formatting…')
		expect(pillContent({ sessionId: 6, status: 'transcribing' }, 0)).toEqual({ ring: 'blue', left: 'spinner', label: 'Transcribing…', right: null, sub: null })
	})

	it('transcribing: an explicit message (the "still transcribing" hint) wins over the phase', () => {
		const content = pillContent({ sessionId: 6, status: 'transcribing', phase: 'transcribing', message: 'Still transcribing — wait', since: 0 }, 3_000)
		expect(content.label).toBe('Still transcribing — wait')
		expect(content.ring).toBe('blue')
	})

	it('completed: green check with a word count when known', () => {
		expect(pillContent({ sessionId: 7, status: 'completed', output: 'type', words: 42 }, 0)).toEqual({ ring: 'green', left: 'check', label: 'Inserted · 42 words', right: null, sub: null })
		expect(pillContent({ sessionId: 7, status: 'completed', output: 'clipboard', words: 1 }, 0).label).toBe('Copied · 1 words')
		expect(pillContent({ sessionId: 7, status: 'completed', output: 'type' }, 0).label).toBe('Inserted')
		expect(pillContent({ sessionId: 7, status: 'completed' }, 0).label).toBe('Copied')
	})

	it('error: red by default, amber for warnings, message or generic fallback', () => {
		expect(pillContent({ sessionId: 8, status: 'error', message: 'Could not start recording' }, 0)).toEqual({
			ring: 'red',
			left: 'warning',
			label: 'Could not start recording',
			right: null,
			sub: null,
		})
		expect(pillContent({ sessionId: 8, status: 'error', message: 'No microphone found', severity: 'warning' }, 0).ring).toBe('amber')
		expect(pillContent({ sessionId: 8, status: 'error' }, 0).label).toBe('Dictation failed')
	})
})
