import { useCallback, useEffect, useMemo, useState } from 'react'
import { m } from '~/paraglide/messages.js'
import { InfoTooltip } from '~/components/info-tooltip'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import { useHotkeyProvider, type HotkeyActivationMode, type HotkeyOutputMode } from '~/providers/hotkey'
import { Field, SectionCard } from './shared'
import { getDictationIndicatorEnabled, setDictationIndicatorEnabled } from '~/lib/dictation-indicator'
import { listOllamaModels, type OllamaModel } from '~/lib/ollama'
import { acceleratorsCollide } from '~/lib/accelerator'

export function DictationSection() {
	const hotkey = useHotkeyProvider()
	const [indicatorEnabled, setIndicatorEnabled] = useState(true)
	useEffect(() => {
		getDictationIndicatorEnabled().then(setIndicatorEnabled).catch(console.error)
	}, [])
	async function changeIndicatorEnabled(enabled: boolean) {
		setIndicatorEnabled(enabled)
		try {
			await setDictationIndicatorEnabled(enabled)
		} catch (error) {
			setIndicatorEnabled(!enabled)
			console.error(error)
		}
	}
	const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
	const [ollamaUnreachable, setOllamaUnreachable] = useState(false)
	const refreshOllamaModels = useCallback(async () => {
		try {
			const models = await listOllamaModels(hotkey.hotkeyLlmPort)
			setOllamaModels(models)
			setOllamaUnreachable(false)
		} catch (error) {
			console.error('Failed to list Ollama models:', error)
			setOllamaModels([])
			setOllamaUnreachable(true)
		}
	}, [hotkey.hotkeyLlmPort])
	useEffect(() => {
		if (hotkey.hotkeyLlmEnabled) refreshOllamaModels()
	}, [hotkey.hotkeyLlmEnabled, refreshOllamaModels])
	const isMac = navigator.platform.toUpperCase().includes('MAC')
	const activationLabels = {
		'push-to-talk': m.hotkeyActivationPushToTalk,
		toggle: m.hotkeyActivationToggle,
	} as const
	const activationDescriptions = {
		'push-to-talk': m.hotkeyActivationPushToTalkDescription,
		toggle: m.hotkeyActivationToggleDescription,
	} as const
	const outputLabels = {
		clipboard: m.hotkeyOutputClipboard,
		type: m.hotkeyOutputType,
	} as const
	const shortcutKeysOf = useCallback(
		(shortcut: string) => {
			const keyMap: Record<string, string> = { CmdOrCtrl: isMac ? '⌘' : 'Ctrl', Cmd: '⌘', Ctrl: isMac ? '⌃' : 'Ctrl', Shift: isMac ? '⇧' : 'Shift', Alt: isMac ? '⌥' : 'Alt', Option: '⌥' }
			return shortcut.split('+').map((key) => keyMap[key] ?? key)
		},
		[isMac],
	)
	const shortcutKeys = useMemo(() => shortcutKeysOf(hotkey.hotkeyShortcut), [hotkey.hotkeyShortcut, shortcutKeysOf])
	const shortcutKeysAr = useMemo(() => shortcutKeysOf(hotkey.hotkeyShortcutAr), [hotkey.hotkeyShortcutAr, shortcutKeysOf])
	// Must match the provider's registration-skip comparison exactly, or the
	// warning asserts the opposite of what actually registered.
	const shortcutsConflict = acceleratorsCollide(hotkey.hotkeyShortcut, hotkey.hotkeyShortcutAr)
	return (
<div className="space-y-5">
							<p className="px-1 text-sm text-muted-foreground">{m.globalDictationPromo()}</p>
							<SectionCard>
								<div className="space-y-4">
									<div className="flex items-center justify-between">
										<span className="text-sm font-medium">{m.globalHotkeyEnabled()}</span>
										<Switch checked={hotkey.hotkeyEnabled} onCheckedChange={hotkey.setHotkeyEnabled} />
									</div>

									{hotkey.hotkeyEnabled && (
										<>
											<div className="flex items-center justify-between gap-3">
												<span className="flex items-center gap-1 text-sm font-medium">
													<InfoTooltip text={m.dictationIndicatorSettingInfo()} />
													{m.dictationIndicatorSetting()}
												</span>
												<Switch checked={indicatorEnabled} onCheckedChange={changeIndicatorEnabled} />
											</div>
											<div className="flex items-center justify-between gap-3">
												<span className="flex items-center gap-1 text-sm font-medium">
													<InfoTooltip text={m.liveDictationSettingInfo()} />
													{m.liveDictationSetting()}
												</span>
												<Switch checked={hotkey.hotkeyLiveDictation} onCheckedChange={hotkey.setHotkeyLiveDictation} disabled={hotkey.hotkeyOutputMode !== 'type'} />
											</div>
											<div className="flex items-center justify-between gap-3">
												<span className="flex items-center gap-1 text-sm font-medium">
													<InfoTooltip text={m.modelWarmupSettingInfo()} />
													{m.modelWarmupSetting()}
												</span>
												<Switch checked={hotkey.hotkeyModelWarmup} onCheckedChange={hotkey.setHotkeyModelWarmup} />
											</div>
											<div className="h-px bg-border/45" />
											<Field label={m.hotkeyActivationMode()}>
												<div className="flex gap-2">
													{(['push-to-talk', 'toggle'] as HotkeyActivationMode[]).map((mode) => (
														<button
															key={mode}
															type="button"
															onClick={() => hotkey.setHotkeyActivationMode(mode)}
															className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
																hotkey.hotkeyActivationMode === mode
																	? 'border-primary bg-primary/10 text-primary'
																	: 'border-border/65 bg-background/50 text-muted-foreground hover:bg-accent/40'
															}`}>
										{activationLabels[mode]()}
														</button>
													))}
												</div>
											</Field>
											<p className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
												<InfoTooltip text={m.hotkeyLanguageInfo()} />
												{m.hotkeyLanguageNote()}
											</p>
											<Field
												label={
													<span className="flex items-center gap-2">
														{m.hotkeyShortcutEnglish()}
														<span className="flex items-center gap-1">
															{shortcutKeys.map((key, i) => (
																<kbd
																	key={i}
																	className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border/80 bg-background/70 px-1.5 font-mono text-[11px] font-medium text-foreground/80 shadow-[0_1px_0_1px_rgba(0,0,0,0.04)]">
																	{key}
																</kbd>
															))}
														</span>
													</span>
												}>
												<Input
													type="text"
													value={hotkey.hotkeyShortcut}
													onChange={(e) => hotkey.setHotkeyShortcut(e.target.value)}
												/>
											</Field>
											<Field
												label={
													<span className="flex items-center gap-2">
														{m.hotkeyShortcutArabic()}
														<span className="flex items-center gap-1">
															{shortcutKeysAr.map((key, i) => (
																<kbd
																	key={i}
																	className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border/80 bg-background/70 px-1.5 font-mono text-[11px] font-medium text-foreground/80 shadow-[0_1px_0_1px_rgba(0,0,0,0.04)]">
																	{key}
																</kbd>
															))}
														</span>
													</span>
												}>
												<Input
													type="text"
													value={hotkey.hotkeyShortcutAr}
													onChange={(e) => hotkey.setHotkeyShortcutAr(e.target.value)}
												/>
												{shortcutsConflict && <p className="text-xs text-destructive">{m.hotkeyShortcutConflict()}</p>}
											</Field>
											<div className="flex gap-2">
												{(['clipboard', 'type'] as HotkeyOutputMode[]).map((mode) => (
													<button
														key={mode}
														type="button"
														onClick={() => hotkey.setHotkeyOutputMode(mode)}
														className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
															hotkey.hotkeyOutputMode === mode
																? 'border-primary bg-primary/10 text-primary'
																: 'border-border/65 bg-background/50 text-muted-foreground hover:bg-accent/40'
														}`}>
									{outputLabels[mode]()}
													</button>
												))}
											</div>
											<p className="text-xs italic text-muted-foreground">
								{activationDescriptions[hotkey.hotkeyActivationMode]()}
											</p>

											<div className="h-px bg-border/45" />

											<div className="flex items-center justify-between gap-3">
												<span className="flex items-center gap-1 text-sm font-medium">
													<InfoTooltip text={m.normalizeHotkeyOutputInfo()} />
													{m.normalizeHotkeyOutput()}
												</span>
												<Switch checked={hotkey.hotkeyNormalizeOutput} onCheckedChange={hotkey.setHotkeyNormalizeOutput} />
											</div>

											<div className="h-px bg-border/45" />

											<Field
												label={
													<span className="flex items-center gap-1">
														<InfoTooltip text={m.vocabularySettingInfo()} />
														{m.vocabularySetting()}
													</span>
												}>
												<Textarea
													rows={5}
													placeholder={m.vocabularyPlaceholder()}
													value={hotkey.hotkeyVocabulary}
													onChange={(e) => hotkey.setHotkeyVocabulary(e.target.value)}
												/>
											</Field>

											<div className="h-px bg-border/45" />

											<div className="flex items-center justify-between gap-3">
												<span className="flex items-center gap-1 text-sm font-medium">
													<InfoTooltip text={m.llmFormatInfo()} />
													{m.llmFormatEnabled()}
												</span>
												<Switch checked={hotkey.hotkeyLlmEnabled} onCheckedChange={hotkey.setHotkeyLlmEnabled} />
											</div>

											{hotkey.hotkeyLlmEnabled && (
												<>
													<Field label={m.llmFormatModel()}>
														<div className="flex gap-2">
															<NativeSelect value={hotkey.hotkeyLlmModel} onChange={(e) => hotkey.setHotkeyLlmModel(e.target.value)}>
																<option value="">{ollamaModels.length === 0 ? m.llmFormatNoModels() : m.llmFormatSelectModel()}</option>
																{hotkey.hotkeyLlmModel && !ollamaModels.some((model) => model.name === hotkey.hotkeyLlmModel) && (
																	<option value={hotkey.hotkeyLlmModel}>{hotkey.hotkeyLlmModel}</option>
																)}
																{ollamaModels.map((model) => (
																	<option key={model.name} value={model.name}>
																		{model.name}
																	</option>
																))}
															</NativeSelect>
															<Button variant="ghost" className="h-11 rounded-xl border border-border/55 px-3.5" onClick={refreshOllamaModels}>
																{m.llmFormatRefresh()}
															</Button>
														</div>
														{ollamaUnreachable && <p className="text-xs text-destructive">{m.llmFormatUnreachable()}</p>}
													</Field>
													<Field
														label={
															<span className="flex items-center gap-1">
																<InfoTooltip text={m.llmFormatPromptInfo()} />
																{m.llmFormatPrompt()}
															</span>
														}>
														<Textarea rows={4} value={hotkey.hotkeyLlmPrompt} onChange={(e) => hotkey.setHotkeyLlmPrompt(e.target.value)} />
													</Field>
													<Field label={m.llmFormatPort()}>
														<Input
															type="number"
															min={1}
															max={65535}
															value={hotkey.hotkeyLlmPort}
															onChange={(e) => {
																const port = Number(e.target.value)
																if (Number.isInteger(port) && port > 0 && port <= 65535) hotkey.setHotkeyLlmPort(port)
															}}
														/>
													</Field>
												</>
											)}
										</>
									)}
								</div>
							</SectionCard>
						</div>
	)
}
