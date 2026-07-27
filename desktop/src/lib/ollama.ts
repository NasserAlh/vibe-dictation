import { invoke } from '@tauri-apps/api/core'

export const defaultOllamaPort = 11434

// System prompt sent with every dictation when LLM formatting is enabled.
// Users can edit it in Settings → Dictation; this is only the starting point.
export const defaultLlmFormatPrompt =
	"You clean up dictated speech-to-text transcripts. Fix punctuation, capitalization, and obvious transcription mistakes, and remove spoken filler words (um, uh, يعني, اه, and similar) when they carry no meaning. Keep the speaker's language, dialect, and wording otherwise — do not translate, answer questions, summarize, or add commentary. Reply with the corrected text only."

export interface OllamaModel {
	name: string
	size: number
}

export async function listOllamaModels(port: number): Promise<OllamaModel[]> {
	return invoke<OllamaModel[]>('ollama_list_models', { port })
}

export interface OllamaFormatOptions {
	model: string
	prompt: string
	text: string
	port: number
}

export async function formatWithOllama(options: OllamaFormatOptions): Promise<string> {
	return invoke<string>('ollama_format_text', { options })
}
