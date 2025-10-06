// Lightweight keybind manager
type Callback = (ev: KeyboardEvent) => void;

type Binding = {
  combo: string; // e.g. 'Control+N'
  handler: Callback;
};

const bindings: Binding[] = [];
let enabled = false;

function normalizeCombo(ev: KeyboardEvent) {
  const parts: string[] = [];
  if (ev.ctrlKey || ev.metaKey) parts.push('Control');
  if (ev.altKey) parts.push('Alt');
  if (ev.shiftKey) parts.push('Shift');
  // Use ev.code when possible for layout-independent keys (KeyA, Digit1, etc.)
  let key = '';
  try {
    const code = (ev as any).code || '';
    if (typeof code === 'string' && code.startsWith('Key') && code.length === 4) {
      key = code.slice(3).toUpperCase(); // KeyN -> N
    } else if (typeof code === 'string' && code.startsWith('Digit')) {
      key = code.slice(5).toUpperCase(); // Digit1 -> 1
    } else {
      key = (ev.key || '').toUpperCase();
    }
  } catch (e) {
    key = (ev.key || '').toUpperCase();
  }
  // ignore modifier-only events
  if (key === 'CONTROL' || key === 'SHIFT' || key === 'ALT' || key === 'META' || key === '') return '';
  parts.push(key.length === 1 ? key : key);
  return parts.join('+');
}

function onKeyDown(ev: KeyboardEvent) {
  try {
    const combo = normalizeCombo(ev);
    if (!combo) return;
  // debug
  try { console.log('[Keybinds] keydown combo=', combo, 'registered=', bindings.map(b => b.combo)); } catch (e) {}
    for (const b of bindings) {
      if (b.combo.toUpperCase() === combo.toUpperCase()) {
        try {
          // Prevent browser default and stop propagation ASAP so the app
          // shortcut takes priority over built-in browser shortcuts.
          try { ev.preventDefault(); } catch (e) {}
          try { ev.stopImmediatePropagation(); } catch (e) {}
          try { ev.stopPropagation(); } catch (e) {}
          try {
            // dispatch debug event so devtools can observe keybind triggers
            try { window.dispatchEvent(new CustomEvent('app-keybind', { detail: { combo } })); } catch (e) {}
          } catch (e) {}
          b.handler(ev);
        } catch (e) {}
        break;
      }
    }
  } catch (e) {}
}

export function registerKeybind(combo: string, handler: Callback) {
  const exists = bindings.some(b => b.combo.toUpperCase() === combo.toUpperCase() && b.handler === handler);
  if (exists) return;
  bindings.push({ combo, handler });
  try { console.log('[Keybinds] register', combo); } catch (e) {}
  try { (window as any).__keybinds = { bindings, enabled }; } catch (e) {}
}

export function unregisterKeybind(combo: string, handler?: Callback) {
  for (let i = bindings.length - 1; i >= 0; i--) {
    if (bindings[i].combo.toUpperCase() === combo.toUpperCase() && (!handler || bindings[i].handler === handler)) {
      bindings.splice(i, 1);
    }
  }
}

export function startKeybinds() {
  if (enabled) return;
  enabled = true;
  // Use capture + passive: false so preventDefault() can work and we get
  // priority over bubble handlers. Some browsers may still reserve keys,
  // but this increases the chance our handler wins.
  try {
    window.addEventListener('keydown', onKeyDown as any, { capture: true, passive: false } as AddEventListenerOptions);
    try { console.log('[Keybinds] started'); } catch (e) {}
    try { (window as any).__keybinds = { bindings, enabled }; } catch (e) {}
  } catch (e) {
    // fallback if options not supported
    window.addEventListener('keydown', onKeyDown as any, true);
    try { console.log('[Keybinds] started (fallback)'); } catch (e) {}
    try { (window as any).__keybinds = { bindings, enabled }; } catch (e) {}
  }
}

export function stopKeybinds() {
  if (!enabled) return;
  enabled = false;
  try {
    window.removeEventListener('keydown', onKeyDown as any, { capture: true } as AddEventListenerOptions);
    try { console.log('[Keybinds] stopped'); } catch (e) {}
    try { (window as any).__keybinds = { bindings, enabled }; } catch (e) {}
  } catch (e) {
    window.removeEventListener('keydown', onKeyDown as any, true);
    try { console.log('[Keybinds] stopped (fallback)'); } catch (e) {}
    try { (window as any).__keybinds = { bindings, enabled }; } catch (e) {}
  }
}

export default {
  registerKeybind,
  unregisterKeybind,
  startKeybinds,
  stopKeybinds,
};

// Expose debug API for manual control from the browser console
try {
  (window as any).__Keybinds = {
    registerKeybind,
    unregisterKeybind,
    startKeybinds,
    stopKeybinds,
    getState: () => ({ bindings, enabled }),
  };
  try { (window as any).__keybinds = { bindings, enabled }; } catch (e) {}
  try { console.log('[Keybinds] module loaded, debug API available at window.__Keybinds and window.__keybinds'); } catch (e) {}
} catch (e) {}
