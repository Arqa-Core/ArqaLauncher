// ArqaLauncher — Steam Scanner
// Parses Steam's VDF manifest files to enumerate installed games.
// Returns canonical game entries ready for ContentRegistry ingestion.
// Required by main.js — NOT loaded in the renderer.
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Minimal VDF (Valve Data Format) parser ────────────────────────────────────
// Handles the subset used in libraryfolders.vdf and appmanifest_*.acf files.
function parseVdf(text) {
  let pos = 0;
  const n = text.length;

  function skip() {
    while (pos < n) {
      if (text[pos] <= ' ')                              { pos++; continue; }
      if (text[pos] === '/' && text[pos + 1] === '/')    { while (pos < n && text[pos] !== '\n') pos++; continue; }
      break;
    }
  }

  function readQuoted() {
    pos++; // skip opening "
    let s = '';
    while (pos < n && text[pos] !== '"') {
      if (text[pos] === '\\' && pos + 1 < n) { pos++; s += text[pos++]; }
      else s += text[pos++];
    }
    if (pos < n) pos++; // skip closing "
    return s;
  }

  function readObject() {
    skip();
    if (pos < n && text[pos] === '{') pos++;
    const obj = {};
    while (true) {
      skip();
      if (pos >= n || text[pos] === '}') { if (pos < n) pos++; break; }
      if (text[pos] !== '"') { pos++; continue; }
      const key = readQuoted();
      skip();
      if (pos < n && text[pos] === '"')      obj[key] = readQuoted();
      else if (pos < n && text[pos] === '{') obj[key] = readObject();
    }
    return obj;
  }

  skip();
  if (pos >= n) return {};
  // Root format: "RootKey" { … }   OR bare { … }
  if (text[pos] === '"') {
    const rootKey = readQuoted();
    skip();
    if (pos < n && text[pos] === '{') {
      return { [rootKey]: readObject() };
    }
    return {};
  }
  return pos < n && text[pos] === '{' ? readObject() : {};
}

// ── Steam CDN artwork helpers ─────────────────────────────────────────────────
const CDN = 'https://cdn.akamai.steamstatic.com/steam/apps';

function steamArtwork(appId) {
  return {
    cover:      `${CDN}/${appId}/library_600x900.jpg`,
    icon:       `${CDN}/${appId}/logo.png`,
    heroImage:  `${CDN}/${appId}/library_hero.jpg`,
    headerImage:`${CDN}/${appId}/header.jpg`,
    // Preview video is available for some titles but requires the Steam Web API
    backgroundVideo: null,
    previewLoop:     null,
    audioPreview:    null
  };
}

// ── Scanner ───────────────────────────────────────────────────────────────────
const SteamScanner = {
  /**
   * Return all steamapps directory paths by parsing libraryfolders.vdf.
   * Always includes `<steamRoot>/steamapps` as the primary path.
   *
   * @param {string} steamRoot
   * @returns {string[]}
   */
  getLibraryPaths(steamRoot) {
    const primary = path.join(steamRoot, 'steamapps');
    const vdfPath  = path.join(primary, 'libraryfolders.vdf');
    const results  = [primary];

    if (!fs.existsSync(vdfPath)) return results;

    let vdf;
    try { vdf = parseVdf(fs.readFileSync(vdfPath, 'utf-8')); } catch { return results; }

    // The root key can be "libraryfolders" or "LibraryFolders"
    const root = vdf['libraryfolders'] || vdf['LibraryFolders'] || vdf;
    for (const [key, value] of Object.entries(root)) {
      if (!/^\d+$/.test(key)) continue;
      const folderPath = typeof value === 'object' ? value.path : value;
      if (folderPath && typeof folderPath === 'string') {
        const steamAppsPath = path.join(folderPath, 'steamapps');
        if (fs.existsSync(steamAppsPath) && !results.includes(steamAppsPath)) {
          results.push(steamAppsPath);
        }
      }
    }
    return results;
  },

  /**
   * Parse a single appmanifest_<appId>.acf file.
   * Returns null if the game is not fully installed.
   *
   * @param {string} filePath
   * @returns {{ appId, name, installDir, sizeOnDisk, lastUpdated, stateFlags }|null}
   */
  parseAppManifest(filePath) {
    try {
      const vdf   = parseVdf(fs.readFileSync(filePath, 'utf-8'));
      // Tolerate both "AppState" and "appstate" keys
      const state = vdf['AppState'] || vdf['appstate'] || Object.values(vdf)[0] || {};

      const appId      = String(state.appid      || state.AppID      || '').trim();
      const name       = String(state.name       || state.Name       || '').trim();
      const stateFlags = parseInt(state.StateFlags || state.stateflags || '0', 10);

      if (!appId || !name)    return null;
      // Bit 2 (value 4) = fully installed; allow 0 for edge cases
      if (stateFlags && !(stateFlags & 4)) return null;

      return {
        appId,
        name,
        installDir:  String(state.installdir  || state.InstallDir  || '').trim(),
        sizeOnDisk:  parseInt(state.SizeOnDisk || state.sizeondisk || '0', 10),
        lastUpdated: parseInt(state.LastUpdated || '0', 10),
        stateFlags
      };
    } catch { return null; }
  },

  /**
   * Scan all Steam library paths and return an array of canonical game entries.
   *
   * @param {string}  steamRoot   Full path to the Steam installation directory.
   * @returns {object[]}          Canonical game entries (Arqa Game Schema v1).
   */
  scan(steamRoot) {
    if (!steamRoot || !fs.existsSync(steamRoot)) return [];

    const entries = [];

    for (const libPath of this.getLibraryPaths(steamRoot)) {
      if (!fs.existsSync(libPath)) continue;
      let files;
      try { files = fs.readdirSync(libPath); } catch { continue; }

      for (const file of files) {
        if (!file.startsWith('appmanifest_') || !file.endsWith('.acf')) continue;
        const manifest = this.parseAppManifest(path.join(libPath, file));
        if (!manifest) continue;

        const art = steamArtwork(manifest.appId);

        entries.push({
          id:     `steam.${manifest.appId}`,
          title:  manifest.name,
          type:   'game',
          source: 'steam',

          paths: {
            executable:  null, // launched via steam:// URI
            localFolder: path.join(libPath, 'common', manifest.installDir),
            rom:         null
          },

          assets: {
            cover:           art.cover,
            icon:            art.icon,
            backgroundVideo: art.backgroundVideo,
            previewLoop:     art.previewLoop,
            audioPreview:    art.audioPreview,
            // Extra artwork (available to the UI but not part of the core schema)
            heroImage:       art.heroImage,
            headerImage:     art.headerImage
          },

          metadata: {
            description: `Steam App ${manifest.appId}`,
            developer:   '',
            publisher:   '',
            releaseYear: null,
            genre:       [],
            tags:        ['steam'],
            platform:    'steam',
            steamAppId:  manifest.appId
          },

          ui: {
            accentColor:     '#1a9fff',
            blurIntensity:   0.55,
            motionProfile:   'medium',
            transitionStyle: 'xmb'
          },

          behavior: {
            launchMode:      'steam',
            steamAppId:      manifest.appId,
            preloadPriority: 1,
            hoverPreview:    true,
            backgroundMode:  'image'
          }
        });
      }
    }

    return entries;
  }
};

module.exports = { SteamScanner, parseVdf };
