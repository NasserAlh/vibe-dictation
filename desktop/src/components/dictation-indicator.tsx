import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { AlertTriangle, Check, Clipboard, Keyboard, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import logoUrl from '../../../design/logo.svg?url'
import { getDictationIndicatorState, type DictationIndicatorState } from '~/lib/dictation-indicator'
import { badgeText, pillContent, type PillContent, type PillLeft, type PillRing } from '~/lib/indicator-content'

// The floating status pill (docs/dictation-indicator-plan.md §4). This
// component only renders what `pillContent` returns — all wording and slot
// decisions live there, unit-tested. Status only; never transcript text.

/** Cross-fade between states and the fade-out before the window hides (§4). */
const FADE_MS = 150
/** Elapsed/“Transcribing N s” refresh rate, driven by requestAnimationFrame. */
const TICK_HZ = 4

interface View {
	state: DictationIndicatorState
	/** performance.now() when this status/phase was entered — the clock for elapsed and hints. */
	since: number
}

/** Keeps the clock when only incidental fields change (e.g. the "still transcribing" hint). */
function nextView(previous: View | null, state: DictationIndicatorState, now: number): View {
	const sameClock = previous !== null && previous.state.sessionId === state.sessionId && previous.state.status === state.status && previous.state.phase === state.phase
	return { state, since: sameClock ? previous.since : now }
}

/** Identity of what is on screen; a change cross-fades, a clock tick does not. */
function contentKey(state: DictationIndicatorState): string {
	return [state.sessionId, state.status, state.phase ?? '', state.message ?? '', state.severity ?? '', state.output ?? '', state.words ?? ''].join('|')
}

function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
	useEffect(() => {
		if (typeof window.matchMedia !== 'function') return
		const query = window.matchMedia('(prefers-reduced-motion: reduce)')
		const onChange = () => setReduced(query.matches)
		query.addEventListener('change', onChange)
		return () => query.removeEventListener('change', onChange)
	}, [])
	return reduced
}

const RING_CLASS: Record<PillRing, string> = {
	grey: 'ring-zinc-500/50 shadow-[0_12px_35px_rgba(0,0,0,0.32),0_2px_8px_rgba(0,0,0,0.22)]',
	green: 'ring-emerald-400/70 shadow-[0_12px_35px_rgba(0,0,0,0.32),0_0_0_4px_rgba(52,211,153,0.10)]',
	red: 'ring-red-500/80 shadow-[0_12px_35px_rgba(0,0,0,0.32),0_0_0_4px_rgba(239,68,68,0.12)]',
	blue: 'ring-blue-400/70 shadow-[0_12px_35px_rgba(0,0,0,0.32),0_0_0_4px_rgba(96,165,250,0.12)]',
	amber: 'ring-amber-400/80 shadow-[0_12px_35px_rgba(0,0,0,0.32),0_0_0_4px_rgba(251,191,36,0.12)]',
}

function LeftSlot({ kind, ring, reducedMotion }: { kind: PillLeft; ring: PillRing; reducedMotion: boolean }) {
	const tone = { grey: 'text-zinc-400', green: 'text-emerald-400', red: 'text-red-400', blue: 'text-blue-400', amber: 'text-amber-400' }[ring]
	switch (kind) {
		case 'spinner':
			return <LoaderCircle className={`h-4 w-4 ${tone} ${reducedMotion ? '' : 'animate-spin'}`} />
		case 'check':
			return <Check className={`h-4 w-4 ${tone}`} strokeWidth={2.5} />
		case 'warning':
			return <AlertTriangle className={`h-4 w-4 ${tone}`} />
		case 'dot':
			// The pulsing dot is also the reduced-motion fallback for the meter (§4).
			return <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.18)]" />
	}
}

function Layer({ content, reducedMotion, fadingSub }: { content: PillContent; reducedMotion: boolean; fadingSub: string | null }) {
	const right = content.right
	// The hint is shown after a short label ("Listening"); when space is
	// tight the hint truncates, never the label. Long labels (error text)
	// only occur without a hint and truncate as usual.
	const sub = content.sub ?? fadingSub
	return (
		<>
			<span className="flex w-5 shrink-0 items-center justify-center">
				<LeftSlot kind={content.left} ring={content.ring} reducedMotion={reducedMotion} />
			</span>
			<span className="flex min-w-0 items-baseline gap-2 overflow-hidden">
				<span dir="auto" className={sub ? 'shrink-0' : 'truncate'}>
					{content.label}
				</span>
				{sub ? (
					<span dir="auto" className={`pill-sub min-w-0 truncate text-xs font-normal text-zinc-400 ${content.sub ? '' : 'pill-sub-leave'}`}>
						{sub}
					</span>
				) : null}
			</span>
			{right && (right.badge || right.elapsed || right.destination || right.text) ? (
				<span dir="ltr" className="ml-auto flex shrink-0 items-center gap-1.5 pl-1 text-xs text-zinc-400">
					{right.text ? <span className="tabular-nums">{right.text}</span> : null}
					{right.badge ? (
						<span dir="ltr" className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-wide text-zinc-200">
							{badgeText(right.badge)}
						</span>
					) : null}
					{right.elapsed ? <span className="tabular-nums">{right.elapsed}</span> : null}
					{right.destination === 'type' ? <Keyboard className="h-3.5 w-3.5" aria-label="type" /> : null}
					{right.destination === 'clipboard' ? <Clipboard className="h-3.5 w-3.5" aria-label="clipboard" /> : null}
				</span>
			) : null}
		</>
	)
}

