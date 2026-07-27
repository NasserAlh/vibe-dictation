import { ReactNode, createContext, useContext, useEffect, useState } from 'react'
import { useLocalStorage } from 'usehooks-ts'
import { TextFormat } from '~/components/format-select'
import { ModifyState } from '~/lib/types'
import { m } from '~/paraglide/messages.js'
import { message } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import type { ModelMetadata } from '~/lib/model'

type Direction = 'ltr' | 'rtl'
export type HomeTab = 'record' | 'file'

export interface AdvancedTranscribeOptions {
	includeSubFolders: boolean
	skipIfExists: boolean
	saveNextToAudioFile: boolean
}

// Define the type of preference
export interface Preference {
	soundOnFinish: boolean
	setSoundOnFinish: ModifyState<boolean>
	focusOnFinish: boolean
	setFocusOnFinish: ModifyState<boolean>
	modelPath: string | null
	setModelPath: ModifyState<string | null>
	modelMetadata: ModelMetadata | null
	setModelMetadata: ModifyState<ModelMetadata | null>
	modelDisplayNames: Record<string, string>
	setModelDisplayNames: ModifyState<Record<string, string>>
	skippedSetup: boolean
	setSkippedSetup: ModifyState<boolean>
	textAreaDirection: Direction
	setTextAreaDirection: ModifyState<Direction>
	textFormatTranscript: TextFormat
	setTextFormatTranscript: ModifyState<TextFormat>
	modelOptions: ModelOptions
	setModelOptions: ModifyState<ModelOptions>
	theme: 'light' | 'dark'
	setTheme: ModifyState<'light' | 'dark'>
	storeRecordInDocuments: boolean
	setStoreRecordInDocuments: ModifyState<boolean>
	customRecordingPath: string | null
	setCustomRecordingPath: ModifyState<string | null>
	homeTab: HomeTab
	setHomeTab: ModifyState<HomeTab>

	ffmpegOptions: FfmpegOptions
	setFfmpegOptions: ModifyState<FfmpegOptions>
	resetOptions: () => void
	enableSubtitlesPreset: () => void

	advancedTranscribeOptions: AdvancedTranscribeOptions
	setAdvancedTranscribeOptions: ModifyState<AdvancedTranscribeOptions>

	diarizeEnabled: boolean
	setDiarizeEnabled: ModifyState<boolean>
	stableTimestampsEnabled: boolean
	setStableTimestampsEnabled: ModifyState<boolean>

	gpuDevice: number | null
	setGpuDevice: ModifyState<number | null>

	recentLanguages: { code: string; ts: number }[]
	setRecentLanguages: ModifyState<{ code: string; ts: number }[]>
}

// Create the context
const PreferenceContext = createContext<Preference | null>(null)

// Custom hook to use the preference context
export function usePreferenceProvider() {
	return useContext(PreferenceContext) as Preference
}

export interface FfmpegOptions {
	normalize_loudness: boolean
	custom_command: string | null
}

export interface ModelOptions {
	lang: string
	verbose: boolean
	n_threads?: number
	init_prompt?: string
	temperature?: number
	translate?: boolean
	max_text_ctx?: number
	word_timestamps?: boolean
	max_sentence_len?: number
	sampling_strategy: 'greedy' | 'beam search'
	best_of?: number
	beam_size?: number
}

const systemIsDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches

const defaultOptions = {
	soundOnFinish: true,
	focusOnFinish: true,
	modelPath: null,
	modelOptions: {
		init_prompt: '',
		verbose: false,
		// The stored lang matters only for FILE transcription. Dictation ignores
		// it — each dictation hotkey forces its own language (report §11: 'auto'
		// covert-translates this speaker's English to Arabic, and lang:'en'
		// transliterates Arabic speech into Latin script).
		lang: 'auto',
		n_threads: 4,
		temperature: 0.4,
		max_text_ctx: undefined,
		word_timestamps: false,
		max_sentence_len: undefined,
		sampling_strategy: 'beam search' as 'greedy' | 'beam search',
		best_of: 5,
		beam_size: 5,
	},
	ffmpegOptions: {
		normalize_loudness: false,
		custom_command: null,
	},
	storeRecordInDocuments: true,
}

