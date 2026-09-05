import { describe, expect, it } from 'vitest'
import { planDelivery } from './delivery'

describe('planDelivery', () => {
	it('types at the cursor when the window that had the cursor is still in front', () => {
		expect(planDelivery({ output: 'type', liveSession: false, liveFrozen: false, foregroundChanged: false })).toEqual({ path: 'type', focusLost: false })
	})

	it('falls back to the clipboard, flagged as focus lost, when the foreground window changed after key release', () => {
		// The gating finding of 2026-09-05: a 40 s Ollama load, then type_text
		// into whatever was in front by then.
		expect(planDelivery({ output: 'type', liveSession: false, liveFrozen: false, foregroundChanged: true })).toEqual({ path: 'clipboard', focusLost: true })
	})

	it('keeps the live-dictation rule: a frozen live session delivers by clipboard as focus lost', () => {
		expect(planDelivery({ output: 'type', liveSession: true, liveFrozen: true, foregroundChanged: true })).toEqual({ path: 'clipboard', focusLost: true })
	})

	it('reconciles a live session that kept focus at the cursor', () => {
		expect(planDelivery({ output: 'type', liveSession: true, liveFrozen: false, foregroundChanged: false })).toEqual({ path: 'type', focusLost: false })
	})

	it('clipboard output is never a focus-loss case', () => {
		expect(planDelivery({ output: 'clipboard', liveSession: false, liveFrozen: false, foregroundChanged: true })).toEqual({ path: 'clipboard', focusLost: false })
	})
})
