// Pure helpers for the saved-model preference (`prefs_model_path`). Kept free
// of Tauri so they can be unit-tested; the caller does the file-system check.

export function modelFileName(path: string): string {
	const segments = path.split(/[\\/]/)
	return segments[segments.length - 1] || path
}

export type SavedModelCheck = { status: 'none' } | { status: 'ok'; path: string } | { status: 'missing'; path: string; fileName: string }

/**
 * Decides what to do with the saved model path at startup.
 *
 * `exists` is the file-system answer, or `null` when the check itself failed
 * (permission, I/O). A failed check keeps the path: the preference is cleared
 * only on a definite "the file is not there", never on an unverifiable answer.
 */
export function checkSavedModel(savedPath: string | null, exists: boolean | null): SavedModelCheck {
	if (!savedPath) return { status: 'none' }
	if (exists === false) return { status: 'missing', path: savedPath, fileName: modelFileName(savedPath) }
	return { status: 'ok', path: savedPath }
}
