// Pure mapping from a pre-recording failure to the plain-English (or Arabic)
// message the dictation indicator shows (plan §2.1: "never silent"). Kept free
// of paraglide so it can be unit-tested; the caller passes the translated
// strings in.

export type StartFailureKind = 'no-microphone' | 'microphone-busy' | 'start-failed'

export interface StartFailureMessages {
	noMicrophone: string
	microphoneBusy: string
	startFailed: string
}

/**
 * Classifies an error thrown by `start_record`. Anything that mentions the
 * device or the stream (cpal's `DeviceNotAvailable`, `BuildStreamError`,
 * "the device is busy" …) is a microphone problem; everything else is a
 * generic start failure. Not for the "no default input" path — that one is
 * known before `start_record` runs and maps straight to `'no-microphone'`.
 */
export function classifyStartRecordError(error: unknown): Exclude<StartFailureKind, 'no-microphone'> {
	return /device|stream/i.test(errorText(error)) ? 'microphone-busy' : 'start-failed'
}

export function startFailureMessage(kind: StartFailureKind, messages: StartFailureMessages): string {
	switch (kind) {
		case 'no-microphone':
			return messages.noMicrophone
		case 'microphone-busy':
			return messages.microphoneBusy
		case 'start-failed':
			return messages.startFailed
	}
}

export function errorText(error: unknown): string {
	if (error instanceof Error) return error.message
	if (typeof error === 'object' && error !== null && 'message' in error) {
		const message = (error as { message?: unknown }).message
		if (typeof message === 'string') return message
	}
	return String(error)
}
