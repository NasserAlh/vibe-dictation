import { ReactNode, createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { register, unregister, isRegistered } from '@tauri-apps/plugin-global-shortcut'
import * as clipboard from '@tauri-apps/plugin-clipboard-manager'
import { useLocalStorage } from 'usehooks-ts'
import { AudioDevice } from '~/lib/audio'
import * as transcript from '~/lib/transcript'
import { usePreferenceProvider } from '~/providers/preference'
import { m } from '~/paraglide/messages.js'
import { hideDictationIndicator, showDictationIndicator } from '~/lib/dictation-indicator'
import { injectionDiff, isLikelyPartialHallucination, stableLivePrefix } from '~/lib/live-typing'
import { applyCorrections, parseVocabulary, vocabularyPrompt, type Vocabulary } from '~/lib/vocabulary'
import * as config from '~/lib/config'
import { defaultLlmFormatPrompt, defaultOllamaPort, formatWithOllama } from '~/lib/ollama'
import { forcedLangOptions, type DictationLang } from '~/lib/dictation-lang'
import { acceleratorsCollide } from '~/lib/accelerator'

// Single keys, not chords — this is a dictation tool held down while
// speaking; a three-key combination is hostile to that. Stored prefs
// (localStorage) override these, so existing profiles keep their choice.
export const DEFAULT_HOTKEY_SHORTCUT = 'F9'
export const DEFAULT_HOTKEY_SHORTCUT_AR = 'F10'

export type HotkeyOutputMode = 'clipboard' | 'type'
export type HotkeyActivationMode = 'push-to-talk' | 'toggle'

interface HotkeyContextType {
	hotkeyEnabled: boolean
	setHotkeyEnabled: (enabled: boolean) => void
	hotkeyShortcut: string
	setHotkeyShortcut: (shortcut: string) => void
	hotkeyShortcutAr: string
	setHotkeyShortcutAr: (shortcut: string) => void
	hotkeyOutputMode: HotkeyOutputMode
	setHotkeyOutputMode: (mode: HotkeyOutputMode) => void
	hotkeyActivationMode: HotkeyActivationMode
	setHotkeyActivationMode: (mode: HotkeyActivationMode) => void
	hotkeyNormalizeOutput: boolean
	setHotkeyNormalizeOutput: (enabled: boolean) => void
	hotkeyLlmEnabled: boolean
	setHotkeyLlmEnabled: (enabled: boolean) => void
	hotkeyLlmModel: string
	setHotkeyLlmModel: (model: string) => void
	hotkeyLlmPrompt: string
	setHotkeyLlmPrompt: (prompt: string) => void
	hotkeyLlmPort: number
	setHotkeyLlmPort: (port: number) => void
	hotkeyLiveDictation: boolean
	setHotkeyLiveDictation: (enabled: boolean) => void
	hotkeyVocabulary: string
	setHotkeyVocabulary: (vocabulary: string) => void
	hotkeyModelWarmup: boolean
	setHotkeyModelWarmup: (enabled: boolean) => void
	isHotkeyRecording: boolean
}

const HotkeyContext = createContext<HotkeyContextType | null>(null)

export function useHotkeyProvider() {
	return useContext(HotkeyContext) as HotkeyContextType
}

async function ensureNotificationPermission(): Promise<boolean> {
	const granted = await invoke<boolean>('plugin:notification|is_permission_granted')
	if (granted) return true
	const result: string = await invoke('plugin:notification|request_permission')
	return result === 'granted'
}

async function notify(title: string, body: string) {
	try {
		const granted = await ensureNotificationPermission()
		if (!granted) return
		await invoke('plugin:notification|notify', { options: { title, body } })
	} catch (e) {
		console.error('Notification error:', e)
	}
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message
	if (typeof error === 'object' && error !== null && 'message' in error) {
		const message = (error as { message?: unknown }).message
		if (typeof message === 'string') return message
	}
	return String(error)
}

export function HotkeyProvider({ children }: { children: ReactNode }) {
	const preference = usePreferenceProvider()
	const preferenceRef = useRef(preference)

	const [hotkeyEnabled, setHotkeyEnabled] = useLocalStorage('prefs_hotkey_enabled', true)
	const [hotkeyShortcut, setHotkeyShortcut] = useLocalStorage('prefs_hotkey_shortcut', DEFAULT_HOTKEY_SHORTCUT)
	const [hotkeyShortcutAr, setHotkeyShortcutAr] = useLocalStorage('prefs_hotkey_shortcut_ar', DEFAULT_HOTKEY_SHORTCUT_AR)
	const [hotkeyOutputMode, setHotkeyOutputMode] = useLocalStorage<HotkeyOutputMode>('prefs_hotkey_output_mode', 'clipboard')
	const [hotkeyActivationMode, setHotkeyActivationMode] = useLocalStorage<HotkeyActivationMode>('prefs_hotkey_activation_mode', 'push-to-talk')
	const shortcutOperationRef = useRef<Promise<void>>(Promise.resolve())
	const [hotkeyNormalizeOutput, setHotkeyNormalizeOutput] = useLocalStorage('prefs_hotkey_normalize_output', true)
	const [hotkeyLlmEnabled, setHotkeyLlmEnabled] = useLocalStorage('prefs_hotkey_llm_enabled', false)
	const [hotkeyLlmModel, setHotkeyLlmModel] = useLocalStorage('prefs_hotkey_llm_model', '')
	const [hotkeyLlmPrompt, setHotkeyLlmPrompt] = useLocalStorage('prefs_hotkey_llm_prompt', defaultLlmFormatPrompt)
	const [hotkeyLlmPort, setHotkeyLlmPort] = useLocalStorage('prefs_hotkey_llm_port', defaultOllamaPort)
	const [hotkeyLiveDictation, setHotkeyLiveDictation] = useLocalStorage('prefs_hotkey_live_dictation', false)
	const [hotkeyVocabulary, setHotkeyVocabulary] = useLocalStorage('prefs_hotkey_vocabulary', '')
	// Off by default: warmup holds the model (~3 GB VRAM for large-v3) from
	// launch on an autostarted app.
	const [hotkeyModelWarmup, setHotkeyModelWarmup] = useLocalStorage('prefs_hotkey_model_warmup', false)
	const [isHotkeyRecording, setIsHotkeyRecording] = useState(false)

	const isHotkeyRecordingRef = useRef(false)
	const isStartingRef = useRef(false)
	const isStoppingRef = useRef(false)
	const shortcutPressedRef = useRef<Record<DictationLang, boolean>>({ en: false, ar: false })
	// The language of the in-flight dictation, owned by the hotkey that started
	// it. Only that hotkey may stop the recording (a held EN key must not be
	// cut short by a stray AR press, and vice versa).
	const activeLangRef = useRef<DictationLang>('en')
	const hotkeyOutputModeRef = useRef(hotkeyOutputMode)
	const hotkeyNormalizeOutputRef = useRef(hotkeyNormalizeOutput)
	const hotkeyLlmRef = useRef({ enabled: hotkeyLlmEnabled, model: hotkeyLlmModel, prompt: hotkeyLlmPrompt, port: hotkeyLlmPort })
	const registeredShortcutsRef = useRef<string[]>([])
	const indicatorSessionRef = useRef(0)
	const indicatorTimerRef = useRef<number | null>(null)
	const hotkeyLiveDictationRef = useRef(hotkeyLiveDictation)
	const hotkeyVocabularyRef = useRef(hotkeyVocabulary)
	// Parsed once per dictation session (handleHotkeyDown), used by both the
	// partial loop and the final pass.
	const vocabRef = useRef<Vocabulary>({ terms: [], corrections: [] })
	const liveDictationTimerRef = useRef<number | null>(null)
	const liveDictationInFlightRef = useRef<Promise<void> | null>(null)
	// What live dictation has typed into the target so far — the base every
	// reconciling edit (partial or final) diffs against.
	const liveInjectedRef = useRef('')
	// Set when injection is refused (foreground window changed); the session
	// then delivers its final text via clipboard instead of the cursor.
	const liveFrozenRef = useRef(false)
	// True while the current dictation session is live-typing at the cursor.
	const liveSessionRef = useRef(false)
	// Startup ready-feedback: the indicator shows "Starting…" from launch
	// (seeded on the Rust side); the first registration pass replaces it with
	// a ready flash and hides it. One-shot — later re-registrations (settings
	// edits) never touch the indicator.
	const startupAnnouncedRef = useRef(false)
	const startupTimerRef = useRef<number | null>(null)
	const warmupStartedRef = useRef(false)

	const showIndicator = useCallback((status: 'recording' | 'transcribing' | 'completed' | 'error', details: { output?: HotkeyOutputMode; message?: string } = {}) => {
		if (indicatorTimerRef.current) window.clearTimeout(indicatorTimerRef.current)
		showDictationIndicator({ sessionId: indicatorSessionRef.current, status, ...details })
	}, [])

	const finishIndicator = useCallback((status: 'completed' | 'error', details: { output?: HotkeyOutputMode; message?: string } = {}) => {
		const sessionId = indicatorSessionRef.current
		showIndicator(status, details)
		indicatorTimerRef.current = window.setTimeout(() => hideDictationIndicator(sessionId), status === 'error' ? 3500 : 1500)
	}, [showIndicator])

	useEffect(() => {
		preferenceRef.current = preference
	}, [preference])

	useEffect(() => {
		hotkeyOutputModeRef.current = hotkeyOutputMode
	}, [hotkeyOutputMode])

	useEffect(() => {
		hotkeyNormalizeOutputRef.current = hotkeyNormalizeOutput
	}, [hotkeyNormalizeOutput])

	useEffect(() => {
		hotkeyLlmRef.current = { enabled: hotkeyLlmEnabled, model: hotkeyLlmModel, prompt: hotkeyLlmPrompt, port: hotkeyLlmPort }
	}, [hotkeyLlmEnabled, hotkeyLlmModel, hotkeyLlmPrompt, hotkeyLlmPort])

	useEffect(() => {
		hotkeyLiveDictationRef.current = hotkeyLiveDictation
	}, [hotkeyLiveDictation])

	useEffect(() => {
		hotkeyVocabularyRef.current = hotkeyVocabulary
	}, [hotkeyVocabulary])

	const stopLiveDictationLoop = useCallback(() => {
		if (liveDictationTimerRef.current) {
			window.clearInterval(liveDictationTimerRef.current)
			liveDictationTimerRef.current = null
		}
	}, [])

	// Live dictation: while recording, re-transcribe the growing live-capture
	// buffer every couple of seconds and type the stable prefix (everything up
	// to the last completed word) at the cursor, backspace-reconciling earlier
	// words when a later pass revises them. Partials are best-effort — every
	// failure is swallowed (the final pass reconciles to the definitive
	// transcript) — and strictly serialized so sona never runs two
	// transcriptions at once and injections never interleave.
	const startLiveDictationLoop = useCallback((lang: DictationLang) => {
		const session = indicatorSessionRef.current
		const modelPath = preferenceRef.current.modelPath
		if (!modelPath) return
		// Preload once so partial passes (and the final one) skip the model
		// load. If it fails, stop the loop — the final path retries load_model
		// and surfaces the error through the normal flow.
		const preload = invoke('load_model', { modelPath, gpuDevice: preferenceRef.current.gpuDevice }).catch((error) => {
			console.error('Live dictation model preload error:', error)
			stopLiveDictationLoop()
			throw error
		})
		// A rejection is otherwise unhandled when the loop stops before any
		// tick awaits the preload.
		preload.catch(() => {})
		const tick = () => {
			if (liveDictationInFlightRef.current) return
			if (!isHotkeyRecordingRef.current || indicatorSessionRef.current !== session) return
			liveDictationInFlightRef.current = (async () => {
				try {
					await preload
					const path = await invoke<string | null>('snapshot_live_recording')
					if (!path) return
					if (!isHotkeyRecordingRef.current || indicatorSessionRef.current !== session) return
					const requiresVad = preferenceRef.current.modelMetadata?.capabilities.requires_vad ?? false
					const modelsFolder = requiresVad ? await invoke<string>('get_models_folder') : null
					const options = {
						path,
						...forcedLangOptions(preferenceRef.current.modelOptions, lang),
						init_prompt: vocabularyPrompt(preferenceRef.current.modelOptions.init_prompt ?? '', vocabRef.current.terms),
						...(requiresVad ? { vad_model: `${modelsFolder}/${config.vadModelFilename}` } : {}),
						quiet: true,
					}
					const res: transcript.Transcript = await invoke('transcribe', { options })
					const stable = stableLivePrefix(transcript.asText(res.segments, m.speakerPrefix()))
					// Hallucination check runs on the RAW text (its semantics are
					// "what whisper actually emitted"); corrections come after.
					if (!stable || isLikelyPartialHallucination(stable) || liveFrozenRef.current) return
					// isStoppingRef guard: once the stop is being processed, the
					// final reconcile owns the target — partials stand down.
					if (!isHotkeyRecordingRef.current || isStoppingRef.current || indicatorSessionRef.current !== session) return
					const corrected = applyCorrections(stable, vocabRef.current.corrections)
					const diff = injectionDiff(liveInjectedRef.current, corrected)
					if (diff.backspaces === 0 && diff.text === '') return
					const applied = await invoke<boolean>('inject_live_update', { backspaces: diff.backspaces, text: diff.text })
					if (applied) liveInjectedRef.current = corrected
					else liveFrozenRef.current = true
				} catch (error) {
					console.error('Live dictation transcription error:', error)
				} finally {
					liveDictationInFlightRef.current = null
				}
			})()
		}
		liveDictationTimerRef.current = window.setInterval(tick, 1500)
	}, [stopLiveDictationLoop])

	const handleHotkeyDown = useCallback(async (lang: DictationLang) => {
		if (isHotkeyRecordingRef.current || isStartingRef.current || isStoppingRef.current) return
		isStartingRef.current = true
		activeLangRef.current = lang
		try {
			vocabRef.current = parseVocabulary(hotkeyVocabularyRef.current)
			const devices = await invoke<AudioDevice[]>('get_audio_devices')
			const defaultInput = devices.find((d) => d.isDefault && d.isInput)
			if (!defaultInput) {
				console.error('No default input device found')
				return
			}

			isHotkeyRecordingRef.current = true
			setIsHotkeyRecording(true)

			// Live dictation only makes sense when output goes to the cursor.
			const liveDictation = hotkeyLiveDictationRef.current && hotkeyOutputModeRef.current === 'type'
			await invoke('start_record', {
				devices: [defaultInput],
				storeInDocuments: false,
				customPath: null,
				recordingName: null,
				captureLive: liveDictation,
			})
			indicatorSessionRef.current += 1
			liveInjectedRef.current = ''
			liveFrozenRef.current = false
			liveSessionRef.current = false
			showIndicator('recording')
			if (liveDictation) {
				// Remember the window holding the cursor: injections are refused
				// the moment focus moves elsewhere.
				await invoke('start_live_typing')
				liveSessionRef.current = true
				startLiveDictationLoop(lang)
			}
		} catch (error) {
			console.error('Hotkey start_record error:', error)
			stopLiveDictationLoop()
			isHotkeyRecordingRef.current = false
			setIsHotkeyRecording(false)
		} finally {
			isStartingRef.current = false
		}
	}, [showIndicator, startLiveDictationLoop, stopLiveDictationLoop])

	const handleHotkeyUp = useCallback(async (lang: DictationLang) => {
		if (!isHotkeyRecordingRef.current || isStoppingRef.current) return
		if (activeLangRef.current !== lang) return
		isStoppingRef.current = true
		try {
			await emit('stop_record')
		} catch (error) {
			isStoppingRef.current = false
			throw error
		}
	}, [])

	// Listen for record_finish and process when hotkey-triggered
	useEffect(() => {
		const unlisten = listen<{ path: string; name: string }>('record_finish', async (event) => {
			if (!isHotkeyRecordingRef.current) return

			const { path } = event.payload
			stopLiveDictationLoop()
			showIndicator('transcribing')
			// Serialize against an in-flight partial pass so sona never runs
			// two transcriptions at once and the final reconcile never
			// interleaves with a partial injection.
			if (liveDictationInFlightRef.current) {
				try {
					await liveDictationInFlightRef.current
				} catch {
					// Partial failures never affect the final pass.
				}
			}

			try {
				const modelPath = preferenceRef.current.modelPath
				if (!modelPath) {
					throw new Error('No model selected')
				}

				await invoke('load_model', { modelPath, gpuDevice: preferenceRef.current.gpuDevice })
				const requiresVad = preferenceRef.current.modelMetadata?.capabilities.requires_vad ?? false
				const modelsFolder = requiresVad ? await invoke<string>('get_models_folder') : null
				// Dictation always forces the hotkey's language — never 'auto', never
				// the stored lang. Whisper's auto-detection covert-translates this
				// speaker's English to Arabic (verification report §11).
				const options = {
					path,
					...forcedLangOptions(preferenceRef.current.modelOptions, activeLangRef.current),
					init_prompt: vocabularyPrompt(preferenceRef.current.modelOptions.init_prompt ?? '', vocabRef.current.terms),
					...(requiresVad ? { vad_model: `${modelsFolder}/${config.vadModelFilename}` } : {}),
				}
				const res: transcript.Transcript = await invoke('transcribe', { options })
				let resultText = transcript.asText(res.segments, m.speakerPrefix())

				resultText = hotkeyNormalizeOutputRef.current ? transcript.normalizeWhitespace(resultText) : resultText.trim()
				// Vocabulary corrections before the optional LLM pass, so the
				// formatter only ever sees the corrected transcript.
				resultText = applyCorrections(resultText, vocabRef.current.corrections)

				// Optional LLM formatting pass via local Ollama. Never lose the
				// dictation: on any failure, fall through with the raw transcript.
				const llm = hotkeyLlmRef.current
				if (llm.enabled && llm.model && resultText) {
					try {
						const formatted = await formatWithOllama({ model: llm.model, prompt: llm.prompt.trim() || defaultLlmFormatPrompt, text: resultText, port: llm.port })
						if (formatted) resultText = formatted
					} catch (error) {
						console.error('Ollama formatting error:', error)
						await notify('Vibe', m.llmFormatFailed())
					}
				}
				// Output result
				let effectiveOutput = hotkeyOutputModeRef.current
				if (effectiveOutput === 'type') {
					if (!liveSessionRef.current) {
						await invoke('type_text', { text: resultText })
					} else if (!liveFrozenRef.current) {
						// Live dictation already typed the stable prefix; reconcile
						// the target to the definitive transcript instead of
						// retyping everything.
						const diff = injectionDiff(liveInjectedRef.current, resultText)
						if (diff.backspaces > 0 || diff.text !== '') {
							const applied = await invoke<boolean>('inject_live_update', { backspaces: diff.backspaces, text: diff.text })
							if (!applied) liveFrozenRef.current = true
						}
					}
					if (liveSessionRef.current && liveFrozenRef.current) {
						// Focus left the target window mid-dictation. Never type
						// into whatever is focused now — deliver via clipboard.
						effectiveOutput = 'clipboard'
						await clipboard.writeText(resultText)
						await notify('Vibe', m.liveDictationFocusLost())
					}
				} else {
					await clipboard.writeText(resultText)
					await notify('Vibe', m.hotkeyTranscriptionCopied())
				}
				finishIndicator('completed', { output: effectiveOutput })
			} catch (error) {
				console.error('Hotkey transcription error:', error)
				const message = getErrorMessage(error)
				finishIndicator('error', { message })
				await notify('Vibe', message)
			} finally {
				liveSessionRef.current = false
				liveInjectedRef.current = ''
				isStoppingRef.current = false
				isHotkeyRecordingRef.current = false
				setIsHotkeyRecording(false)
			}
		})

		return () => {
			unlisten.then((fn) => fn())
		}
	}, [finishIndicator, showIndicator, stopLiveDictationLoop])

	useEffect(() => () => {
		if (indicatorTimerRef.current) window.clearTimeout(indicatorTimerRef.current)
		if (liveDictationTimerRef.current) window.clearInterval(liveDictationTimerRef.current)
		if (startupTimerRef.current) window.clearTimeout(startupTimerRef.current)
	}, [])

	// Opt-in model warmup: preload the model as soon as the app starts, so the
	// first dictation skips the multi-second lazy load. Also fires when the
	// setting is switched on mid-session. Fire-and-forget — a failure here
	// surfaces through the normal load path on the next dictation.
	useEffect(() => {
		if (!hotkeyModelWarmup || warmupStartedRef.current) return
		const modelPath = preferenceRef.current.modelPath
		if (!modelPath) return
		warmupStartedRef.current = true
		invoke('load_model', { modelPath, gpuDevice: preferenceRef.current.gpuDevice }).catch((error) => {
			console.error('Model warmup error:', error)
		})
	}, [hotkeyModelWarmup])

	// Register/unregister the per-language shortcuts (one accelerator per
	// dictation language — see verification report §11: no auto path).
	useEffect(() => {
		let cancelled = false

		async function unregisterAll() {
			for (const shortcut of registeredShortcutsRef.current) {
				try {
					if (await isRegistered(shortcut)) await unregister(shortcut)
				} catch (e) {
					console.error('Failed to unregister shortcut:', e)
				}
			}
			registeredShortcutsRef.current = []
		}

		async function setupShortcuts() {
			shortcutPressedRef.current = { en: false, ar: false }
			await unregisterAll()

			if (!hotkeyEnabled || cancelled) return

			// Trim before registering: the accelerator parser rejects a trailing
			// space on a single-token shortcut ("F9 "), which would silently kill
			// the hotkey.
			const enShortcut = hotkeyShortcut.trim()
			const arShortcut = hotkeyShortcutAr.trim()
			const entries: { shortcut: string; lang: DictationLang }[] = []
			if (enShortcut) entries.push({ shortcut: enShortcut, lang: 'en' })
			// Colliding accelerators (parser-equivalent, not merely string-equal:
			// CmdOrCtrl ≡ Ctrl etc.) cannot both register; EN wins and the AR
			// shortcut stays inactive (surfaced as a warning in Settings via the
			// same acceleratorsCollide check).
			if (arShortcut && !acceleratorsCollide(arShortcut, enShortcut)) entries.push({ shortcut: arShortcut, lang: 'ar' })

			for (const { shortcut, lang } of entries) {
				if (cancelled) return
				try {
					await register(shortcut, (event) => {
						if (hotkeyActivationMode === 'toggle') {
							if (event.state === 'Released') {
								shortcutPressedRef.current[lang] = false
								return
							}
							if (shortcutPressedRef.current[lang]) return
							shortcutPressedRef.current[lang] = true
							if (isHotkeyRecordingRef.current) handleHotkeyUp(lang)
							else handleHotkeyDown(lang)
						} else if (event.state === 'Pressed') {
							handleHotkeyDown(lang)
						} else if (event.state === 'Released') {
							handleHotkeyUp(lang)
						}
					})
					registeredShortcutsRef.current.push(shortcut)
				} catch (e) {
					console.error(`Failed to register ${lang} shortcut:`, e)
				}
			}
			if (cancelled) await unregisterAll()
		}

		// Runs after the first registration pass settles (skipped if this effect
		// was cancelled first — the re-run announces instead). Session 0 is the
		// startup session; a dictation started during the flash bumps the
		// session, so the timed hide below no-ops instead of hiding it.
		function announceStartup() {
			if (cancelled || startupAnnouncedRef.current) return
			startupAnnouncedRef.current = true
			const registered = registeredShortcutsRef.current
			if (registered.length > 0) {
				showDictationIndicator({ sessionId: 0, status: 'ready', message: registered.join(' / ') })
				startupTimerRef.current = window.setTimeout(() => hideDictationIndicator(0), 5000)
			} else if (hotkeyEnabled) {
				// Enabled but nothing registered (shortcut taken by another app,
				// or both fields empty) — surface it instead of vanishing.
				showDictationIndicator({ sessionId: 0, status: 'error', message: m.dictationIndicatorHotkeysFailed() })
				startupTimerRef.current = window.setTimeout(() => hideDictationIndicator(0), 3500)
			} else {
				// Hotkeys disabled: just clear the seeded starting state.
				hideDictationIndicator(0)
			}
		}

		shortcutOperationRef.current = shortcutOperationRef.current.then(setupShortcuts, setupShortcuts).then(announceStartup)

		return () => {
			cancelled = true
			shortcutOperationRef.current = shortcutOperationRef.current.then(unregisterAll)
		}
	}, [hotkeyEnabled, hotkeyShortcut, hotkeyShortcutAr, hotkeyActivationMode, handleHotkeyDown, handleHotkeyUp])

	const value: HotkeyContextType = {
		hotkeyEnabled,
		setHotkeyEnabled,
		hotkeyShortcut,
		setHotkeyShortcut,
		hotkeyShortcutAr,
		setHotkeyShortcutAr,
		hotkeyOutputMode,
		setHotkeyOutputMode,
		hotkeyActivationMode,
		setHotkeyActivationMode,
		hotkeyNormalizeOutput,
		setHotkeyNormalizeOutput,
		hotkeyLlmEnabled,
		setHotkeyLlmEnabled,
		hotkeyLlmModel,
		setHotkeyLlmModel,
		hotkeyLlmPrompt,
		setHotkeyLlmPrompt,
		hotkeyLlmPort,
		setHotkeyLlmPort,
		hotkeyLiveDictation,
		setHotkeyLiveDictation,
		hotkeyVocabulary,
		setHotkeyVocabulary,
		hotkeyModelWarmup,
		setHotkeyModelWarmup,
		isHotkeyRecording,
	}

	return <HotkeyContext.Provider value={value}>{children}</HotkeyContext.Provider>
}
