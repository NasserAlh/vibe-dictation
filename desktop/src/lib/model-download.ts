import { invoke } from '@tauri-apps/api/core'

export interface DownloadableModel {
	id: string
	filename: string
	url: string
	sha256: string
	sizeBytes: number
	isDefault: boolean
	installed: boolean
}

export interface ModelDownloadProgress {
	id: string
	downloaded: number
	total: number
}

export const modelDownloadProgressEvent = 'model_download_progress'

// Empty in builds compiled without the model-download cargo feature — the
// settings UI hides the download card entirely in that case.
export async function listDownloadableModels(): Promise<DownloadableModel[]> {
	return await invoke<DownloadableModel[]>('list_downloadable_models')
}

// Resolves with the downloaded file's path, or null if the user cancelled.
export async function downloadModel(modelId: string): Promise<string | null> {
	return await invoke<string | null>('download_model', { modelId })
}

export async function cancelModelDownload(): Promise<void> {
	await invoke('cancel_model_download')
}
