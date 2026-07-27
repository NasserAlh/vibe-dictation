import { useEffect } from 'react'
import { getTextDirection } from '~/paraglide/runtime.js'
import { Route, Routes } from 'react-router-dom'
import '~/globals.css'
import DictationHome from '~/pages/dictation-home/page'
import { ErrorModalProvider } from './providers/error-modal'
import { PreferenceProvider } from './providers/preference'
import { ErrorBoundary } from 'react-error-boundary'
import { BoundaryFallback } from './components/boundary-fallback'
import ErrorModalWithContext from './components/error-modal-with-context'
import { FilesProvider } from './providers/files-provider'
import { HotkeyProvider } from './providers/hotkey'
import { ToastProvider } from './providers/toast'
import { Toaster } from '~/components/ui/sonner'
import { TooltipProvider } from '~/components/ui/tooltip'
import { DirectionProvider } from '~/components/ui/direction'

export default function App() {
	return (
		<PreferenceProvider>
			<AppContent />
		</PreferenceProvider>
	)
}

function AppContent() {
	const dir = getTextDirection()

	useEffect(() => {
		document.body.dir = dir
	}, [dir])

	return (
		<DirectionProvider dir={dir}>
			<ErrorBoundary FallbackComponent={BoundaryFallback}>
				<ErrorModalProvider>
					<TooltipProvider>
						<ToastProvider>
							<HotkeyProvider>
								<ErrorModalWithContext />
								<FilesProvider>
									<Routes>
										<Route path="/" element={<DictationHome />} />
									</Routes>
								</FilesProvider>
								<Toaster position="bottom-right" />
							</HotkeyProvider>
						</ToastProvider>
					</TooltipProvider>
				</ErrorModalProvider>
			</ErrorBoundary>
		</DirectionProvider>
	)
}
