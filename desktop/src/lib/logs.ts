import { app } from '@tauri-apps/api'
import { invoke } from '@tauri-apps/api/core'

export async function getPrettyVersion() {
	const appVersion = await app.getVersion()
	const appName = await app.getName()
	let version = `${appName} ${appVersion}`
	const avx2Enabled = await invoke('is_avx2_enabled')
	if (!avx2Enabled) {
		version += ` (older cpu)`
	}
	return version
}

