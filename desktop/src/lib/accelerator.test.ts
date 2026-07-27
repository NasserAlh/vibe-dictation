import { describe, expect, it } from 'vitest'
import { acceleratorsCollide, normalizeAccelerator } from './accelerator'

describe('acceleratorsCollide', () => {
	it('detects the CmdOrCtrl alias collision the parser would produce', () => {
		expect(acceleratorsCollide('CmdOrCtrl+Shift+Space', 'ctrl+shift+space')).toBe(true)
		expect(acceleratorsCollide('CommandOrControl+Alt+Space', 'CmdOrCtrl+Alt+Space')).toBe(true)
	})

	it('ignores case and per-token whitespace like the parser does', () => {
		expect(acceleratorsCollide('CmdOrCtrl + Shift + Space', 'CMDORCTRL+SHIFT+SPACE')).toBe(true)
		expect(acceleratorsCollide('F9 ', 'F9')).toBe(true)
	})

	it('treats modifier order as irrelevant', () => {
		expect(acceleratorsCollide('Alt+Ctrl+Space', 'Ctrl+Alt+Space')).toBe(true)
	})

	it('does not flag genuinely different accelerators', () => {
		expect(acceleratorsCollide('F9', 'F10')).toBe(false)
		expect(acceleratorsCollide('Ctrl+Shift+Space', 'Ctrl+Alt+Space')).toBe(false)
	})

	it('never collides on empty input', () => {
		expect(acceleratorsCollide('', '')).toBe(false)
		expect(acceleratorsCollide('  ', 'F9')).toBe(false)
	})
})

describe('normalizeAccelerator', () => {
	it('produces a canonical sorted form', () => {
		expect(normalizeAccelerator('CmdOrCtrl+Shift+Space')).toBe(normalizeAccelerator('shift + control + SPACE'))
	})
})
