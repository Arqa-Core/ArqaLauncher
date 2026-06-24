// ArqaLauncher — Platform Abstraction Layer
// Normalises OS-specific behaviour for Windows and Linux (ArqaOS).
// Required by main.js — NOT loaded in the renderer.
'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

// ── Inline tokenizer (mirrors the one in main.js) ────────────────────────────
function tokenizeArgs(str) {
  if (!str || !str.trim()) return [];
  const tokens = [];
  let current = '', inSingle = false, inDouble = false;
  for (const ch of str) {
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
const PlatformLayer = {
  isWindows: process.platform === 'win32',
  isLinux:   process.platform === 'linux',
  isMac:     process.platform === 'darwin',

  // ── Steam path candidates, ordered by probability ──────────────────────────
  getDefaultSteamPaths() {
    if (this.isWindows) {
      const pf86  = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const pf    = process.env.ProgramFiles         || 'C:\\Program Files';
      const local = process.env.LOCALAPPDATA         || path.join(os.homedir(), 'AppData', 'Local');
      return [
        path.join(pf86,  'Steam'),
        path.join(pf,    'Steam'),
        path.join(local, 'Steam')
      ];
    }
    const home = os.homedir();
    return [
      path.join(home, '.local', 'share', 'Steam'),
      path.join(home, '.steam', 'steam'),
      path.join(home, '.steam', 'Steam'),
      '/usr/local/games/Steam',
      '/opt/steam'
    ];
  },

  // ── Path helpers ───────────────────────────────────────────────────────────
  /** Expand ~ and %ENV_VAR% tokens. Returns null on failure. */
  resolvePath(p) {
    if (!p || typeof p !== 'string') return null;
    try {
      p = p.replace(/^~(?=[\\/]|$)/, os.homedir());
      if (this.isWindows) {
        p = p.replace(/%([^%]+)%/g, (_, v) => process.env[v] || _);
      }
      return path.normalize(p);
    } catch { return null; }
  },

  /** Return the first existing Steam root, checking an optional override first. */
  findSteamRoot(override) {
    if (override) {
      const r = this.resolvePath(override);
      if (r && fs.existsSync(r)) return r;
    }
    for (const c of this.getDefaultSteamPaths()) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  },

  // ── Binary resolution ──────────────────────────────────────────────────────
  /** Locate a binary in PATH. Returns its full path or null. */
  which(binary) {
    const dirs = (process.env.PATH || '').split(path.delimiter);
    const exts = this.isWindows
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map(e => e.toLowerCase())
      : [''];
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = path.join(dir, binary + ext);
        try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* keep looking */ }
      }
    }
    return null;
  },

  /** True if the file exists and is executable. */
  isExecutable(filePath) {
    if (!fs.existsSync(filePath)) return false;
    if (this.isWindows) return true; // Windows determines this by extension
    try { fs.accessSync(filePath, fs.constants.X_OK); return true; } catch { return false; }
  },

  // ── Application scanner ────────────────────────────────────────────────────
  /**
   * Scan a directory for launchable applications (.exe/.bat on Windows;
   * .AppImage/.sh/executables on Linux).
   */
  scanForApps(directory) {
    if (!directory || !fs.existsSync(directory)) return [];
    const allowedExts = this.isWindows
      ? new Set(['.exe', '.bat', '.cmd'])
      : new Set(['.sh', '.appimage', '.AppImage']);

    try {
      return fs.readdirSync(directory, { withFileTypes: true })
        .filter(e => {
          if (!e.isFile()) return false;
          const ext = path.extname(e.name).toLowerCase();
          if (this.isWindows) return allowedExts.has(ext);
          // Linux: allow known exts OR no extension (native binaries)
          return allowedExts.has(ext) || allowedExts.has(e.name) ||
                 (!ext && this.isExecutable(path.join(directory, e.name)));
        })
        .map(e => ({ name: e.name, path: path.join(directory, e.name), ext: path.extname(e.name) }));
    } catch { return []; }
  },

  // ── Launch command builder ─────────────────────────────────────────────────
  /**
   * Translate a canonical registry entry into a { command, args, shell? } object
   * ready to pass to child_process.spawn().  Returns null if launch is impossible.
   */
  buildLaunchArgs(entry, settings = {}) {
    const mode = entry?.behavior?.launchMode;

    switch (mode) {
      case 'steam': {
        const appId = entry.behavior.steamAppId;
        if (!appId) return null;
        const uri = `steam://rungameid/${appId}`;
        if (this.isWindows) return { command: 'cmd', args: ['/c', 'start', '', uri], shell: true };
        return { command: 'xdg-open', args: [uri] };
      }

      case 'rom': {
        const emuCfg  = entry.behavior?.emulatorConfig;
        const romPath = entry.paths?.rom;
        if (!emuCfg?.executable || !romPath) return null;
        const args = (emuCfg.args || ['{rom}']).map(a => a === '{rom}' ? romPath : a);
        return { command: emuCfg.executable, args };
      }

      case 'exe': {
        const exe = entry.paths?.executable;
        if (!exe) return null;
        const extra = tokenizeArgs(settings.extraArgs || '');
        if (this.isLinux && settings.useGamescope !== false) {
          const gamescope = this.which('gamescope');
          if (gamescope) return { command: gamescope, args: ['-f', '--', exe, ...extra] };
        }
        return { command: exe, args: extra };
      }

      case 'uri': {
        const uri = entry.paths?.executable;
        if (!uri) return null;
        if (this.isWindows) return { command: 'cmd', args: ['/c', 'start', '', uri], shell: true };
        return { command: 'xdg-open', args: [uri] };
      }

      case 'desktop': {
        // Linux .desktop file
        const desktopFile = entry.paths?.executable;
        if (!desktopFile) return null;
        return { command: 'gtk-launch', args: [path.basename(desktopFile, '.desktop')] };
      }

      default:
        return null;
    }
  }
};

module.exports = PlatformLayer;
