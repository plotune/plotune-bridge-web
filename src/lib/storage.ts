// localStorage is a per-browser convenience only (last address, hidden panels). Every access can fail or be blocked.
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the page keeps working without remembering
  }
}
