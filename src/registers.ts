/**
 * The unnamed register (vim's default `"` register) — what d/c/y/x write to
 * and p/P read from when no register is explicitly named. Vim's NAMED
 * registers (a-z, etc.) are a distinct, larger feature deliberately not
 * built here — this covers the register model's default, highest-frequency
 * path.
 */

let unnamedRegister = '';
let unnamedRegisterIsLinewise = false;

export function setRegister(text: string, linewise: boolean): void {
  unnamedRegister = text;
  unnamedRegisterIsLinewise = linewise;
}

export function getRegister(): { text: string; linewise: boolean } {
  return { text: unnamedRegister, linewise: unnamedRegisterIsLinewise };
}
