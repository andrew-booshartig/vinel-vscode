/**
 * Registers: the unnamed `"` register (vim's default — what d/c/y/x write and
 * p/P read when none is named) plus NAMED registers `a`-`z` and the black-hole
 * `_`. A pending register set by `"{ch}` retargets the next write/read.
 *
 * The ~8 existing `setRegister`/`getRegister` call sites don't change — they
 * route through `pendingRegister` automatically, so `"ayy` / `"ap` just work.
 *
 * Deferred (unnamed handling unchanged): numbered `"1`-`"9`, yank `"0`, and
 * the system-clipboard registers `"+`/`"*`.
 */

interface RegisterValue { text: string; linewise: boolean; }

const UNNAMED = '"';
const registers = new Map<string, RegisterValue>();
let pendingRegister: string | null = null;

/** `"{ch}` — retarget the NEXT yank/delete (write) or paste (read). */
export function setPendingRegister(ch: string): void {
  pendingRegister = ch;
}

/** Escape / mode change — drop a dangling `"` so it can't leak. */
export function clearPendingRegister(): void {
  pendingRegister = null;
}

/** Write from a yank/delete. Honors a pending register (uppercase appends, `_`
 * discards) and always also updates the unnamed register (vim behavior).
 * Consumes the pending register. */
export function setRegister(text: string, linewise: boolean): void {
  const target = pendingRegister;
  pendingRegister = null;

  if (target === '_') return; // black hole — discard, and don't touch unnamed

  registers.set(UNNAMED, { text, linewise });

  if (target && /[a-zA-Z]/.test(target)) {
    const key = target.toLowerCase();
    if (target !== key) {
      // Uppercase `"A` — append to the lowercase register.
      const prev = registers.get(key);
      registers.set(key, { text: (prev?.text ?? '') + text, linewise });
    } else {
      registers.set(key, { text, linewise });
    }
  }
}

/** Read for a paste. Honors a pending register, else the unnamed one.
 * Consumes the pending register. */
export function getRegister(): RegisterValue {
  const src = pendingRegister;
  pendingRegister = null;
  const key = src && /[a-zA-Z]/.test(src) ? src.toLowerCase() : UNNAMED;
  return registers.get(key) ?? { text: '', linewise: false };
}

/** Read a register's text BY NAME without touching the pending register — used
 * by insert-mode `Ctrl-R{reg}`. `"` / undefined = the unnamed register. */
export function readRegister(name?: string): string {
  const key = name && /[a-zA-Z]/.test(name) ? name.toLowerCase() : UNNAMED;
  return registers.get(key)?.text ?? '';
}
