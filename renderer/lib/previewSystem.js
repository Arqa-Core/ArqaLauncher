// ArqaLauncher — Preview System
// Manages the timed hover-preview activation lifecycle and video element helpers.
// A 200 ms debounce prevents flickering during rapid navigation.
// Must be loaded before renderer.js.

/* eslint-disable no-unused-vars */

const PreviewSystem = (() => {
  let _activeTimer = null;

  /** Delay in ms before the preview background activates after focus changes. */
  const PREVIEW_DELAY_MS = 200;

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Schedule a preview activation after PREVIEW_DELAY_MS.
   * Calls `onDeactivate` immediately (synchronously) so the UI can show a
   * transitioning state, then calls `onActivate` after the delay.
   *
   * Call cancel() to abort a pending activation.
   *
   * @param {Function}      onActivate    Called after the delay.
   * @param {Function|null} onDeactivate  Called immediately (optional).
   */
  function schedulePreview(onActivate, onDeactivate) {
    cancel();
    if (typeof onDeactivate === 'function') onDeactivate();

    _activeTimer = setTimeout(() => {
      _activeTimer = null;
      if (typeof onActivate === 'function') onActivate();
    }, PREVIEW_DELAY_MS);
  }

  /**
   * Cancel a pending preview activation.
   */
  function cancel() {
    if (_activeTimer !== null) {
      clearTimeout(_activeTimer);
      _activeTimer = null;
    }
  }

  /**
   * Prepare a <video> element for lazy playback.
   * Only updates src when it actually changes to avoid interrupting playback.
   *
   * @param {HTMLVideoElement} videoEl
   * @param {string}           src
   */
  function prepareVideoElement(videoEl, src) {
    if (!videoEl || !src) return;

    // Normalize — compare without fragment or query
    const normalised = src.split('?')[0].split('#')[0];
    const current    = (videoEl.src || '').split('?')[0].split('#')[0];

    if (current !== normalised) {
      videoEl.src = src;
      videoEl.load();
    }

    videoEl.muted      = true;
    videoEl.loop       = true;
    videoEl.playsInline = true;
  }

  /**
   * Attempt to play a <video> element. Ignores autoplay policy rejections silently.
   *
   * @param {HTMLVideoElement} videoEl
   */
  function playVideo(videoEl) {
    if (!videoEl) return;
    const p = videoEl.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  /**
   * Pause a <video> element safely.
   *
   * @param {HTMLVideoElement} videoEl
   */
  function pauseVideo(videoEl) {
    if (!videoEl) return;
    try { videoEl.pause(); } catch (_) {}
  }

  return { schedulePreview, cancel, prepareVideoElement, playVideo, pauseVideo };
})();
