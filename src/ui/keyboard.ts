import type { PlayerEngine } from '../player/engine';

export interface KeyboardHandlers {
  focusSearch: () => void;
  toggleQueue: () => void;
  toggleLikeCurrent: () => void;
  openSettings: () => void;
}

const SKIP_SMALL = 10;
const SKIP_LARGE = 30;

/**
 * Binds global keyboard shortcuts for playback control, navigation, and UI actions.
 * Skips bindings when the user is typing in an input/textarea.
 */
export function bindKeyboardShortcuts(engine: PlayerEngine, handlers: KeyboardHandlers): void {
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    if (typing) {
      if (e.key === 'Escape') target?.blur();
      return;
    }

    switch (e.key) {
      case ' ':
        e.preventDefault();
        engine.togglePlayPause();
        break;
      case 'ArrowRight':
        engine.skip(e.shiftKey ? SKIP_LARGE : SKIP_SMALL);
        break;
      case 'ArrowLeft':
        engine.skip(e.shiftKey ? -SKIP_LARGE : -SKIP_SMALL);
        break;
      case 'n':
      case 'N':
        void engine.next();
        break;
      case 'p':
      case 'P':
        void engine.previous();
        break;
      case 'm':
      case 'M':
        engine.toggleMute();
        break;
      case 's':
      case 'S':
        engine.toggleShuffle();
        break;
      case 'r':
      case 'R':
        engine.cycleRepeat();
        break;
      case 'l':
      case 'L':
        handlers.toggleLikeCurrent();
        break;
      case 'q':
      case 'Q':
        handlers.toggleQueue();
        break;
      case '/':
        e.preventDefault();
        handlers.focusSearch();
        break;
      case ',':
        handlers.openSettings();
        break;
    }
  });
}
