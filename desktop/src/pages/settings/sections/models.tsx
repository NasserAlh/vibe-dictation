import { useState } from 'react'
import { Copy, FolderOpen, PencilLine } from 'lucide-react'
import * as clipboard from '@tauri-apps/plugin-clipboard-manager'
import { m } from '~/paraglide/messages.js'
import { ReactComponent as FolderIcon } from '~/icons/folder.svg'
import { ReactComponent as WrenchIcon } from '~/icons/wrench.svg'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { SectionCard, type SettingsViewModel } from './shared'
import { getFriendlyModelName } from '~/lib/model'

function ModelsEmptyState({ folder, onOpen }: { folder: string; onOpen: () => void }) {
	const [copied, setCopied] = useState(false)

	async function copyPath() {
		if (!folder) return
		try {
			await clipboard.writeText(folder)
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		} catch (error) {
			console.error(error)
		}
	}

	return (
		<div className="space-y-3 rounded-lg border border-border/60 bg-muted/40 p-4 text-sm">
			<div className="flex items-center gap-2 font-medium">
				<FolderOpen className="size-4 text-muted-foreground" />
				{m.modelsEmptyTitle()}
			</div>
			<p className="text-muted-foreground">{m.modelsEmptyBody()}</p>
			{folder && (
				<code dir="ltr" title={folder} className="block truncate rounded bg-background/70 px-2 py-1 font-mono text-xs">
					{folder}
				</code>
			)}
			<div className="flex flex-wrap items-center gap-1">
				<Button variant="ghost" size="sm" className="h-7 px-2.5 text-muted-foreground hover:text-foreground" onClick={copyPath} disabled={!folder}>
					<Copy className="size-3.5" /> {copied ? m.copied() : m.copyPath()}
				</Button>
				<Button variant="ghost" size="sm" className="h-7 px-2.5 text-muted-foreground hover:text-foreground" onClick={onOpen}>
					<FolderOpen className="size-3.5" /> {m.openFolder()}
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">{m.modelsEmptyDocsHint()}</p>
		</div>
	)
}

export function ModelsSection({ vm }: { vm: SettingsViewModel }) {
	const [editingPath, setEditingPath] = useState<string | null>(null)
	const [editingName, setEditingName] = useState('')
	const currentModel = vm.models.find((model) => model.path === vm.preference.modelPath)

	return (
<div className="space-y-5">
							<SectionCard>
								<div className="space-y-5">
									<div className="space-y-2">
										<Label>{m.selectModel()}</Label>
										{vm.modelsLoaded && vm.models.length === 0 ? (
											<ModelsEmptyState folder={vm.modelsFolderPath} onOpen={vm.openModelPath} />
										) : (
										<>
										<Select
											value={vm.preference.modelPath ?? undefined}
											onValueChange={vm.selectModel}
											onOpenChange={(open) => {
												if (open) vm.loadModels()
											}}>
											<SelectTrigger>
												<SelectValue placeholder={m.selectModel()} />
											</SelectTrigger>
											<SelectContent>
														{vm.models.map((model, index) => (
															<SelectItem key={index} value={model.path}>
																{vm.preference.modelDisplayNames[model.path] ?? getFriendlyModelName(model.name)}
															</SelectItem>
												))}
											</SelectContent>
											</Select>
							{currentModel && (editingPath === currentModel.path ? (
								<div className="flex items-center gap-2">
									<Input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => {
										if (event.key === 'Enter') {
											const name = editingName.trim()
											if (name) vm.preference.setModelDisplayNames({ ...vm.preference.modelDisplayNames, [currentModel.path]: name })
											setEditingPath(null)
										}
										if (event.key === 'Escape') setEditingPath(null)
									}} />
									<Button size="sm" onClick={() => {
										const name = editingName.trim()
										if (name) vm.preference.setModelDisplayNames({ ...vm.preference.modelDisplayNames, [currentModel.path]: name })
										setEditingPath(null)
									}}>{m.save()}</Button>
									<Button variant="ghost" size="sm" onClick={() => setEditingPath(null)}>{m.cancel()}</Button>
								</div>
							) : (
								<div className="mt-2 flex items-center justify-end gap-1 px-1">
									<Button variant="ghost" size="sm" className="h-7 px-2.5 text-muted-foreground hover:text-foreground" onClick={() => vm.openSelectedModel(currentModel.path)}>
										<FolderOpen className="size-3.5" /> {m.showInFolder()}
									</Button>
									<Button variant="ghost" size="sm" className="h-7 px-2.5 text-muted-foreground hover:text-foreground" onClick={() => { setEditingPath(currentModel.path); setEditingName(vm.preference.modelDisplayNames[currentModel.path] ?? getFriendlyModelName(currentModel.name)) }}>
										<PencilLine className="size-3.5" /> {m.rename()}
									</Button>
								</div>
							))}
									</>
									)}
									</div>

									{!vm.isMacOS && (
										<div className="space-y-2">
											<Label>{m.gpuDevice()}</Label>
											{vm.gpuDevices.length > 0 ? (
												<Select
													value={vm.preference.gpuDevice != null ? String(vm.preference.gpuDevice) : 'auto'}
													onValueChange={(value) => {
														vm.preference.setGpuDevice(value === 'auto' ? null : parseInt(value, 10))
													}}>
													<SelectTrigger>
														<SelectValue placeholder={m.gpuDevice()} />
													</SelectTrigger>
													<SelectContent>
									<SelectItem value="auto">{m.auto()}</SelectItem>
														{vm.gpuDevices.map((device) => (
															<SelectItem key={device.index} value={String(device.index)}>
																{device.description}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											) : (
												<Input
													type="number"
													value={vm.preference.gpuDevice ?? ''}
													onChange={(e) => {
														const val = e.target.value
														vm.preference.setGpuDevice(val === '' ? null : parseInt(val, 10))
													}}
													placeholder={m.gpuDevicePlaceholder()}
												/>
											)}
										</div>
									)}

									<div className="space-y-1 pt-1">
										<Button
											variant="ghost"
											onMouseDown={vm.openModelPath}
											className="h-11 w-full justify-between rounded-lg px-3 font-medium hover:bg-accent/60">
											{m.modelsFolder()} <FolderIcon className="h-4 w-4 text-muted-foreground" />
										</Button>
										<Button
											variant="ghost"
											onMouseDown={vm.changeModelsFolder}
											className="h-11 w-full justify-between rounded-lg px-3 font-medium hover:bg-accent/60">
											{m.changeModelsFolder()} <WrenchIcon className="h-4 w-4 text-muted-foreground" />
										</Button>
									</div>
								</div>
							</SectionCard>

						</div>
	)
}
