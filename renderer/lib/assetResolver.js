// ArqaLauncher — Asset Resolver
// Handles preloading, in-memory caching, and background resolution for game assets.
// Follows a video → image → gradient fallback chain.
// Must be loaded before renderer.js.

/* eslint-disable no-unused-vars */

const AssetResolver = (() => {
  // LRU-ish in-memory image cache (keyed by URL)
  const _imageCache = new Map();
  const _pendingSet  = new Set();
  const MAX_CACHE    = 80;

  // ─── Private helpers ────────────────────────────────────────────────────────

  function _evict() {
    if (_imageCache.size >= MAX_CACHE) {
      // Remove the oldest entry (insertion order)
      const oldestKey = _imageCache.keys().next().value;
      _imageCache.delete(oldestKey);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Preload an image URL into the in-memory cache.
   * Silently resolves to null on failure.
   *
   * @param {string|null} url
   * @returns {Promise<HTMLImageElement|null>}
   */
  function preloadImage(url) {
    if (!url) return Promise.resolve(null);
    if (_imageCache.has(url)) return Promise.resolve(_imageCache.get(url));
    if (_pendingSet.has(url)) return Promise.resolve(null); // already in-flight

    _pendingSet.add(url);

    return new Promise(resolve => {
      const img = new Image();
      img.decoding = 'async';

      img.onload = () => {
        _evict();
        _imageCache.set(url, img);
        _pendingSet.delete(url);
        resolve(img);
      };

      img.onerror = () => {
        _pendingSet.delete(url);
        resolve(null);
      };

      img.src = url;
    });
  }

  /**
   * Retrieve a previously cached image element.
   *
   * @param {string} url
   * @returns {HTMLImageElement|null}
   */
  function getCachedImage(url) {
    return _imageCache.get(url) || null;
  }

  /**
   * Check whether an image URL is already in the cache.
   *
   * @param {string} url
   * @returns {boolean}
   */
  function isImageCached(url) {
    return url ? _imageCache.has(url) : false;
  }

  /**
   * Warm the cache for games within `radius` items of `centerIndex`.
   * Runs inside requestIdleCallback (or setTimeout fallback) so it
   * never blocks the main thread.
   *
   * @param {object[]} games   Array of canonical game entries
   * @param {number}   centerIndex
   * @param {number}   [radius=2]
   */
  function warmCache(games, centerIndex, radius = 2) {
    if (!games || games.length === 0) return;

    const start = Math.max(0, centerIndex - radius);
    const end   = Math.min(games.length - 1, centerIndex + radius);

    const urls = [];
    for (let i = start; i <= end; i++) {
      const g = games[i];
      if (!g) continue;
      if (g.assets?.cover) urls.push(g.assets.cover);
      if (g.assets?.icon)  urls.push(g.assets.icon);
    }

    if (urls.length === 0) return;

    const load = () => urls.forEach(url => preloadImage(url));

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(load, { timeout: 2500 });
    } else {
      setTimeout(load, 80);
    }
  }

  /**
   * Resolve the best available background for a game entry.
   * Follows the chain: previewLoop → backgroundVideo → cover image → gradient
   *
   * @param {object|null} game  Canonical game entry
   * @returns {{ type: 'video'|'image'|'gradient', source: string|null, color: string }}
   */
  function resolveBackground(game) {
    if (!game) return { type: 'gradient', source: null, color: '#7b4dff' };

    const a     = game.assets   || {};
    const color = (game.ui && game.ui.accentColor) || '#7b4dff';

    if (a.previewLoop)     return { type: 'video', source: a.previewLoop,     color };
    if (a.backgroundVideo) return { type: 'video', source: a.backgroundVideo, color };
    if (a.cover)           return { type: 'image', source: a.cover,           color };

    return { type: 'gradient', source: null, color };
  }

  return { preloadImage, getCachedImage, isImageCached, warmCache, resolveBackground };
})();
