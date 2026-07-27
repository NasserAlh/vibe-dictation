export const MODEL_EXTENSIONS = ['bin', 'gguf'] as const
export type ModelExtension = (typeof MODEL_EXTENSIONS)[number]

const MODEL_EXTENSION_PATTERN = new RegExp(`\\.(${MODEL_EXTENSIONS.join('|')})$`, 'i')

export function getModelExtension(filename: string): ModelExtension | null {
	const extension = filename.match(MODEL_EXTENSION_PATTERN)?.[1]?.toLowerCase()
	return MODEL_EXTENSIONS.includes(extension as ModelExtension) ? (extension as ModelExtension) : null
}

export function isGgufModel(filename: string) {
	return getModelExtension(filename) === 'gguf'
}

export function getFriendlyModelName(filename: string) {
	const name = filename.replace(MODEL_EXTENSION_PATTERN, '').replace(/^ggml[-_]?/, '')
	if (!name || name === 'model') return 'Custom model'
	return name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function isModelFile(filename: string) {
	return getModelExtension(filename) !== null
}

export interface ModelCapabilities {
	engine: 'whisper' | 'nemotron' | string
	requires_vad: boolean
	languages: string[]
	language_detection: boolean
	streaming: boolean
	translation: boolean
	timestamps: boolean
	text_prompts: boolean
}

export interface ModelMetadata {
	format: string
	capabilities: ModelCapabilities
}
