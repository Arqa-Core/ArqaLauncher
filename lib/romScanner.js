// ArqaLauncher — ROM Scanner
// Multi-directory recursive ROM scanner with automatic platform detection
// and emulator core mapping.
// Required by main.js — NOT loaded in the renderer.
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Platform ↔ file-extension mapping ─────────────────────────────────────────
const PLATFORM_EXTENSIONS = {
  ps1:       ['.bin', '.cue', '.img', '.pbp', '.chd'],
  ps2:       ['.iso', '.chd'],
  psp:       ['.cso', '.iso'],
  gamecube:  ['.rvz', '.gcm'],
  wii:       ['.wbfs'],
  snes:      ['.sfc', '.smc'],
  nes:       ['.nes'],
  n64:       ['.n64', '.z64', '.v64'],
  genesis:   ['.md', '.gen'],
  gba:       ['.gba'],
  gb:        ['.gb', '.gbc'],
  arcade:    ['.zip', '.7z'],
  dreamcast: ['.cdi', '.gdi'],
  switch:    ['.nsp', '.xci'],
  ps3:       ['.pkg'],
  generic:   ['.elf']
};

const ALL_ROM_EXTENSIONS = new Set([
  '.iso', '.bin', '.cue', '.pbp', '.elf',
  ...Object.values(PLATFORM_EXTENSIONS).flat()
]);

function detectPlatform(filename) {
  const ext = path.extname(filename).toLowerCase();
  for (const [platform, exts] of Object.entries(PLATFORM_EXTENSIONS)) {
    if (exts.includes(ext)) return platform;
  }
  if (ext === '.iso') return 'ps2';
  if (ext === '.elf') return 'generic';
  return 'unknown';
}

// ── Emulator core map ─────────────────────────────────────────────────────────
// Each entry provides Windows and Linux executable names plus argument templates.
// {rom} is replaced with the absolute ROM path at launch time.
const DEFAULT_EMULATOR_MAP = {
  ps1:       { name: 'DuckStation',                   execWindows: 'duckstation-qt.exe',    execLinux: 'duckstation-qt',    args: ['{rom}'] },
  ps2:       { name: 'PCSX2',                         execWindows: 'pcsx2-qt.exe',          execLinux: 'pcsx2-qt',          args: ['{rom}'] },
  psp:       { name: 'PPSSPP',                        execWindows: 'PPSSPPWindows64.exe',   execLinux: 'PPSSPPSDL',         args: ['{rom}'] },
  gamecube:  { name: 'Dolphin',                       execWindows: 'Dolphin.exe',           execLinux: 'dolphin-emu',       args: ['-e', '{rom}'] },
  wii:       { name: 'Dolphin',                       execWindows: 'Dolphin.exe',           execLinux: 'dolphin-emu',       args: ['-e', '{rom}'] },
  snes:      { name: 'RetroArch (Snes9x)',            execWindows: 'retroarch.exe',         execLinux: 'retroarch',         args: ['-L', 'snes9x_libretro', '{rom}'] },
  nes:       { name: 'RetroArch (Nestopia)',           execWindows: 'retroarch.exe',         execLinux: 'retroarch',         args: ['-L', 'nestopia_libretro', '{rom}'] },
  n64:       { name: 'RetroArch (Mupen64Plus-Next)',  execWindows: 'retroarch.exe',         execLinux: 'retroarch',         args: ['-L', 'mupen64plus_next_libretro', '{rom}'] },
  genesis:   { name: 'RetroArch (Genesis Plus GX)',  execWindows: 'retroarch.exe',         execLinux: 'retroarch',         args: ['-L', 'genesis_plus_gx_libretro', '{rom}'] },
  gba:       { name: 'RetroArch (mGBA)',              execWindows: 'retroarch.exe',         execLinux: 'retroarch',         args: ['-L', 'mgba_libretro', '{rom}'] },
  gb:        { name: 'RetroArch (Gambatte)',          execWindows: 'retroarch.exe',         execLinux: 'retroarch',         args: ['-L', 'gambatte_libretro', '{rom}'] },
  arcade:    { name: 'RetroArch (MAME)',              execWindows: 'retroarch.exe',         execLinux: 'retroarch',         args: ['-L', 'mame_libretro', '{rom}'] },
  dreamcast: { name: 'Flycast',                       execWindows: 'flycast.exe',           execLinux: 'flycast',           args: ['{rom}'] },
  switch:    { name: 'Ryujinx',                       execWindows: 'Ryujinx.exe',           execLinux: 'Ryujinx',           args: ['{rom}'] },
  ps3:       { name: 'RPCS3',                         execWindows: 'rpcs3.exe',             execLinux: 'rpcs3',             args: ['{rom}'] },
  generic:   { name: 'RetroArch',                     execWindows: 'retroarch.exe',         execLinux: 'retroarch',         args: ['{rom}'] }
};

