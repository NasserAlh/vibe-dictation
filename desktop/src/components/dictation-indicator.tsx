import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { AlertTriangle, Check, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import logoUrl from '../../../design/logo.svg?url'
import { getDictationIndicatorState, type DictationIndicatorState } from '~/lib/dictation-indicator'

export default function DictationIndicator() {
	// Null until the backend state arrives — the window can be visible at app
	// startup (seeded "starting" state) while this component is still mounting,
	// and a hardcoded default would flash the wrong status.
	const [state, setState] = useState<DictationIndicatorState | null>(null)

	useEffect(() => {
		// Prompt 0 instrumentation (§2.6): order of listen registration vs the
		// initial fetch.
		const log = (event: string, details: Record<string, unknown> = {}) =>
			console.info(`[indicator-window] t=${performance.now().toFixed(1)}ms vis=${document.visibilityState} ${event}`, details)
		log('mounted; registering listen before the initial fetch')
		invoke('dictation_indicator_ready').catch(console.error)
		// Listen first, fetch second (plan §2.6): a state event that lands while
		// the fetch is in flight must win over the (older) fetched snapshot, and
		// one that lands before the listener exists is recovered by the fetch,
		// which runs only after registration completes.
		let eventArrived = false
		const unlisten = listen<DictationIndicatorState>('dictation-indicator-state', ({ payload }) => {
			eventArrived = true
			log('state event received', { state: payload })
			setState(payload)
		})
		unlisten
			.then(() => {
				log('listen registered; fetching initial state')
				return getDictationIndicatorState()
			})
			.then((initialState) => {
				log('initial state fetch resolved', { state: initialState, appliedFetched: !!initialState && !eventArrived })
				if (initialState && !eventArrived) setState(initialState)
			})
			.catch(console.error)
		return () => {
			unlisten.then((stop) => stop())
		}
	}, [])

	if (!state) return null

	const content = {
		starting: { icon: <LoaderCircle className="h-4 w-4 animate-spin text-zinc-400" />, label: m.dictationIndicatorStarting() },
		ready: { icon: <Check className="h-4 w-4 text-emerald-400" />, label: m.dictationIndicatorReady({ shortcuts: state.message ?? '' }) },
		recording: { icon: <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.18)]" />, label: m.dictationIndicatorListening() },
		transcribing: { icon: <LoaderCircle className="h-4 w-4 animate-spin text-blue-400" />, label: m.dictationIndicatorTranscribing() },
		completed: { icon: <Check className="h-4 w-4 text-emerald-400" />, label: state.output === 'type' ? m.dictationIndicatorInserted() : m.dictationIndicatorCopied() },
		error: { icon: <AlertTriangle className="h-4 w-4 text-red-400" />, label: state.message || m.dictationIndicatorError() },
	}[state.status]

	return (
		<div className="flex h-screen w-screen items-center justify-center p-2">
			<div className="flex h-12 min-w-56 max-w-full items-center gap-2.5 rounded-full border border-white/10 bg-zinc-950 px-3.5 text-sm font-medium text-zinc-50 shadow-[0_12px_35px_rgba(0,0,0,0.32),0_2px_8px_rgba(0,0,0,0.22)]">
				<img src={logoUrl} alt="" className="h-6 w-6 shrink-0 rounded-full" />
				<span className="h-5 w-px bg-white/12" />
				<span className="shrink-0">{content.icon}</span>
				<span className="truncate">{content.label}</span>
			</div>
		</div>
	)
}
