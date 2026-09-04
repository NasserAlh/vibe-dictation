import { describe, expect, it } from 'vitest'
import { classifyStartRecordError, errorText, startFailureMessage, type StartFailureMessages } from './indicator-messages'

const messages: StartFailureMessages = {
	noMicrophone: 'No microphone found',
	microphoneBusy: 'Microphone is busy or unavailable',
	startFailed: 'Could not start recording',
}

describe('classifyStartRecordError', () => {
	it('treats device errors as a busy/unavailable microphone', () => {
		expect(classifyStartRecordError(new Error('The requested device is no longer available'))).toBe('microphone-busy')
		expect(classifyStartRecordError('DeviceNotAvailable')).toBe('microphone-busy')
		expect(classifyStartRecordError({ message: 'Failed to open input DEVICE' })).toBe('microphone-busy')
	})

	it('treats stream errors as a busy/unavailable microphone', () => {
		expect(classifyStartRecordError(new Error('BuildStreamError: StreamConfigNotSupported'))).toBe('microphone-busy')
		expect(classifyStartRecordError('could not start the stream')).toBe('microphone-busy')
	})

	it('falls back to a generic start failure for anything else', () => {
		expect(classifyStartRecordError(new Error('Could not create WAV file'))).toBe('start-failed')
		expect(classifyStartRecordError('permission denied')).toBe('start-failed')
		expect(classifyStartRecordError(undefined)).toBe('start-failed')
		expect(classifyStartRecordError(42)).toBe('start-failed')
	})
})

describe('startFailureMessage', () => {
	it('maps every failure kind to its message', () => {
		expect(startFailureMessage('no-microphone', messages)).toBe('No microphone found')
		expect(startFailureMessage('microphone-busy', messages)).toBe('Microphone is busy or unavailable')
		expect(startFailureMessage('start-failed', messages)).toBe('Could not start recording')
	})

	it('composes with the classifier for start_record errors', () => {
		expect(startFailureMessage(classifyStartRecordError(new Error('device busy')), messages)).toBe('Microphone is busy or unavailable')
		expect(startFailureMessage(classifyStartRecordError(new Error('disk full')), messages)).toBe('Could not start recording')
	})
})

describe('errorText', () => {
	it('extracts a message from Error, message-bearing objects, and primitives', () => {
		expect(errorText(new Error('boom'))).toBe('boom')
		expect(errorText({ message: 'tauri error' })).toBe('tauri error')
		expect(errorText({ message: 5 })).toBe('[object Object]')
		expect(errorText('plain')).toBe('plain')
		expect(errorText(null)).toBe('null')
	})
})
