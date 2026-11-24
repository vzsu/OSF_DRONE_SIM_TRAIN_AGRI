// Remappable keyboard shortcuts. settings.keys stores overrides (action → KeyboardEvent.code).
import { settings, saveSettings } from '../settings';

export interface KeyAction { id: string; label: string; def: string; group: 'Flight' | 'Switches' | 'App' }

export const KEY_ACTIONS: KeyAction[] = [
  { id: 'thrUp', label: 'Throttle up', def: 'KeyW', group: 'Flight' },
  { id: 'thrDown', label: 'Throttle down', def: 'KeyS', group: 'Flight' },
  { id: 'yawL', label: 'Yaw left', def: 'KeyA', group: 'Flight' },
  { id: 'yawR', label: 'Yaw right', def: 'KeyD', group: 'Flight' },
  { id: 'pitchF', label: 'Pitch forward', def: 'ArrowUp', group: 'Flight' },
  { id: 'pitchB', label: 'Pitch back', def: 'ArrowDown', group: 'Flight' },
  { id: 'rollL', label: 'Roll left', def: 'ArrowLeft', group: 'Flight' },
  { id: 'rollR', label: 'Roll right', def: 'ArrowRight', group: 'Flight' },
  { id: 'arm', label: 'Arm / disarm switch', def: 'Enter', group: 'Switches' },
  { id: 'mode1', label: 'Mode: STABILIZE', def: 'Digit1', group: 'Switches' },
  { id: 'mode2', label: 'Mode: ALT HOLD / ATTI', def: 'Digit2', group: 'Switches' },
  { id: 'mode3', label: 'Mode: LOITER / P-GPS', def: 'Digit3', group: 'Switches' },
  { id: 'auto', label: 'Mode: AUTO mission', def: 'Digit4', group: 'Switches' },
  { id: 'spray', label: 'Spray on/off', def: 'Space', group: 'Switches' },
  { id: 'flowDown', label: 'Pump flow −', def: 'BracketLeft', group: 'Switches' },
  { id: 'flowUp', label: 'Pump flow +', def: 'BracketRight', group: 'Switches' },
  { id: 'kill', label: 'Emergency motor stop', def: 'KeyK', group: 'Switches' },
  { id: 'rtl', label: 'RTL (return home)', def: 'KeyR', group: 'Switches' },
  { id: 'view', label: 'Change view', def: 'KeyV', group: 'App' },
  { id: 'pause', label: 'Pause menu', def: 'Escape', group: 'App' },
  { id: 'gcs', label: 'Ground station tablet', def: 'KeyG', group: 'App' },
  { id: 'map', label: 'Big map', def: 'KeyM', group: 'App' },
  { id: 'battery', label: 'Batteries & tank', def: 'KeyB', group: 'App' },
  { id: 'reset', label: 'Reset to pad', def: 'Backspace', group: 'App' },
  { id: 'record', label: 'Camera record', def: 'KeyC', group: 'App' },
  { id: 'gimbalUp', label: 'Gimbal tilt up', def: 'PageUp', group: 'App' },
  { id: 'gimbalDown', label: 'Gimbal tilt down', def: 'PageDown', group: 'App' },
  { id: 'track', label: 'Camera: track subject in centre / release', def: 'KeyT', group: 'App' },
  { id: 'gimbalMode', label: 'Camera: gimbal Follow / FPV mode', def: 'KeyF', group: 'App' },
  { id: 'hud', label: 'Hide / show the HUD', def: 'KeyH', group: 'App' },
  { id: 'hudDetail', label: 'Detailed telemetry on / off', def: 'KeyI', group: 'App' },
];

export const keyOf = (id: string): string => settings.keys?.[id] ?? KEY_ACTIONS.find((a) => a.id === id)?.def ?? '';
export const actionsFor = (code: string): string[] => KEY_ACTIONS.filter((a) => keyOf(a.id) === code).map((a) => a.id);

/** Bind `code` to `id`; any other action that used the same key gets this action's old key (swap). */
export function bindKey(id: string, code: string) {
  const old = keyOf(id);
  for (const a of KEY_ACTIONS) if (a.id !== id && keyOf(a.id) === code) settings.keys[a.id] = old;
  settings.keys[id] = code;
  saveSettings();
}
export function resetKeys() { settings.keys = {}; saveSettings(); }

/** Short label for a KeyboardEvent.code ("KeyW" → "W", "ArrowUp" → "↑"). */
export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const m: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', BracketLeft: '[', BracketRight: ']', Space: 'Space', Escape: 'Esc', Backspace: 'Backspace', Enter: 'Enter', PageUp: 'PgUp', PageDown: 'PgDn' };
  return m[code] ?? code.replace(/^Numpad/, 'Num ');
}
