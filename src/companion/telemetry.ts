// `proofmarks telemetry status|on|off`. Usage counts are off until the person turns them on, and the choice
// is kept for every Proofmarks process on this machine.
import { saveTelemetry, telemetryFile, telemetryState } from '../judge/relay';
import { UserError } from './user-error';

/** What Proofmarks says about the choice in effect. */
export function telemetryStatus(state: ReturnType<typeof telemetryState> = telemetryState()) {
  if (state.on)
    return 'Usage counts are on: which marks you keep or dismiss, and one count for this install, never your writing. proofmarks telemetry off stops them.';
  if (state.by === 'DO_NOT_TRACK') return 'Usage counts are off because DO_NOT_TRACK is set.';
  if (state.by === 'CI') return 'Usage counts are off because this is a CI run.';
  if (state.by === 'owner')
    return 'Usage counts are off because a Proofmarks process sharing this helper turns them off.';
  if (state.by === 'PROOFMARKS_TELEMETRY')
    return 'Usage counts are off because PROOFMARKS_TELEMETRY turns them off here.';
  return 'Usage counts are off. Proofmarks tunes its rules to your site on this machine. To help tune them for everyone, run proofmarks telemetry on.';
}

export async function telemetryCommand(action: string | undefined, file = telemetryFile()) {
  if (action === undefined || action === 'status') return telemetryStatus(telemetryState(process.env, file));
  if (action !== 'on' && action !== 'off') throw new UserError('Usage: proofmarks telemetry [status|on|off]');
  await saveTelemetry(action === 'on', file);
  const state = telemetryState(process.env, file);
  // DO_NOT_TRACK, PROOFMARKS_TELEMETRY or a CI run outranks the saved choice here: say what's in effect.
  if (state.on !== (action === 'on')) return `Saved for later. ${telemetryStatus(state)}`;
  return state.on
    ? 'Usage counts are on. Thank you, they help tune the rules for everyone.'
    : 'Usage counts are off. Proofmarks still tunes its rules to your site on this machine.';
}
