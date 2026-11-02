// Keyboard shortcuts of the workspace, and how they are written for the platform in use.
const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "⌘" on Apple devices, "Ctrl" elsewhere. */
export const MOD = apple ? '⌘' : 'Ctrl';
/** "⌥" on Apple devices, "Alt" elsewhere. */
export const ALT = apple ? '⌥' : 'Alt';
/** A shortcut as shown in a tooltip: "⌘K" or "Ctrl+K". */
export const combo = (mod: string, key: string): string => (apple ? `${mod}${key}` : `${mod}+${key}`);

/** Typing in a field must never trigger a shortcut that uses a bare Alt or Option key. */
export const isEditable = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};
