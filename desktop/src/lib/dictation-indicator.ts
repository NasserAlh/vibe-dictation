import { invoke } from '@tauri-apps/api/core'

export type DictationIndicatorStatus = 'starting' | 'ready' | 'recording' | 'transcribing' | 'completed' | 'error'
export type DictationIndicatorLang = 'en' | 'ar'
export type DictationIndicatorPhase = 'loading-model' | 'transcribing' | 'formatting'
export type DictationIndicatorHint = 'release' | 'toggle'
/** `warning` = amber ring (no mic, focus lost); `error` = red ring (a failure). */
export type DictationIndicatorSeverity = 'warning' | 'error'

// Mirrors DictationIndicatorPayload in src-tauri/src/dictation_indicator.rs
// (serde camelCase). Status only — never transcript text.
export interface DictationIndicatorState {
	sessionId: number
	status: DictationIndicatorStatus
	output?: 'clipboard' | 'type'
	message?: string
	lang?: DictationIndicatorLang
	phase?: DictationIndicatorPhase
	words?: number
	hint?: DictationIndicatorHint
	shortcut?: string
	severity?: DictationIndicatorSeverity
	/** "completed" delivered the raw transcript because the Ollama pass failed or timed out. */
	fallback?: 'formatting-skipped'
}

export const getDictationIndicatorEnabled = () => invoke<boolean>('get_dictation_indicator_enabled')
export const setDictationIndicatorEnabled = (enabled: boolean) => invoke<void>('set_dictation_indicator_enabled', { enabled })
export const getDictationIndicatorState = () => invoke<DictationIndicatorState | null>('get_dictation_indicator_state')

export async function showDictationIndicator(state: DictationIndicatorState) {
	try {
		await invoke<void>('show_dictation_indicator', { state })
	} catch (error) {
		console.error('Could not show dictation indicator:', error)
	}
}

export async function hideDictationIndicator(sessionId: number) {
	try {
		await invoke<void>('hide_dictation_indicator', { sessionId })
	} catch (error) {
		console.error('Could not hide dictation indicator:', error)
	}
}
