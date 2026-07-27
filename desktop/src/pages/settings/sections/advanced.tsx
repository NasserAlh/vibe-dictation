import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { LazyStore } from '@tauri-apps/plugin-store'
import { storeFilename } from '~/lib/config'
import { m } from '~/paraglide/messages.js'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { ReactComponent as CopyIcon } from '~/icons/copy.svg'
import { ReactComponent as FolderIcon } from '~/icons/folder.svg'
import { ReactComponent as ResetIcon } from '~/icons/reset.svg'
import { SectionCard } from './shared'
import type { SettingsViewModel } from './shared'

const configStore = new LazyStore(storeFilename)

// Dev builds must never write the autostart Run entry — a dev instance would
// point login-autostart at a transient target\debug exe (same store, same
// identifier as the installed app). Mirror of the cfg!(debug_assertions) gate
// in main.rs.
const isDevBuild = import.meta.env.DEV

export function AdvancedSection({ vm }: { vm: SettingsViewModel }) {
	const [autostartEnabled, setAutostartEnabled] = useState(false)

	useEffect(() => {
		// Reflect the stored preference (source of truth), not the plugin's own
		// isEnabled — which compares against its unquoted format and would read
		// false against our quoted Run entry (v1.0.0 §5c cosmetic bug). Default:
		// ON in release (matches the main.rs startup default), OFF in dev.
		configStore
			.get<boolean>('autostart_enabled')
			.then((value) => setAutostartEnabled(value ?? !isDevBuild))
			.catch(console.error)
	}, [])

	async function changeAutostartEnabled(enabled: boolean) {
		if (isDevBuild) return
		setAutostartEnabled(enabled)
		try {
			// set_autostart owns the quoted HKCU Run-entry write (crate::autostart);
			// it is release-only and no-ops in dev builds.
			await invoke('set_autostart', { enabled })
			// Persist the preference so the startup sync (main.rs) respects it:
			// ON → re-write the quoted entry with the current exe path each launch;
			// OFF → never touch.
			await configStore.set('autostart_enabled', enabled)
			await configStore.save()
		} catch (error) {
			setAutostartEnabled(!enabled)
			console.error(error)
		}
	}

	return (
		<div className="space-y-5">
			<SectionCard>
				<div className="flex items-center justify-between gap-3">
					<span className="text-sm font-medium">{m.startAtLogin()}</span>
					<Switch checked={autostartEnabled} onCheckedChange={changeAutostartEnabled} disabled={isDevBuild} />
				</div>
			</SectionCard>
			<div className="divide-y divide-border/45 rounded-2xl border border-border/60 bg-card/92 shadow-xs">
				<Button variant="ghost" onMouseDown={vm.copyLogs} className="h-12 w-full justify-between rounded-none px-4 font-medium first:rounded-t-2xl last:rounded-b-2xl hover:bg-accent/55">{m.copyLogs()} <CopyIcon className="h-4 w-4 text-muted-foreground" /></Button>
				<Button variant="ghost" onMouseDown={vm.revealLogs} className="h-12 w-full justify-between rounded-none px-4 font-medium first:rounded-t-2xl last:rounded-b-2xl hover:bg-accent/55">{m.logsFolder()} <FolderIcon className="h-4 w-4 text-muted-foreground" /></Button>
				<Button variant="ghost" onMouseDown={vm.revealTemp} className="h-12 w-full justify-between rounded-none px-4 font-medium first:rounded-t-2xl last:rounded-b-2xl hover:bg-accent/55">{m.tempFolder()} <FolderIcon className="h-4 w-4 text-muted-foreground" /></Button>
				<Button variant="ghost" onClick={vm.askAndReset} className="h-12 w-full justify-between rounded-none px-4 font-medium text-destructive first:rounded-t-2xl last:rounded-b-2xl hover:bg-destructive/12 hover:text-destructive">{m.resetApp()} <ResetIcon className="h-5 w-5" /></Button>
			</div>
		</div>
	)
}
