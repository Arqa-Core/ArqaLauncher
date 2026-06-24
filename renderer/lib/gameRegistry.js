// ArqaLauncher — Game Registry
// Converts ROM scan results and custom library manifests into canonical game objects.
// Must be loaded before renderer.js.

/* eslint-disable no-unused-vars */

const PLATFORM_LABELS_REG = {
  ps1: 'PlayStation', ps2: 'PlayStation 2', psp: 'PSP',
  gamecube: 'GameCube', wii: 'Wii', snes: 'SNES', nes: 'NES',
  n64: 'Nintendo 64', genesis: 'Genesis / Mega Drive',
  gba: 'Game Boy Advance', gb: 'Game Boy', arcade: 'Arcade',
  dreamcast: 'Dreamcast', switch: 'Nintendo Switch',
  generic: 'Generic', unknown: 'Unknown Platform'
};

/** Accent color per platform — used as fallback tint when no cover art is available. */
const PLATFORM_ACCENT_COLORS = {
  ps1:       '#003791',
  ps2:       '#00439c',
  psp:       '#003791',
  gamecube:  '#6a0dad',
  wii:       '#777777',
  snes:      '#7e1f1f',
  nes:       '#cc1010',
  n64:       '#cc1010',
  genesis:   '#3a3a3a',
  gba:       '#8b0082',
  gb:        '#4a7c59',
  arcade:    '#aa0000',
  dreamcast: '#e55c00',
  switch:    '#e4000f',
  generic:   '#445566',
  unknown:   '#7b4dff'
};

const GameRegistry = (() => {
  // ─── Private helpers ────────────────────────────────────────────────────────

  function _formatTitle(filename) {
    return filename
      .replace(/\.[^/.]+$/, '')          // strip extension
      .replace(/[._-]+/g, ' ')           // separators → space
      .replace(/\s+/g, ' ')             // collapse whitespace
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase()); // Title Case
  }

  function _deepMerge(base, override) {
    return {
      ...base,
      ...override,
      paths:    { ...base.paths,    ...(override.paths    || {}) },
      assets:   { ...base.assets,   ...(override.assets   || {}) },
      metadata: { ...base.metadata, ...(override.metadata || {}) },
      ui:       { ...base.ui,       ...(override.ui       || {}) },
      behavior: { ...base.behavior, ...(override.behavior || {}) }
    };
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Create a canonical game entry from a partial object.
   * All fields have safe defaults — pass only what you know.
   *
   * @param {object} partial
   * @returns {object} Full game entry conforming to the Arqa Game Schema v1
   */
  function createGameEntry(partial = {}) {
    const platform = partial.metadata?.platform || partial.platform || 'unknown';
    const accentColor = PLATFORM_ACCENT_COLORS[platform] || '#7b4dff';

    return {
      id:     partial.id     || `game.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
      title:  partial.title  || 'Unknown Title',
      type:   partial.type   || 'game',
      source: partial.source || 'local',

      paths: {
        executable:  null,
        localFolder: null,
        rom:         null,
        ...(partial.paths || {})
      },

      assets: {
        cover:           null,   // poster / box art
        icon:            null,   // small icon
        backgroundVideo: null,   // full background video
        previewLoop:     null,   // short looping preview (webm/mp4)
        audioPreview:    null,   // optional audio track
        ...(partial.assets || {})
      },

      metadata: {
        description: '',
        developer:   '',
        publisher:   '',
        releaseYear: null,
        genre:       [],
        tags:        [],
        platform:    'unknown',
        ...(partial.metadata || {})
      },

      ui: {
        accentColor:     accentColor,
        blurIntensity:   0.6,
        motionProfile:   'medium',   // low | medium | high
        transitionStyle: 'xmb',      // xmb | cinematic | snap
        ...(partial.ui || {})
      },

      behavior: {
        launchMode:       'rom',      // exe | uri | script | rom
        preloadPriority:  1,
        hoverPreview:     true,
        backgroundMode:   'gradient', // video | image | gradient
        ...(partial.behavior || {})
      }
    };
  }

  /**
   * Convert a ROM scan result (from main.js scanFolder) into an array of game entries.
   *
   * @param {{ folderPath: string, roms: string[], platforms: object }} scanResult
   * @returns {object[]} Array of game entries
   */
  function fromRomScan(scanResult) {
    if (!scanResult || !Array.isArray(scanResult.roms)) return [];

    return scanResult.roms.map(rom => {
      const platform = (scanResult.platforms && scanResult.platforms[rom]) || 'unknown';
      const folderPath = (scanResult.folderPath || '').replace(/\\/g, '/');
      const romPath = folderPath ? `${folderPath}/${rom}` : rom;

      return createGameEntry({
        id:     `rom.${rom.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
        title:  _formatTitle(rom),
        source: 'local',
        paths: {
          rom:         romPath,
          localFolder: scanResult.folderPath || null
        },
        metadata: {
          platform,
          description: PLATFORM_LABELS_REG[platform] || 'Unknown platform'
        }
      });
    });
  }

  /**
   * Merge a custom library.json manifest over a base entries array.
   * Items in the manifest that share an id with a base entry are deep-merged.
   * Items with new ids are appended.
   *
   * @param {object[]} baseEntries
   * @param {{ games: object[] }} manifest
   * @returns {object[]}
   */
  function mergeManifest(baseEntries, manifest) {
    if (!manifest || !Array.isArray(manifest.games)) return baseEntries;

    const byId = {};
    baseEntries.forEach(e => { byId[e.id] = e; });

    manifest.games.forEach(partial => {
      if (partial.id && byId[partial.id]) {
        byId[partial.id] = _deepMerge(byId[partial.id], partial);
      } else {
        const entry = createGameEntry(partial);
        byId[entry.id] = entry;
      }
    });

    return Object.values(byId);
  }

  return { createGameEntry, fromRomScan, mergeManifest };
})();