// ── Title formatter ───────────────────────────────────────────────────────────
function formatTitle(filename) {
  return filename
    .replace(/\.[^/.]+$/, '')
    .replace(/[._()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Main scanner ──────────────────────────────────────────────────────────────
const RomScanner = {
  defaultEmulatorMap: DEFAULT_EMULATOR_MAP,
  platformExtensions: PLATFORM_EXTENSIONS,

  /**
   * Recursively scan a directory for known ROM files.
   *
   * @param {string}  dirPath
   * @param {boolean} [recursive=true]
   * @param {string}  [relBase='']  Relative sub-path within the root (used for display)
   * @returns {{ path: string, name: string, platform: string, relDir: string }[]}
   */
  scanDirectory(dirPath, recursive = true, relBase = '') {
    const results = [];
    if (!dirPath || !fs.existsSync(dirPath)) return results;

    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
    catch { return results; }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory() && recursive) {
        results.push(...RomScanner.scanDirectory(fullPath, recursive, path.join(relBase, entry.name)));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ALL_ROM_EXTENSIONS.has(ext)) {
          results.push({
            path:     fullPath,
            name:     entry.name,
            platform: detectPlatform(entry.name),
            relDir:   relBase
          });
        }
      }
    }
    return results;
  },

  /**
   * Scan multiple ROM directories and return canonical game entries.
   * Deduplicates across directories by normalised file path.
   *
   * @param {string[]} dirs               Directories to scan.
   * @param {boolean}  [recursive=true]
   * @param {object}   [emulatorOverrides={}]  Per-platform overrides (from settings).
   * @param {boolean}  [isWindows=false]
   * @returns {object[]}  Canonical game entries (Arqa Game Schema v1).
   */
  scanMultiple(dirs, recursive = true, emulatorOverrides = {}, isWindows = false) {
    const seen    = new Set();
    const entries = [];

    for (const dir of dirs) {
      if (!dir) continue;
      for (const rom of this.scanDirectory(dir, recursive)) {
        const normKey = rom.path.replace(/\\/g, '/').toLowerCase();
        if (seen.has(normKey)) continue;
        seen.add(normKey);

        const platform   = rom.platform;
        const emuBase    = emulatorOverrides[platform] || DEFAULT_EMULATOR_MAP[platform] || DEFAULT_EMULATOR_MAP.generic;
        const emuExe     = isWindows ? emuBase.execWindows : emuBase.execLinux;

        // Use a stable, hash-like id from the file path
        const idHash = normKey.replace(/[^a-z0-9]/g, '_').slice(-60);

        entries.push({
          id:     `rom.${idHash}`,
          title:  formatTitle(rom.name),
          type:   'game',
          source: 'local',

          paths: {
            executable:  null,
            localFolder: path.dirname(rom.path),
            rom:         rom.path
          },

          assets: {
            cover:           null,
            icon:            null,
            backgroundVideo: null,
            previewLoop:     null,
            audioPreview:    null
          },

          metadata: {
            description: emuBase.name || 'Unknown emulator',
            developer:   '',
            publisher:   '',
            releaseYear: null,
            genre:       [],
            tags:        ['rom', platform],
            platform,
            romFile:     rom.name,
            relDir:      rom.relDir
          },

          ui: {
            accentColor:     '#7b4dff',
            blurIntensity:   0.6,
            motionProfile:   'medium',
            transitionStyle: 'xmb'
          },

          behavior: {
            launchMode:      'rom',
            preloadPriority: 1,
            hoverPreview:    true,
            backgroundMode:  'gradient',
            emulatorConfig: {
              name:       emuBase.name,
              executable: emuExe,
              args:       emuBase.args || ['{rom}']
            }
          }
        });
      }
    }

    return entries;
  },

  /** Build a legacy-compatible scan result for a single folder (backward compat). */
  scanSingle(folderPath) {
    const roms = this.scanDirectory(folderPath, false)
      .map(r => r.name)
      .sort();

    const platforms = {};
    roms.forEach(rom => { platforms[rom] = detectPlatform(rom); });
    return { folderPath, roms, platforms };
  }
};

module.exports = { RomScanner, DEFAULT_EMULATOR_MAP, PLATFORM_EXTENSIONS, ALL_ROM_EXTENSIONS };
