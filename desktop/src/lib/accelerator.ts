// Comparison-normalization mirroring how the global-hotkey crate parses
// accelerators: per-token trim + case-fold + modifier-alias folding (on
// Windows CmdOrCtrl/CommandOrControl/Control all mean Ctrl), with modifier
// order irrelevant because the parser builds a bitflag set. Two strings that
// normalize equal would collide inside RegisterHotKey even though they differ
// as text — the settings conflict warning and the registration skip must both
// use THIS comparison, or a spelling variant leaves a hotkey silently dead.
const WINDOWS_TOKEN_ALIASES: Record<string, string> = {
	CMDORCTRL: 'CTRL',
	COMMANDORCONTROL: 'CTRL',
	CONTROL: 'CTRL',
	CMD: 'SUPER',
	COMMAND: 'SUPER',
	META: 'SUPER',
	WIN: 'SUPER',
	WINDOWS: 'SUPER',
	OPTION: 'ALT',
	RETURN: 'ENTER',
}

export function normalizeAccelerator(accelerator: string): string {
	return accelerator
		.split('+')
		.map((token) => token.trim().toUpperCase())
		.filter((token) => token !== '')
		.map((token) => WINDOWS_TOKEN_ALIASES[token] ?? token)
		.sort()
		.join('+')
}

export function acceleratorsCollide(a: string, b: string): boolean {
	const normalizedA = normalizeAccelerator(a)
	return normalizedA !== '' && normalizedA === normalizeAccelerator(b)
}
