import { ModifyState, NamedPath } from './types'
import { pathToNamedPath } from './fs'
import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import * as config from '~/lib/config'

interface UseSingleInstanceProps {
	setFiles: ModifyState<NamedPath[]>
}

export function useSingleInstance({ setFiles }: UseSingleInstanceProps) {
	async function handleSingleInstance() {
		await listen<string[]>('single-instance', async (event) => {
			const argv = event.payload

			const newFiles: NamedPath[] = []
			for (const arg of argv) {
				if (config.audioExtensions.some((e) => arg.endsWith(e)) || config.videoExtensions.some((e) => arg.endsWith(e))) {
					newFiles.push(await pathToNamedPath(arg))
				}
			}
			if (newFiles.length > 0) {
				setFiles([...newFiles])
			}
		})
	}

	useEffect(() => {
		handleSingleInstance()
	}, [])
}
