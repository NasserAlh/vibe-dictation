// Where a finished dictation goes. Pure, so the rule is unit-tested in one
// place. The rule (plan §4, and the v1.5.0 gating finding of 2026-09-05): text
// is typed only into the window that held the cursor when the user finished
// speaking; if focus moved while transcription or formatting ran — a 40 s
// Ollama cold load, in the finding — it goes to the clipboard instead and the
// pill says so. Live dictation already followed this rule via its frozen flag.

export interface DeliveryInput {
	output: 'type' | 'clipboard'
	/** A live-dictation session typed partials at the cursor. */
	liveSession: boolean
	/** Live dictation refused an injection because focus left the target. */
	liveFrozen: boolean
	/** The foreground window is no longer the one recorded at key release. */
	foregroundChanged: boolean
}

export interface DeliveryPlan {
	path: 'type' | 'clipboard'
	/** True when the user asked for typing but got the clipboard — amber pill. */
	focusLost: boolean
}

export function planDelivery(input: DeliveryInput): DeliveryPlan {
	if (input.output !== 'type') return { path: 'clipboard', focusLost: false }
	const lost = input.liveSession ? input.liveFrozen : input.foregroundChanged
	return lost ? { path: 'clipboard', focusLost: true } : { path: 'type', focusLost: false }
}