// Preference provider component
export function PreferenceProvider({ children }: { children: ReactNode }) {
	const [modelPath, setModelPath] = useLocalStorage<string | null>('prefs_model_path', null)
	const [modelMetadata, setModelMetadata] = useState<ModelMetadata | null>(null)
	const [modelDisplayNames, setModelDisplayNames] = useLocalStorage<Record<string, string>>('prefs_model_display_names', {})
	const [skippedSetup, setSkippedSetup] = useLocalStorage<boolean>('prefs_skipped_setup', false)
	const [textAreaDirection, setTextAreaDirection] = useLocalStorage<Direction>('prefs_textarea_direction', 'ltr')
	const [textFormatTranscript, setTextFormatTranscript] = useLocalStorage<TextFormat>('prefs_text_format_transcript', 'pdf')
	const [theme, setTheme] = useLocalStorage<'dark' | 'light'>('prefs_theme', systemIsDark ? 'dark' : 'light')
	const [rawHomeTab, setHomeTab] = useLocalStorage<HomeTab>('prefs_home_tab', 'file')
	// Guard against a stale persisted 'link' value from the removed home tab.
	const homeTab: HomeTab = rawHomeTab === 'record' ? 'record' : 'file'

	const [soundOnFinish, setSoundOnFinish] = useLocalStorage('prefs_sound_on_finish', defaultOptions.soundOnFinish)
	const [focusOnFinish, setFocusOnFinish] = useLocalStorage('prefs_focus_on_finish', defaultOptions.focusOnFinish)
	const [modelOptions, setModelOptions] = useLocalStorage<ModelOptions>('prefs_modal_args', defaultOptions.modelOptions)
	const [ffmpegOptions, setFfmpegOptions] = useLocalStorage<FfmpegOptions>('prefs_ffmpeg_options', defaultOptions.ffmpegOptions)
	const [storeRecordInDocuments, setStoreRecordInDocuments] = useLocalStorage('prefs_store_record_in_documents', defaultOptions.storeRecordInDocuments)
	const [customRecordingPath, setCustomRecordingPath] = useLocalStorage<string | null>('prefs_custom_recording_path', null)
	const [advancedTranscribeOptions, setAdvancedTranscribeOptions] = useLocalStorage<AdvancedTranscribeOptions>('prefs_advanced_transcribe_options', {
		includeSubFolders: false,
		saveNextToAudioFile: true,
		skipIfExists: true,
	})

	const [recentLanguages, setRecentLanguages] = useLocalStorage<{ code: string; ts: number }[]>('prefs_recent_languages', [])
	const [diarizeEnabled, setDiarizeEnabled] = useLocalStorage<boolean>('prefs_diarize_enabled', false)
	const [stableTimestampsEnabled, setStableTimestampsEnabled] = useLocalStorage<boolean>('prefs_stable_timestamps_enabled', false)
	const [gpuDevice, setGpuDevice] = useLocalStorage<number | null>('prefs_gpu_device', null)

	useEffect(() => {
		if (!modelPath) {
			setModelMetadata(null)
			return
		}
		invoke<ModelMetadata>('get_model_metadata', { modelPath })
			.then(setModelMetadata)
			.catch((error) => {
				console.error('failed to read model metadata:', error)
				setModelMetadata(null)
			})
	}, [modelPath])

	useEffect(() => {
		if (theme === 'dark') {
			document.documentElement.classList.add('dark')
		} else {
			document.documentElement.classList.remove('dark')
		}
	}, [theme])

	function resetOptions() {
		setSoundOnFinish(defaultOptions.soundOnFinish)
		setFocusOnFinish(defaultOptions.focusOnFinish)
		setModelOptions(defaultOptions.modelOptions)
		setFfmpegOptions(defaultOptions.ffmpegOptions)
		setStoreRecordInDocuments(defaultOptions.storeRecordInDocuments)
		setCustomRecordingPath(null)
		message(m.successAction())
	}

	function enableSubtitlesPreset() {
		setModelOptions({ ...preference.modelOptions, word_timestamps: true, max_sentence_len: 32 })
		setTextFormatTranscript('srt')
		message(m.successAction())
	}

	const preference: Preference = {
		enableSubtitlesPreset,
		resetOptions,
		modelOptions,
		setModelOptions,
		storeRecordInDocuments,
		setStoreRecordInDocuments,
		customRecordingPath,
		setCustomRecordingPath,
		textFormatTranscript,
		setTextFormatTranscript,
		textAreaDirection,
		setTextAreaDirection,
		skippedSetup,
		setSkippedSetup,
		soundOnFinish,
		setSoundOnFinish,
		focusOnFinish,
		setFocusOnFinish,
		modelPath,
		setModelPath,
		modelMetadata,
		setModelMetadata,
		modelDisplayNames,
		setModelDisplayNames,
		theme,
		setTheme,
		homeTab,
		setHomeTab,
		ffmpegOptions,
		setFfmpegOptions,
		advancedTranscribeOptions,
		setAdvancedTranscribeOptions,
		recentLanguages,
		setRecentLanguages,
		diarizeEnabled,
		setDiarizeEnabled,
		stableTimestampsEnabled,
		setStableTimestampsEnabled,
		gpuDevice,
		setGpuDevice,
	}

	return <PreferenceContext.Provider value={preference}>{children}</PreferenceContext.Provider>
}
