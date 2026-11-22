// Ground-station voice prompts, like agri drone apps ("GPS ready", "Returning home", "Battery low").
// Uses the browser's built-in speech synthesis (works offline on Windows/Android). Throttled so the
// same message is not repeated within a few seconds.
import { settings } from '../settings';

const last = new Map<string, number>();

export function speak(text: string, minGapMs = 6000) {
  if (!settings.audio.on || settings.audio.voice === false || typeof speechSynthesis === 'undefined') return;
  const now = performance.now();
  if ((last.get(text) ?? -1e9) + minGapMs > now) return;
  last.set(text, now);
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05; u.pitch = 1.0; u.volume = Math.min(1, settings.audio.volume + 0.2);
  const v = speechSynthesis.getVoices().find((x) => /en[-_](IN|GB|US)/i.test(x.lang));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

/** Voice prompt for a flight-controller event code (see EVENT_TEXT). */
export function voiceForEvent(code: number, modeNames: readonly string[]) {
  const t: Record<number, string> = {
    1: 'Motors armed', 2: 'Motors disarmed', 6: 'GPS lost. Switching to attitude mode', 7: 'Remote controller signal lost',
    8: 'Battery low. Returning home', 9: 'Battery critical. Landing', 10: 'Aircraft crashed', 11: 'Spray tank empty. Returning home',
    12: 'GPS restored', 13: 'Landed', 14: 'Motor failure', 15: 'Vortex ring warning', 18: 'Taking off', 22: 'Emergency stop',
    4: 'Lower the throttle', 5: 'GPS not ready', 16: 'Battery too low', 17: 'Mode needs GPS',
  };
  if (code >= 100) {
    const m = modeNames[code - 100];
    if (code - 100 === 3) speak('Returning home', 3000);
    else if (m) speak(`${m.toLowerCase()} mode`, 2000);
    return;
  }
  if (t[code]) speak(t[code], 3000);
}