export default function DictationIndicator() {
	// Null until the backend state arrives — the window can be visible at app
	// startup (seeded "starting" state) while this component is still mounting,
	// and a hardcoded default would flash the wrong status.
	const [view, setView] = useState<View | null>(null)
	const [now, setNow] = useState(() => performance.now())
	const [hiding, setHiding] = useState(false)
	// Previous content kept on screen for FADE_MS during a cross-fade.
	const [leaving, setLeaving] = useState<{ key: string; content: PillContent } | null>(null)
	const lastKeyRef = useRef<string | null>(null)
	const lastContentRef = useRef<PillContent | null>(null)
	const reducedMotion = usePrefersReducedMotion()

	useEffect(() => {
		const log = (event: string, details: Record<string, unknown> = {}) =>
			console.info(`[indicator-window] t=${performance.now().toFixed(1)}ms vis=${document.visibilityState} ${event}`, details)
		log('mounted; registering listen before the initial fetch')
		invoke('dictation_indicator_ready').catch(console.error)
		const apply = (state: DictationIndicatorState) => {
			setHiding(false)
			setView((previous) => nextView(previous, state, performance.now()))
		}
		// Listen first, fetch second (plan §2.6): a state event that lands while
		// the fetch is in flight must win over the (older) fetched snapshot, and
		// one that lands before the listener exists is recovered by the fetch,
		// which runs only after registration completes.
		let eventArrived = false
		const unlistenState = listen<DictationIndicatorState>('dictation-indicator-state', ({ payload }) => {
			eventArrived = true
			log('state event received', { state: payload })
			apply(payload)
		})
		// Rust emits this 150 ms before hiding the window (Prompt 1 step 5).
		const unlistenHide = listen<number>('dictation-indicator-hide', () => {
			log('hide event received')
			setHiding(true)
		})
		unlistenState
			.then(() => {
				log('listen registered; fetching initial state')
				return getDictationIndicatorState()
			})
			.then((initialState) => {
				log('initial state fetch resolved', { state: initialState, appliedFetched: !!initialState && !eventArrived })
				if (initialState && !eventArrived) apply(initialState)
			})
			.catch(console.error)
		return () => {
			unlistenState.then((stop) => stop())
			unlistenHide.then((stop) => stop())
		}
	}, [])

	// Clock for elapsed time and "Transcribing N s…": requestAnimationFrame
	// throttled to TICK_HZ, only while a timed state is on screen.
	const status = view?.state.status
	useEffect(() => {
		if (status !== 'recording' && status !== 'transcribing') return
		let frame = 0
		let last = 0
		const loop = (time: number) => {
			if (time - last >= 1000 / TICK_HZ) {
				last = time
				setNow(performance.now())
			}
			frame = requestAnimationFrame(loop)
		}
		frame = requestAnimationFrame(loop)
		return () => cancelAnimationFrame(frame)
	}, [status])

	const content = view ? pillContent({ ...view.state, since: view.since }, now) : null
	const key = view ? contentKey(view.state) : null

	// The stop hint fades out (FADE_MS) when its 2 s are up instead of
	// vanishing: keep the last hint text around for one animation.
	const [fadingSub, setFadingSub] = useState<string | null>(null)
	const lastSubRef = useRef<string | null>(null)
	const sub = content?.sub ?? null
	useEffect(() => {
		const previous = lastSubRef.current
		lastSubRef.current = sub
		if (sub === null && previous !== null && !reducedMotion) {
			setFadingSub(previous)
			const timer = window.setTimeout(() => setFadingSub(null), FADE_MS)
			return () => window.clearTimeout(timer)
		}
		setFadingSub(null)
	}, [sub, reducedMotion])

	// Cross-fade: when the content identity changes, keep the old layer for
	// FADE_MS while the new one fades in. Clock ticks never trigger this.
	useEffect(() => {
		if (key === null || key === lastKeyRef.current) return
		const previous = lastKeyRef.current !== null ? lastContentRef.current : null
		lastKeyRef.current = key
		if (previous && !reducedMotion) {
			setLeaving({ key: `${lastKeyRef.current}-leaving-${performance.now()}`, content: previous })
			const timer = window.setTimeout(() => setLeaving(null), FADE_MS)
			return () => window.clearTimeout(timer)
		}
	}, [key, reducedMotion])
	if (content) lastContentRef.current = content

	if (!view || !content) return null

	const motion = reducedMotion ? 'pill-no-motion' : ''
	return (
		<div className="flex h-screen w-screen items-center justify-center p-2">
			<div
				className={`pill relative flex h-12 max-w-full items-center gap-2.5 rounded-full bg-zinc-950 px-3.5 text-sm font-medium text-zinc-50 ring-1 ring-inset ${RING_CLASS[content.ring]} ${hiding ? 'pill-hiding' : ''} ${motion}`}
				role="status"
				aria-live="polite"
			>
				<img src={logoUrl} alt="" className="h-6 w-6 shrink-0 rounded-full" />
				<span className="h-5 w-px shrink-0 bg-white/12" />
				<div key={key ?? 'none'} className={`pill-layer flex min-w-0 flex-1 items-center gap-2.5 ${leaving ? 'pill-layer-enter' : ''}`}>
					<Layer content={content} reducedMotion={reducedMotion} fadingSub={fadingSub} />
				</div>
				{leaving ? (
					<div key={leaving.key} className="pill-layer pill-layer-leave pointer-events-none absolute inset-y-0 left-15 right-3.5 flex items-center gap-2.5" aria-hidden="true">
						<Layer content={leaving.content} reducedMotion={reducedMotion} fadingSub={null} />
					</div>
				) : null}
			</div>
		</div>
	)
}
