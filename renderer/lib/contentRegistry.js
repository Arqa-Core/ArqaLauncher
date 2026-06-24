// ArqaLauncher — Content Registry (renderer)
// Unified in-memory store for all content types: Games, Steam, ROMs, Apps.
// Every item must conform to the Arqa Game Schema v1 (see gameRegistry.js).
// Loaded before renderer.js via index.html.
/* eslint-disable no-unused-vars */

const ContentRegistry = (() => {
  // ── Internal store ────────────────────────────────────────────────────────
  const _store = {
    games: [],   // Locally installed .exe / .AppImage games
    steam: [],   // Steam library entries
    roms:  [],   // Emulated ROMs (multi-directory scan)
    apps:  [],   // Generic applications
    media: []    // Future: local media files
  };

  // Canonical section name → store key mapping
  const SECTION_KEY = {
    'Games': 'games',
    'Steam': 'steam',
    'ROMs':  'roms',
    'Apps':  'apps',
    'Media': 'media'
  };

  // Change listeners: storeKey → handler[]
  const _listeners = {};

  // ── Private helpers ───────────────────────────────────────────────────────
  function _key(category) {
    return SECTION_KEY[category] || (category || '').toLowerCase().trim();
  }

  function _notify(key) {
    (_listeners[key] || []).forEach(fn => {
      try { fn(_store[key] || []); } catch (_) {}
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Replace the entire contents of a category.
   *
   * @param {string}   category  e.g. 'Steam', 'ROMs', 'Games'
   * @param {object[]} items     Canonical game entries
   */
  function setCategory(category, items) {
    const key = _key(category);
    if (!(key in _store)) _store[key] = [];
    _store[key] = Array.isArray(items) ? [...items] : [];
    _notify(key);
  }

  /**
   * Retrieve all items for a category.
   *
   * @param {string} category
   * @returns {object[]}
   */
  function getCategory(category) {
    return [...(_store[_key(category)] || [])];
  }

  /**
   * Append items to a category, skipping duplicates (by id).
   *
   * @param {string}   category
   * @param {object[]} items
   */
  function appendToCategory(category, items) {
    const key = _key(category);
    if (!(key in _store)) _store[key] = [];
    const existing = new Set(_store[key].map(e => e.id));
    const fresh    = (Array.isArray(items) ? items : []).filter(e => !existing.has(e.id));
    if (!fresh.length) return;
    _store[key] = [..._store[key], ...fresh];
    _notify(key);
  }

  /**
   * Patch a single item by id.
   *
   * @param {string} category
   * @param {string} id
   * @param {object} patch   Shallow merge; `assets` sub-object is also shallowly merged.
   */
  function updateItem(category, id, patch) {
    const key = _key(category);
    if (!_store[key]) return;
    _store[key] = _store[key].map(item =>
      item.id === id
        ? { ...item, ...patch, assets: { ...item.assets, ...(patch.assets || {}) } }
        : item
    );
    _notify(key);
  }

  /**
   * Remove a single item by id.
   *
   * @param {string} category
   * @param {string} id
   */
  function removeItem(category, id) {
    const key = _key(category);
    if (!_store[key]) return;
    _store[key] = _store[key].filter(item => item.id !== id);
    _notify(key);
  }

  /** Clear all categories. */
  function clear() {
    for (const key of Object.keys(_store)) _store[key] = [];
  }

  /**
   * Full-text search across all categories.
   *
   * @param {string} query
   * @returns {{ category: string, items: object[] }[]}
   */
  function search(query) {
    if (!query) return [];
    const q = query.toLowerCase();
    const results = [];
    for (const [cat, items] of Object.entries(_store)) {
      const matched = items.filter(item =>
        item.title?.toLowerCase().includes(q) ||
        item.metadata?.description?.toLowerCase().includes(q) ||
        item.metadata?.developer?.toLowerCase().includes(q) ||
        item.metadata?.tags?.some(t => t.toLowerCase().includes(q))
      );
      if (matched.length) results.push({ category: cat, items: matched });
    }
    return results;
  }

  /**
   * Subscribe to changes in a category.
   * Returns an unsubscribe function.
   *
   * @param {string}   category
   * @param {Function} handler  Receives the new items array on each change.
   * @returns {Function}
   */
  function subscribe(category, handler) {
    const key = _key(category);
    if (!_listeners[key]) _listeners[key] = [];
    _listeners[key].push(handler);
    return () => {
      const arr = _listeners[key] || [];
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }

  /** Return the total item count across all categories. */
  function totalCount() {
    return Object.values(_store).reduce((sum, arr) => sum + arr.length, 0);
  }

  return {
    setCategory,
    getCategory,
    appendToCategory,
    updateItem,
    removeItem,
    clear,
    search,
    subscribe,
    totalCount
  };
})();
