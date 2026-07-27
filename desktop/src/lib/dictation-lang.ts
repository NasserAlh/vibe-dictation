// Dictation never auto-detects the transcription language: Whisper large-v3
// misdetects this speaker's English as Arabic and covertly translates it
// (verification report §11 — proven at any utterance length). The hotkey that
// started the recording decides the language; there is no auto path.
export type DictationLang = 'en' | 'ar'

export function forcedLangOptions<T extends { lang?: string }>(options: T, lang: DictationLang): T & { lang: DictationLang } {
	return { ...options, lang }
}
