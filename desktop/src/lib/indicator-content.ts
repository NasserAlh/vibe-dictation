// What the dictation pill shows for a given state at a given instant
// (docs/dictation-indicator-plan.md §4). Pure: the component renders exactly
// what this returns and nothing else, so every status is unit-testable.
// Status only — the pill never shows transcript text (owner decision).
import { m } from '~/paraglide/messages.js'
import type { DictationIndicatorLang, DictationIndicatorState } from '~/lib/dictation-indicator'

export type PillRing = 'grey' | 'green' | 'red' | 'blue' | 'amber'
/**
 * `meter` is the five-bar live level meter shown while recording; the
 * component substitutes the pulsing `dot` under prefers-reduced-motion.
 */
export type PillLeft = 'spinner' | 'check' | 'warning' | 'dot' | 'meter'

// --- Level meter (plan §4, ROADMAP "Animated recording indicator") -----------
// Rust emits "dictation-indicator-level" { level: 0..1 } at ~15 Hz while
// recording. Five bars scale with the level through per-bar multipliers;
// below METER_REST_THRESHOLD every bar sits at its resting height.
export const METER_BAR_MULTIPLIERS = [0.6, 0.85, 1, 0.85, 0.6] as const
export const METER_REST_THRESHOLD = 0.02
/** Bar height (px) at rest. */
export const METER_REST_PX = 3
/** Bar height (px) for the centre bar at full level. */
export const METER_MAX_PX = 16

/** dB floor of the perceptual curve: a peak this quiet (or quieter) sits at rest. */
export const METER_FLOOR_DB = -40

/**
 * Perceptual mapping of the raw peak (0..1 linear) to bar drive (0..1).
 * Linear peaks made the bars look subtle on real speech (owner live run,
 * 2026-09-05): normal speech peaks around 0.15–0.3, i.e. −16 to −10 dB.
 * A dB scale with a −40 dB floor puts that at roughly two thirds of the bar
 * and lets loud speech (−6 dB and up) reach the top. Below the rest
 * threshold the meter stays at rest regardless.
 */
export function perceptualLevel(level: number): number {
	const clamped = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
	if (clamped < METER_REST_THRESHOLD) return 0
	const db = 20 * Math.log10(clamped)
	return Math.min(1, Math.max(0, 1 - db / METER_FLOOR_DB))
}

/** Height in px of each of the five bars for a raw peak level in 0..1. */
export function meterBarHeights(level: number): number[] {
	const drive = perceptualLevel(level)
	if (drive === 0) return METER_BAR_MULTIPLIERS.map(() => METER_REST_PX)
	return METER_BAR_MULTIPLIERS.map((multiplier) => METER_REST_PX + (METER_MAX_PX - METER_REST_PX) * drive * multiplier)
}

export function isMeterResting(level: number): boolean {
	return !Number.isFinite(level) || level < METER_REST_THRESHOLD
}

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
			return { ring: 'red', left: 'meter', label: m.dictationIndicatorListening(), right, sub }
		}
		case 'transcribing': {
			// `message` is the transient "Still transcribing — wait" hint (a
			// second press while the previous dictation is finishing).
			let label: string
			if (state.message) label = state.message
			else if (state.phase === 'loading-model') label = m.dictationIndicatorLoadingModel()
			else if (state.phase === 'transcribing') label = m.dictationIndicatorTranscribingFor({ seconds: Math.floor(sinceMs / 1000) })
			// Elapsed seconds on the formatting phase too: a cold Ollama load
			// (40 s in the v1.5.0 gating finding) must be visible as such.
			else if (state.phase === 'formatting') label = m.dictationIndicatorFormattingFor({ seconds: Math.floor(sinceMs / 1000) })
			else label = m.dictationIndicatorTranscribing()
			return { ring: 'blue', left: 'spinner', label, right: state.lang ? { badge: state.lang } : null, sub: null }
		}
		case 'completed': {
			const inserted = state.output === 'type'
			let label: string
			if (state.fallback === 'formatting-skipped') {
				// The Ollama pass failed or timed out; the raw transcript went
				// out. Said plainly, so a silent downgrade never looks like a
				// formatted result.
				label = inserted ? m.dictationIndicatorFormattingSkippedInserted() : m.dictationIndicatorFormattingSkippedCopied()
			} else if (typeof state.words === 'number') {
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
