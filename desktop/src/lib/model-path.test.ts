import { describe, expect, it } from 'vitest'
import { checkSavedModel, modelFileName } from './model-path'

describe('modelFileName', () => {
	it('returns the last path segment for Windows and POSIX separators', () => {
		expect(modelFileName('C:\\Users\\nasser\\AppData\\Local\\net.nasserhub.dictation\\ggml-large-v3-turbo.bin')).toBe('ggml-large-v3-turbo.bin')
		expect(modelFileName('/models/ggml-large-v3.bin')).toBe('ggml-large-v3.bin')
		expect(modelFileName('ggml-large-v3.bin')).toBe('ggml-large-v3.bin')
	})
})

describe('checkSavedModel', () => {
	const saved = 'C:\\models\\ggml-large-v3-turbo.bin'

	it('reports nothing to check when no model is saved', () => {
		expect(checkSavedModel(null, false)).toEqual({ status: 'none' })
	})

	it('keeps a saved model whose file exists', () => {
		expect(checkSavedModel(saved, true)).toEqual({ status: 'ok', path: saved })
	})

	it('flags a saved model whose file is gone, naming the file', () => {
		expect(checkSavedModel(saved, false)).toEqual({ status: 'missing', path: saved, fileName: 'ggml-large-v3-turbo.bin' })
	})

	it('never clears a saved model when the existence check itself failed', () => {
		expect(checkSavedModel(saved, null)).toEqual({ status: 'ok', path: saved })
	})
})
