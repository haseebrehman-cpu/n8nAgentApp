/** Small pure helpers for the chat widget. */

let idCounter = 0;

/** Generate a unique, stable-per-session message id. */
export function nextId(): string {
  idCounter += 1;
  return `msg-${Date.now()}-${idCounter}`;
}

/** True when the input is a "show the menu" command (m / menu / main menu). */
export function isMenuCommand(text: string): boolean {
  return /^(m|menu|main\s*menu)$/i.test(text.trim());
}
