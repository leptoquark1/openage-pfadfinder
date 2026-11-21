/** The welcome on the demo page. */
export const WELCOME_KEY = 'openage-pfadfinder:visited';
/** The interface tour at the start of the guide. */
export const GUIDE_TOUR_KEY = 'openage-pfadfinder:guide-tour';

type SeenStore = Pick<Storage, 'getItem' | 'setItem'>;

/** Merely accessing `localStorage` throws when the browser blocks site data. */
function browserStore(): SeenStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether this browser has yet to see an introduction. Without usable storage
 * that could not be remembered, so the introduction stays away instead of
 * coming back on every page load.
 */
export function isUnseen(key: string, store: SeenStore | null = browserStore()): boolean {
  try {
    return store !== null && store.getItem(key) === null;
  } catch {
    return false;
  }
}

export function markSeen(key: string, store: SeenStore | null = browserStore()): void {
  try {
    store?.setItem(key, '1');
  } catch {
    // Storage is full or blocked; the introduction may simply appear once more.
  }
}
