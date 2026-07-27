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
import * as config from '~/lib/config'
import { defaultLlmFormatPrompt, defaultOllamaPort, formatWithOllama } from '~/lib/ollama'
import { forcedLangOptions, type DictationLang } from '~/lib/dictation-lang'
import { acceleratorsCollide } from '~/lib/accelerator'

export const DEFAULT_HOTKEY_SHORTCUT = 'CmdOrCtrl+Shift+Space'
export const DEFAULT_HOTKEY_SHORTCUT_AR = 'CmdOrCtrl+Alt+Space'

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

	const handleHotkeyDown = useCallback(async (lang: DictationLang) => {
		if (isHotkeyRecordingRef.current || isStartingRef.current || isStoppingRef.current) return
		isStartingRef.current = true
		activeLangRef.current = lang
		try {
			const devices = await invoke<AudioDevice[]>('get_audio_devices')
			const defaultInput = devices.find((d) => d.isDefault && d.isInput)
			if (!defaultInput) {
				console.error('No default input device found')
				return
			}

			isHotkeyRecordingRef.current = true
			setIsHotkeyRecording(true)

			await invoke('start_record', {
				devices: [defaultInput],
				storeInDocuments: false,
				customPath: null,
				recordingName: null,
			})
			indicatorSessionRef.current += 1
			showIndicator('recording')
		} catch (error) {
			console.error('Hotkey start_record error:', error)
			isHotkeyRecordingRef.current = false
			setIsHotkeyRecording(false)
		} finally {
			isStartingRef.current = false
		}
	}, [showIndicator])

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
			showIndicator('transcribing')

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
					...(requiresVad ? { vad_model: `${modelsFolder}/${config.vadModelFilename}` } : {}),
				}
				const res: transcript.Transcript = await invoke('transcribe', { options })
				let resultText = transcript.asText(res.segments, m.speakerPrefix())

				resultText = hotkeyNormalizeOutputRef.current ? transcript.normalizeWhitespace(resultText) : resultText.trim()

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
				if (hotkeyOutputModeRef.current === 'type') {
					await invoke('type_text', { text: resultText })
				} else {
					await clipboard.writeText(resultText)
					await notify('Vibe', m.hotkeyTranscriptionCopied())
				}
				finishIndicator('completed', { output: hotkeyOutputModeRef.current })
			} catch (error) {
				console.error('Hotkey transcription error:', error)
				const message = getErrorMessage(error)
				finishIndicator('error', { message })
				await notify('Vibe', message)
			} finally {
				isStoppingRef.current = false
				isHotkeyRecordingRef.current = false
				setIsHotkeyRecording(false)
			}
		})

		return () => {
			unlisten.then((fn) => fn())
		}
	}, [finishIndicator, showIndicator])

	useEffect(() => () => {
		if (indicatorTimerRef.current) window.clearTimeout(indicatorTimerRef.current)
	}, [])

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

		shortcutOperationRef.current = shortcutOperationRef.current.then(setupShortcuts, setupShortcuts)

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
		isHotkeyRecording,
	}

	return <HotkeyContext.Provider value={value}>{children}</HotkeyContext.Provider>
}
