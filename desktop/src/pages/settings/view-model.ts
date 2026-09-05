import { invoke } from '@tauri-apps/api/core'
import { ask, message, open } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import { useEffect, useRef, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import * as clipboard from '@tauri-apps/plugin-clipboard-manager'
import * as fs from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import * as config from '~/lib/config'
import { NamedPath } from '~/lib/types'
import { ls } from '~/lib/fs'
import { resetApp } from '~/lib/app'
import { usePreferenceProvider } from '~/providers/preference'
import { UnlistenFn, listen } from '@tauri-apps/api/event'
import { load } from '@tauri-apps/plugin-store'
import { useStoreValue } from '~/lib/use-store-value'
import { getPrettyVersion } from '~/lib/logs'
import { formatModelSize, isModelFile, type ModelMetadata } from '~/lib/model'
import {
	cancelModelDownload as invokeCancelModelDownload,
	downloadModel,
	listDownloadableModels,
	modelDownloadProgressEvent,
	type DownloadableModel,
	type ModelDownloadProgress,
} from '~/lib/model-download'

export interface GpuDevice {
	index: number
	name: string
	description: string
	type: string
}

async function openModelPath() {
	const dst = await invoke<string>('get_models_folder')
	invoke('open_path', { path: dst })
}

async function openSelectedModel(path: string | null) {
	if (path) await invoke('open_path', { path })
}

async function revealLogs() {
	await invoke<string>('show_log_path')
}

async function revealTemp() {
	await invoke<string>('show_temp_path')
}

async function copyLogs() {
	const logs = await invoke<string>('get_logs')
	const templated = `<details>
<summary>logs</summary>

\`\`\`console
${logs}
\`\`\`
</details>
`
	clipboard.writeText(templated)
}

export function viewModel() {
	const [isLogToFileSet, setLogToFile] = useStoreValue<boolean>('prefs_log_to_file')

	const [models, setModels] = useState<NamedPath[]>([])
	const [modelsFolderPath, setModelsFolderPath] = useState('')
	const [modelsLoaded, setModelsLoaded] = useState(false)
	const [downloadableModels, setDownloadableModels] = useState<DownloadableModel[]>([])
	const [modelDownload, setModelDownload] = useState<ModelDownloadProgress | null>(null)
	// Progress events race the invoke resolution over IPC; without this guard a
	// final event landing after cleanup would resurrect the progress bar.
	const modelDownloadActiveRef = useRef(false)
	const [appVersion, setAppVersion] = useState('')
	const preference = usePreferenceProvider()
	const listenersRef = useRef<UnlistenFn[]>([])
	const [gpuDevices, setGpuDevices] = useState<GpuDevice[]>([])
	const isMacOS = platform() === 'macos'

	async function notifyModelMissing(filename: string, modelsFolder: string) {
		await message(`This feature requires "${filename}". Place the file in your models folder, then try again.`, {
			title: m.modelsFolder(),
			kind: 'info',
		})
		invoke('open_path', { path: modelsFolder })
	}

	async function askAndReset() {
		const yes = await ask(m.resetAskDialog(), { kind: 'info' })
		if (yes) {
			resetApp()
		}
	}

	async function loadMeta() {
		try {
			const prettyVersion = await getPrettyVersion()
			setAppVersion(prettyVersion)
		} catch (e) {
			console.error(e)
		}
	}

	async function loadModels() {
		const modelsFolder = await invoke<string>('get_models_folder')
		setModelsFolderPath(modelsFolder)
		const entries = await ls(modelsFolder)
		const found = entries.filter((e) => isModelFile(e.name))
		setModels(found)
		setModelsLoaded(true)
		if (preference.modelPath && !found.some((model) => model.path === preference.modelPath)) {
			preference.setModelPath(null)
		}
	}

	// No silent default: a model becomes the saved preference only through
	// selectModel (the dropdown, or a download completing with nothing
	// selected). Auto-picking the first file in the folder made the dropdown
	// show a choice the user never made (found gating v1.5.0, 2026-09-05).

	async function readModelMetadata(modelPath: string) {
		try {
			return await invoke<ModelMetadata>('get_model_metadata', { modelPath })
		} catch (error) {
			// Unknown GGUF formats may still be loadable by Sona (for example Whisper GGUF).
			console.error('failed to read GGUF metadata:', error)
			return null
		}
	}

	async function ensureRequiredVad(metadata: ModelMetadata | null) {
		if (!metadata?.capabilities.requires_vad) return true
		const modelsFolder = await invoke<string>('get_models_folder')
		const vadPath = await join(modelsFolder, config.vadModelFilename)
		if (await fs.exists(vadPath)) return true

		await notifyModelMissing(config.vadModelFilename, modelsFolder)
		return false
	}

	function applyModelLanguage(metadata: ModelMetadata | null) {
		if (!metadata) return
		const capabilities = metadata.capabilities
		const currentLanguage = preference.modelOptions.lang
		const isSupported = currentLanguage === 'auto' ? capabilities.language_detection : capabilities.languages.includes(currentLanguage)
		if (isSupported) return
		preference.setModelOptions({
			...preference.modelOptions,
			lang: capabilities.language_detection ? 'auto' : capabilities.languages[0] ?? 'en',
		})
	}

	async function selectModel(modelPath: string) {
		const metadata = await readModelMetadata(modelPath)
		if (!(await ensureRequiredVad(metadata))) return
		preference.setModelMetadata(metadata)
		applyModelLanguage(metadata)
		preference.setModelPath(modelPath)
	}

	async function loadDownloadableModels() {
		try {
			setDownloadableModels(await listDownloadableModels())
		} catch (error) {
			console.error(error)
			setDownloadableModels([])
		}
	}

	async function startModelDownload(model: DownloadableModel) {
		const yes = await ask(m.modelDownloadConfirmBody({ size: formatModelSize(model.sizeBytes), url: model.url }), {
			title: m.modelDownloadConfirmTitle(),
			kind: 'warning',
		})
		if (!yes) return
		modelDownloadActiveRef.current = true
		setModelDownload({ id: model.id, downloaded: 0, total: model.sizeBytes })
		try {
			const path = await downloadModel(model.id)
			if (path) {
				await loadModels()
				if (!preference.modelPath) await selectModel(path)
			}
		} catch (error) {
			console.error(error)
			const detail = (error as { message?: string })?.message ?? String(error)
			await message(detail, { title: m.modelDownloadFailedTitle(), kind: 'error' })
		} finally {
			modelDownloadActiveRef.current = false
			setModelDownload(null)
			await loadDownloadableModels()
		}
	}

	function cancelModelDownload() {
		invokeCancelModelDownload().catch(console.error)
	}

	async function onModelDownloadProgress() {
		listenersRef.current.push(
			await listen<ModelDownloadProgress>(modelDownloadProgressEvent, (event) => {
				if (modelDownloadActiveRef.current) setModelDownload(event.payload)
			}),
		)
	}

	async function changeModelsFolder() {
		const path = await open({ directory: true, multiple: false })
		if (path) {
			const store = await load(config.storeFilename)
			await store.set('models_folder', path)
			await store.save()
			await loadModels()
		}
	}

	async function onWindowFocus() {
		listenersRef.current.push(await listen('tauri://focus', loadModels))
	}

	async function loadGpuDevices() {
		try {
			const devices = await invoke<GpuDevice[]>('get_gpu_devices')
			setGpuDevices(devices)
		} catch (error) {
			console.error(error)
			setGpuDevices([])
		}
	}

	useEffect(() => {
		loadMeta()
		loadModels()
		loadGpuDevices()
		loadDownloadableModels()
		onModelDownloadProgress()
		onWindowFocus()
		return () => {
			listenersRef.current.forEach((unlisten) => unlisten())
		}
	}, [])

	return {
		copyLogs,
		isLogToFileSet,
		setLogToFile,
		preference: preference,
		askAndReset,
		openModelPath,
		openSelectedModel,
		revealLogs,
		revealTemp,
		models,
		modelsFolderPath,
		modelsLoaded,
		appVersion,
		loadModels,
		selectModel,
		changeModelsFolder,
		downloadableModels,
		modelDownload,
		startModelDownload,
		cancelModelDownload,
		gpuDevices,
		isMacOS,
	}
}
