import { useMemo, useState } from 'react'
import { Mic, Settings as SettingsIcon } from 'lucide-react'
import { useHotkeyProvider } from '~/providers/hotkey'
import { Button } from '~/components/ui/button'
import SettingsPage from '~/pages/settings/page'
import { m } from '~/paraglide/messages.js'

export default function DictationHome() {
	const hotkey = useHotkeyProvider()
	const [settingsVisible, setSettingsVisible] = useState(false)

	// Same chip formatting as the Dictation settings section
	const isMac = navigator.platform.toUpperCase().includes('MAC')
	const shortcutRows = useMemo(() => {
		const keyMap: Record<string, string> = { CmdOrCtrl: isMac ? '⌘' : 'Ctrl', Cmd: '⌘', Ctrl: isMac ? '⌃' : 'Ctrl', Shift: isMac ? '⇧' : 'Shift', Alt: isMac ? '⌥' : 'Alt', Option: '⌥' }
		const keysOf = (shortcut: string) => shortcut.split('+').map((key) => keyMap[key] ?? key)
		return [
			{ label: m.hotkeyShortcutEnglish(), keys: keysOf(hotkey.hotkeyShortcut) },
			{ label: m.hotkeyShortcutArabic(), keys: keysOf(hotkey.hotkeyShortcutAr) },
		]
	}, [hotkey.hotkeyShortcut, hotkey.hotkeyShortcutAr, isMac])

	if (settingsVisible) return <SettingsPage setVisible={setSettingsVisible} />

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
			<Mic className={`h-16 w-16 ${hotkey.isHotkeyRecording ? 'text-primary animate-pulse' : 'text-muted-foreground'}`} />
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">{m.appTitle()}</h1>
				{hotkey.hotkeyEnabled ? (
					<div className="space-y-1.5">
						{shortcutRows.map((row) => (
							<p key={row.label} className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
								<span>{row.label}</span>
								{row.keys.map((key, i) => (
									<kbd
										key={i}
										className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border/80 bg-background/70 px-1.5 font-mono text-[11px] font-medium text-foreground/80 shadow-[0_1px_0_1px_rgba(0,0,0,0.04)]">
										{key}
									</kbd>
								))}
							</p>
						))}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">{m.globalHotkeyEnabled()}</p>
				)}
			</div>
			<Button variant="outline" onClick={() => setSettingsVisible(true)}>
				<SettingsIcon className="mr-2 h-4 w-4" />
				{m.settings()}
			</Button>
		</div>
	)
}
