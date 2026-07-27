import { openUrl } from '@tauri-apps/plugin-opener'
import { m } from '~/paraglide/messages.js'
import { ReactComponent as LinkIcon } from '~/icons/link.svg'
import * as config from '~/lib/config'
import { Button } from '~/components/ui/button'
import type { SettingsViewModel } from './shared'

export function PrivacySection({ vm: _vm }: { vm: SettingsViewModel }) {
	return (
		<div className="space-y-5">
			<Button variant="ghost" onMouseDown={() => openUrl(config.privacyPolicyURL)} className="h-11 w-full justify-between rounded-xl border border-border/55 bg-card/92 px-4 font-medium hover:bg-accent/55">
				{m.privacyPolicy()} <LinkIcon className="h-4 w-4 text-muted-foreground" />
			</Button>
		</div>
	)
}
