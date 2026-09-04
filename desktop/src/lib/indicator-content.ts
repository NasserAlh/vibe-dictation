// What the dictation pill shows for a given state at a given instant
// (docs/dictation-indicator-plan.md §4). Pure: the component renders exactly
// what this returns and nothing else, so every status is unit-testable.
// Status only — the pill never shows transcript text (owner decision).
import { m } from '~/paraglide/messages.js'
import type { DictationIndicatorLang, DictationIndicatorState } from '~/lib/dictation-indicator'

export type PillRing = 'grey' | 'green' | 'red' | 'blue' | 'amber'
/** `dot` is the pulsing recording dot; Prompt 4 adds the live level meter. */
export type PillLeft = 'spinner' | 'check' | 'warning' | 'dot'

export interface PillRight {
	/** Language badge: "EN" or "ع". Never mirrors in RTL. */
	badge?: DictationIndicatorLang
	/** Elapsed recording time, "m:ss". Always LTR. */
	elapsed?: string
	/** Where the text goes: keyboard glyph for type, clipboard glyph for copy. */
	destination?: 'type' | 'clipboard'
	/** Free text (the ready flash's "F9 EN · F10 AR"). */
	text?: string
}

export interface PillContent {
	ring: PillRing
	left: PillLeft
	label: string
	right: PillRight | null
	/** Small muted hint after the label ("release to finish"), or null. */
	sub: string | null
}

/** The state plus the instant (performance.now()) the current status/phase was entered. */
export interface PillInput extends DictationIndicatorState {
	since?: number | null
}

/** How long the push-to-talk / toggle hint stays visible after recording starts. */
export const HINT_VISIBLE_MS = 2000

export function formatElapsed(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000))
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function badgeText(lang: DictationIndicatorLang): string {
	return lang === 'ar' ? 'ع' : 'EN'
}

export function pillContent(state: PillInput, now: number): PillContent {
	const sinceMs = state.since == null ? 0 : Math.max(0, now - state.since)
	switch (state.status) {
		case 'starting':
			return { ring: 'grey', left: 'spinner', label: m.dictationIndicatorStarting(), right: null, sub: null }
		case 'ready': {
			const shortcuts = state.shortcut ?? state.message ?? ''
			return { ring: 'green', left: 'check', label: m.dictationIndicatorReady(), right: shortcuts ? { text: shortcuts } : null, sub: null }
		}
		case 'recording': {
			const right: PillRight = { elapsed: formatElapsed(sinceMs) }
			if (state.lang) right.badge = state.lang
			if (state.output) right.destination = state.output
			let sub: string | null = null
			if (sinceMs < HINT_VISIBLE_MS) {
				if (state.hint === 'release') sub = m.dictationIndicatorHintRelease()
				else if (state.hint === 'toggle' && state.shortcut) sub = m.dictationIndicatorHintToggle({ shortcut: state.shortcut })
			}
			return { ring: 'red', left: 'dot', label: m.dictationIndicatorListening(), right, sub }
		}
		case 'transcribing': {
			// `message` is the transient "Still transcribing — wait" hint (a
			// second press while the previous dictation is finishing).
			let label: string
			if (state.message) label = state.message
			else if (state.phase === 'loading-model') label = m.dictationIndicatorLoadingModel()
			else if (state.phase === 'transcribing') label = m.dictationIndicatorTranscribingFor({ seconds: Math.floor(sinceMs / 1000) })
			else if (state.phase === 'formatting') label = m.dictationIndicatorFormatting()
			else label = m.dictationIndicatorTranscribing()
			return { ring: 'blue', left: 'spinner', label, right: state.lang ? { badge: state.lang } : null, sub: null }
		}
		case 'completed': {
			const inserted = state.output === 'type'
			let label: string
			if (typeof state.words === 'number') {
				label = inserted ? m.dictationIndicatorInsertedWords({ words: state.words }) : m.dictationIndicatorCopiedWords({ words: state.words })
			} else {
				label = inserted ? m.dictationIndicatorInserted() : m.dictationIndicatorCopied()
			}
			return { ring: 'green', left: 'check', label, right: null, sub: null }
		}
		case 'error':
			return {
				ring: state.severity === 'warning' ? 'amber' : 'red',
				left: 'warning',
				label: state.message || m.dictationIndicatorError(),
				right: null,
				sub: null,
			}
	}
}
