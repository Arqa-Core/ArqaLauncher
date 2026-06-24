const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// ── Discord integration modules ───────────────────────────────────────────────
const { DiscordAuth }                              = require('./lib/discordAuth');
const { DiscordRestClient, DiscordGateway }        = require('./lib/discordClient');
const { DiscordPresence, buildGameActivity, buildIdleActivity } = require('./lib/discordPresence');
const {
  sanitizeUser, sanitizeMessages, sanitizeChannels, sanitizeGuilds,
  sanitizeFriends, sanitizeMessage, sanitizeChannel, sanitizeGuild,
  sanitizeText
} = require('./lib/discordSanitizer');

// ── Arqa platform abstraction + scanner modules ───────────────────────────────
const PlatformLayer  = require('./lib/platformLayer');
const { SteamScanner } = require('./lib/steamScanner');
const { RomScanner }   = require('./lib/romScanner');

let mainWindow;
let gameProcess = null;

// ---------- Shell-style argument tokenizer ----------
function tokenizeArgs(str) {
  if (!str || !str.trim()) return [];
  const tokens = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
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

// ---------- Settings persistence ----------
const SETTINGS_FILE = path.join(app.getPath('userData'), 'arqa-settings.json');

function defaultSettings() {
  return {
    // ── Legacy fields (preserved for backward compatibility) ──────────────────
    bazzitePath:   null,
    libraryFolder: null,
    useGamescope:  true,
    extraArgs:     '',
    recentlyPlayed: [],
    // ── Extended fields ───────────────────────────────────────────────────────
    steamPath:           null,   // Override Steam installation directory
    enableSteamScan:     true,   // Auto-detect and scan Steam on startup
    romDirectories:      [],     // Multiple ROM directories for multi-dir scan
    appDirectories:      [],     // Application directories to enumerate
    emulatorMap:         {},     // Per-platform emulator executable overrides
    enableRecursiveScan: true    // Recurse into sub-directories when scanning ROMs
  };
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultSettings();
  }
}

function persistSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to persist Arqa settings:', err);
  }
}

let settings = loadSettings();

// ---------- ROM platform detection ----------
const PLATFORM_EXTENSIONS = {
  ps1: ['.bin', '.cue', '.img', '.pbp', '.chd'],
  ps2: ['.iso', '.chd'],
  psp: ['.cso'],
  gamecube: ['.rvz', '.gcm'],
  wii: ['.wbfs'],
  snes: ['.sfc', '.smc'],
  nes: ['.nes'],
  n64: ['.n64', '.z64', '.v64'],
  genesis: ['.md', '.gen'],
  gba: ['.gba'],
  gb: ['.gb', '.gbc'],
  arcade: ['.zip', '.7z'],
  dreamcast: ['.cdi', '.gdi'],
  switch: ['.nsp', '.xci'],
  generic: ['.elf']
};

const KNOWN_EXTENSIONS = new Set([
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

function scanFolder(folderPath) {
  let entries;
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch (err) {
    return { error: `Could not read folder: ${err.message}` };
  }

  const roms = entries
    .filter((entry) => entry.isFile() && KNOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort();

  if (!roms.length) {
    return { error: 'No compatible ROM files found in that folder.' };
  }

  const platforms = {};
  roms.forEach((rom) => { platforms[rom] = detectPlatform(rom); });

  return { folderPath, roms, platforms };
}

function which(binary) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, binary);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ---------- Minimize on launch / restore on exit ----------
function minimizeLauncher() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (process.platform === 'linux') {
    // On Linux, exit fullscreen before minimizing so the window manager
    // doesn't get confused with a fullscreen-pinned window.
    mainWindow.setFullScreen(false);
  }
  mainWindow.minimize();
}

function restoreLauncher() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.restore();
  mainWindow.setFullScreen(true);
  mainWindow.focus();
}

// ---------- Window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 1100,
    minHeight: 640,
    title: 'Arqa Launcher',
    frame: false,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#05030c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,  // Required for the Discord embedded web client
      // Allow audio autoplay for menu sounds, navigation, and background music
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  // Ensure the assets directory exists with required audio files
  const assetsDir = path.join(__dirname, 'renderer', 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
    console.log('Created assets directory:', assetsDir);
  }

  // Verify required audio files exist, log warnings if missing
  const requiredAudioFiles = [
    'nav1.wav',
    'nav2.wav', 
    'select.wav',
    'invalid.wav',
    'menumusic1.mp3'
  ];

  requiredAudioFiles.forEach(audioFile => {
    const audioPath = path.join(assetsDir, audioFile);
    if (!fs.existsSync(audioPath)) {
      console.warn(`Audio file not found: ${audioPath}. Sound effects may not play.`);
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Allow media autoplay without requiring user interaction
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(async () => {
  createWindow();
  // Auto-restore Discord session after window is created
  const ds = getDiscordSettings();
  if (ds.discordAutoConnect !== false) {
    try {
      ensureDiscordInstances();
      const session = _discordAuth.loadSession();
      if (session) {
        const token = await _discordAuth.getAccessToken();
        if (token) {
          _discordRest.setToken(token, session.tokenType || 'Bearer');
          _discordGateway.connect(token);
        }
      }
      _discordPresence.start();
    } catch (err) {
      console.warn('[Discord] Auto-restore failed:', err.message);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ---------- Executable / library selection ----------
ipcMain.handle('select-bazzite-executable', async () => {
  const wasFullscreen = mainWindow?.isFullScreen();
  if (wasFullscreen) mainWindow.setFullScreen(false);

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Bazzite Executable',
    properties: ['openFile'],
    filters: [{ name: 'All Files', extensions: ['*'] }]
  });

  if (wasFullscreen) mainWindow.setFullScreen(true);

  if (result.canceled || !result.filePaths.length) return null;

  const selected = result.filePaths[0];
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(selected, fs.constants.X_OK);
    } catch {
      return { error: `"${path.basename(selected)}" is not executable. Run: chmod +x "${selected}"` };
    }
  }

  settings.bazzitePath = selected;
  persistSettings();
  return selected;
});

ipcMain.handle('select-rom-folder', async () => {
  const wasFullscreen = mainWindow?.isFullScreen();
  if (wasFullscreen) mainWindow.setFullScreen(false);

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Game Folder',
    properties: ['openDirectory']
  });

  if (wasFullscreen) mainWindow.setFullScreen(true);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const scanned = scanFolder(result.filePaths[0]);
  if (!scanned.error) {
    settings.libraryFolder = scanned.folderPath;
    persistSettings();
  }
  return scanned;
});

ipcMain.handle('rescan-rom-folder', (_event, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { error: 'That library folder no longer exists. Pick a new one.' };
  }
  return scanFolder(folderPath);
});

// ---------- Settings ----------
ipcMain.handle('get-settings', () => settings);

ipcMain.handle('save-settings', (_event, partial) => {
  settings = { ...settings, ...partial };
  persistSettings();
  return settings;
});

// ---------- Launching ----------
ipcMain.handle('launch-bazzite', async (_event, { executablePath, romPath, extraArgs = [], useGamescope }) => {
  if (!executablePath || !romPath) {
    return { success: false, error: 'Bazzite path and ROM path are required.' };
  }
  if (gameProcess) {
    return { success: false, error: 'A game is already running. Stop it before launching another.' };
  }
  if (!fs.existsSync(executablePath)) {
    return { success: false, error: 'Emulator executable not found. Re-select it from Home.' };
  }
  if (!fs.existsSync(romPath)) {
    return { success: false, error: 'ROM file not found on disk.' };
  }
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(executablePath, fs.constants.X_OK);
    } catch {
      return { success: false, error: 'Emulator executable is not marked executable (chmod +x).' };
    }
  }

  const wantsGamescope = useGamescope !== false;
  const gamescopeBin = wantsGamescope ? which('gamescope') : null;
  const globalArgs = tokenizeArgs(settings.extraArgs || '');

  let command;
  let args;
  if (gamescopeBin) {
    command = gamescopeBin;
    args = ['-f', '--', executablePath, romPath, ...globalArgs, ...extraArgs];
  } else {
    command = executablePath;
    args = [romPath, ...globalArgs, ...extraArgs];
  }

  try {
    gameProcess = spawn(command, args, {
      windowsHide: true,
      cwd: path.dirname(executablePath)
    });
  } catch (error) {
    gameProcess = null;
    return { success: false, error: error.message };
  }

  minimizeLauncher();

  const PROCESS_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours
  const processWatchdog = setTimeout(() => {
    if (gameProcess) {
      mainWindow?.webContents.send('bazzite-output', '[arqa] Process exceeded timeout, force-killing.');
      gameProcess.kill('SIGKILL');
    }
  }, PROCESS_TIMEOUT_MS);

  gameProcess.stdout.on('data', (data) => {
    mainWindow?.webContents.send('bazzite-output', data.toString());
  });

  gameProcess.stderr.on('data', (data) => {
    mainWindow?.webContents.send('bazzite-output', data.toString());
  });

  gameProcess.on('error', (error) => {
    clearTimeout(processWatchdog);
    mainWindow?.webContents.send('bazzite-output', `Process error: ${error.message}`);
    mainWindow?.webContents.send('bazzite-exit', -1);
    gameProcess = null;
  });

  gameProcess.on('close', (code) => {
    clearTimeout(processWatchdog);
    mainWindow?.webContents.send('bazzite-exit', code);
    gameProcess = null;
    restoreLauncher();
  });

  settings.recentlyPlayed = [romPath, ...settings.recentlyPlayed.filter((p) => p !== romPath)].slice(0, 8);
  persistSettings();

  return { success: true, usedGamescope: Boolean(gamescopeBin) };
});

ipcMain.handle('stop-bazzite', () => {
  if (!gameProcess) return { success: false, error: 'No game is currently running.' };
  gameProcess.kill('SIGTERM');
  return { success: true };
});

// ---------- System power ----------
function spawnSystemCommand(cmd, args) {
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `${err.message}. Arqa may need a polkit rule to allow this without a password.`
    };
  }
}

ipcMain.handle('system-power', (_event, action) => {
  switch (action) {
    case 'quit':
      app.quit();
      return { success: true };
    case 'restart':
      return spawnSystemCommand('systemctl', ['reboot']);
    case 'shutdown':
      return spawnSystemCommand('systemctl', ['poweroff']);
    case 'sleep':
      return spawnSystemCommand('systemctl', ['suspend']);
    default:
      return { success: false, error: 'Unknown power action.' };
  }
});

// ---------- Window chrome controls ----------
ipcMain.handle('close-window', () => {
  if (mainWindow) {
    return;
  }
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('enter-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(true);
  }
});

ipcMain.handle('exit-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(false);
  }
});

ipcMain.handle('toggle-maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

// ---------- Library manifest (library.json) ----------
ipcMain.handle('load-library-manifest', (_event, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') return null;
  const manifestPath = path.join(folderPath, 'library.json');
  try {
    if (!fs.existsSync(manifestPath)) return null;
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return { error: `Failed to read library.json: ${err.message}` };
  }
});

ipcMain.handle('save-library-manifest', (_event, folderPath, manifest) => {
  if (!folderPath || typeof folderPath !== 'string') {
    return { success: false, error: 'No folder path provided.' };
  }
  const manifestPath = path.join(folderPath, 'library.json');
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============================================================
// PLATFORM ABSTRACTION + EXTENDED SCANNER IPC HANDLERS
// ============================================================

// ── Platform info ─────────────────────────────────────────────────────────────
ipcMain.handle('platform-info', () => ({
  platform:   process.platform,
  isWindows:  PlatformLayer.isWindows,
  isLinux:    PlatformLayer.isLinux,
  steamPaths: PlatformLayer.getDefaultSteamPaths(),
  dataDir:    app.getPath('userData')
}));

// ── Steam library scan ────────────────────────────────────────────────────────
ipcMain.handle('scan-steam-library', (_event, steamPathOverride) => {
  const root = PlatformLayer.findSteamRoot(steamPathOverride || settings.steamPath);
  if (!root) {
    return { error: 'Steam installation not found. Set a custom path in Settings.' };
  }
  try {
    const entries = SteamScanner.scan(root);
    if (!entries.length) {
      return { error: 'No installed Steam games found in the detected library paths.' };
    }
    return { steamRoot: root, entries };
  } catch (err) {
    return { error: `Steam scan failed: ${err.message}` };
  }
});

// ── Multi-directory ROM scan ──────────────────────────────────────────────────
ipcMain.handle('scan-rom-directories', (_event, dirs) => {
  const directories = Array.isArray(dirs) && dirs.length
    ? dirs
    : (settings.romDirectories || []);

  if (!directories.length) {
    return { error: 'No ROM directories configured.' };
  }

  try {
    const entries = RomScanner.scanMultiple(
      directories,
      settings.enableRecursiveScan !== false,
      settings.emulatorMap || {},
      PlatformLayer.isWindows
    );
    return { directories, entries };
  } catch (err) {
    return { error: `ROM scan failed: ${err.message}` };
  }
});

// ── Add / remove ROM directory (with dialog) ──────────────────────────────────
ipcMain.handle('add-rom-directory', async () => {
  const wasFullscreen = mainWindow?.isFullScreen();
  if (wasFullscreen) mainWindow.setFullScreen(false);

  const result = await dialog.showOpenDialog(mainWindow, {
    title:      'Select ROM Directory',
    properties: ['openDirectory']
  });

  if (wasFullscreen) mainWindow.setFullScreen(true);
  if (result.canceled || !result.filePaths.length) return null;

  const chosen = result.filePaths[0];
  if (!settings.romDirectories) settings.romDirectories = [];
  if (!settings.romDirectories.includes(chosen)) {
    settings.romDirectories.push(chosen);
    persistSettings();
  }
  const entries = RomScanner.scanMultiple(
    [chosen],
    settings.enableRecursiveScan !== false,
    settings.emulatorMap || {},
    PlatformLayer.isWindows
  );
  return { path: chosen, entries };
});

ipcMain.handle('remove-rom-directory', (_event, dirPath) => {
  if (!settings.romDirectories) return { success: false };
  settings.romDirectories = settings.romDirectories.filter(d => d !== dirPath);
  persistSettings();
  return { success: true };
});

// ── App directory scan ────────────────────────────────────────────────────────
ipcMain.handle('scan-app-directory', (_event, dirPath) => {
  if (!dirPath) return { error: 'No directory specified.' };
  const apps = PlatformLayer.scanForApps(dirPath);
  if (!apps.length) return { error: 'No applications found in that directory.' };
  const isWin = PlatformLayer.isWindows;
  const entries = apps.map(a => ({
    id:       `app.${a.path.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(-50)}`,
    title:    a.name.replace(/\.[^/.]+$/, '').replace(/[._-]+/g, ' ').trim(),
    type:     'app',
    source:   'local',
    paths:    { executable: a.path, localFolder: dirPath, rom: null },
    assets:   { cover: null, icon: null, backgroundVideo: null, previewLoop: null, audioPreview: null },
    metadata: { description: isWin ? 'Windows Application' : 'Application', platform: 'native', tags: ['app'] },
    ui:       { accentColor: '#4a9eff', blurIntensity: 0.5, motionProfile: 'low', transitionStyle: 'snap' },
    behavior: { launchMode: 'exe', preloadPriority: 2, hoverPreview: false, backgroundMode: 'gradient' }
  }));
  return { directory: dirPath, entries };
});

ipcMain.handle('add-app-directory', async () => {
  const wasFullscreen = mainWindow?.isFullScreen();
  if (wasFullscreen) mainWindow.setFullScreen(false);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Applications Directory', properties: ['openDirectory']
  });
  if (wasFullscreen) mainWindow.setFullScreen(true);
  if (result.canceled || !result.filePaths.length) return null;
  const chosen = result.filePaths[0];
  if (!settings.appDirectories) settings.appDirectories = [];
  if (!settings.appDirectories.includes(chosen)) { settings.appDirectories.push(chosen); persistSettings(); }
  return chosen;
});

// ── Unified item launcher ─────────────────────────────────────────────────────
ipcMain.handle('launch-item', async (_event, { game }) => {
  if (!game) return { success: false, error: 'No game entry provided.' };
  if (gameProcess) return { success: false, error: 'A game is already running.' };

  const launchArgs = PlatformLayer.buildLaunchArgs(game, settings);
  if (!launchArgs) {
    // Fallback to legacy bazzite path for ROM-type entries
    if (game.paths?.rom && settings.bazzitePath) {
      const bazziteExe = settings.bazzitePath;
      const romPath    = game.paths.rom;
      if (!fs.existsSync(bazziteExe)) return { success: false, error: 'Emulator not found.' };
      if (!fs.existsSync(romPath))    return { success: false, error: 'ROM file not found.' };
      try {
        gameProcess = spawn(bazziteExe, [romPath], { windowsHide: true, cwd: path.dirname(bazziteExe) });
      } catch (err) { gameProcess = null; return { success: false, error: err.message }; }
    } else {
      return { success: false, error: 'Cannot determine how to launch this item.' };
    }
  } else {
    try {
      gameProcess = spawn(launchArgs.command, launchArgs.args, {
        windowsHide: true,
        shell:       launchArgs.shell || false,
        cwd:         game.paths?.localFolder || undefined
      });
    } catch (err) { gameProcess = null; return { success: false, error: err.message }; }
  }

  minimizeLauncher();

  const WATCHDOG_MS = 8 * 60 * 60 * 1000;
  const watchdog = setTimeout(() => {
    if (gameProcess) { mainWindow?.webContents.send('bazzite-output', '[arqa] Watchdog timeout.'); gameProcess.kill('SIGKILL'); }
  }, WATCHDOG_MS);

  gameProcess.stdout?.on('data', d => mainWindow?.webContents.send('bazzite-output', d.toString()));
  gameProcess.stderr?.on('data', d => mainWindow?.webContents.send('bazzite-output', d.toString()));
  gameProcess.on('error', err => {
    clearTimeout(watchdog);
    mainWindow?.webContents.send('bazzite-output', `Process error: ${err.message}`);
    mainWindow?.webContents.send('bazzite-exit', -1);
    gameProcess = null;
  });
  gameProcess.on('close', code => {
    clearTimeout(watchdog);
    mainWindow?.webContents.send('bazzite-exit', code);
    gameProcess = null;
    restoreLauncher();
  });

  settings.recentlyPlayed = [
    game.id,
    ...(settings.recentlyPlayed || []).filter(id => id !== game.id)
  ].slice(0, 16);
  persistSettings();

  return { success: true };
});

// ── Emulator configuration ────────────────────────────────────────────────────
ipcMain.handle('get-emulator-config', () => {
  const { DEFAULT_EMULATOR_MAP } = require('./lib/romScanner');
  const result = {};
  for (const [platform, base] of Object.entries(DEFAULT_EMULATOR_MAP)) {
    result[platform] = { ...base, ...(settings.emulatorMap?.[platform] || {}) };
  }
  return result;
});

ipcMain.handle('save-emulator-config', (_event, overrides) => {
  if (!overrides || typeof overrides !== 'object') return { success: false };
  settings.emulatorMap = { ...(settings.emulatorMap || {}), ...overrides };
  persistSettings();
  return { success: true };
});

// ═══════════════════════════════════════════════════════════════════════════════
// DISCORD INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

// ── Discord runtime singletons ────────────────────────────────────────────────
let _discordAuth     = null;
let _discordRest     = null;
let _discordGateway  = null;
let _discordPresence = null;
let _discordReady    = false;  // true once Gateway fires READY
const _guildChannelCache = new Map(); // guildId → sanitized Channel[]
let   _dmChannelCache    = [];        // sanitized DM Channel[] from READY
let   _relationshipCache = [];        // sanitized Friend[] from READY
const _messageCache      = new Map(); // channelId → sanitized Message[] (last 100, newest last)

// Discord settings live alongside main settings (not exposed to renderer).
const DISCORD_SETTINGS_DEFAULTS = {
  discordClientId:     '',
  discordClientSecret: '',
  discordPresenceClientId: '1234567890', // Public RPC client ID for Rich Presence
  discordAutoConnect:  true,
};

function getDiscordSettings() {
  return {
    ...DISCORD_SETTINGS_DEFAULTS,
    ...(settings.discord || {}),
  };
}

function persistDiscordSettings(partial) {
  settings.discord = { ...getDiscordSettings(), ...partial };
  persistSettings();
}

// ── Lazy initialise Discord singletons ────────────────────────────────────────
function ensureDiscordInstances() {
  const ds = getDiscordSettings();
  if (!_discordAuth) {
    _discordAuth = new DiscordAuth(
      app.getPath('userData'),
      ds.discordClientId,
      ds.discordClientSecret
    );
    // Update credentials if settings changed
  } else {
    _discordAuth._clientId     = ds.discordClientId;
    _discordAuth._clientSecret = ds.discordClientSecret;
  }
  if (!_discordRest)    _discordRest    = new DiscordRestClient();
  if (!_discordGateway) {
    _discordGateway = new DiscordGateway(_discordRest);
    _wireGatewayEvents();
  }
  if (!_discordPresence) {
    _discordPresence = new DiscordPresence(ds.discordPresenceClientId);
  } else {
    _discordPresence._clientId = ds.discordPresenceClientId;
  }
}

// ── Forward Gateway events to renderer ───────────────────────────────────────
function _wireGatewayEvents() {
  const gw = _discordGateway;

  gw.on('ready', (data) => {
    _discordReady = true;
    // Populate caches from the READY payload (DMs + relationships arrive here
    // because their OAuth2 scopes are restricted and REST calls would fail).
    if (data.privateChannels?.length) _dmChannelCache    = data.privateChannels;
    if (data.relationships?.length)   _relationshipCache = data.relationships;
    // Pre-populate guild channel cache from guilds included in READY.
    if (Array.isArray(data.guilds)) {
      for (const g of data.guilds) {
        if (g.id && Array.isArray(g.channels) && g.channels.length) {
          _guildChannelCache.set(g.id, g.channels);
        }
      }
    }
    mainWindow?.webContents.send('discord-ready', data);
  });
  gw.on('resumed', () => {
    _discordReady = true;
    mainWindow?.webContents.send('discord-reconnected');
  });
  gw.on('disconnected', () => {
    _discordReady = false;
    mainWindow?.webContents.send('discord-disconnected');
  });
  gw.on('error', (err) => {
    mainWindow?.webContents.send('discord-error', { message: err.message });
  });

  gw.on('messageCreate',   (msg)    => {
    // Cache real-time messages so channels have content even if REST history fails.
    if (msg?.channelId) {
      const bucket = _messageCache.get(msg.channelId) || [];
      bucket.push(msg);
      if (bucket.length > 100) bucket.splice(0, bucket.length - 100);
      _messageCache.set(msg.channelId, bucket);
    }
    mainWindow?.webContents.send('discord-message-create', msg);
  });
  gw.on('messageUpdate',   (msg)    => mainWindow?.webContents.send('discord-message-update',   msg));
  gw.on('messageDelete',   (data)   => mainWindow?.webContents.send('discord-message-delete',   data));
  gw.on('typingStart',     (data)   => mainWindow?.webContents.send('discord-typing-start',     data));
  gw.on('presenceUpdate',  (data)   => mainWindow?.webContents.send('discord-presence-update',  data));
  gw.on('channelUpdate',   (ch)     => mainWindow?.webContents.send('discord-channel-update',   ch));
  gw.on('channelDelete',   (data)   => mainWindow?.webContents.send('discord-channel-delete',   data));
  gw.on('reactionUpdate',  (data)   => mainWindow?.webContents.send('discord-reaction-update',  data));
  gw.on('relationshipAdd', (data)   => mainWindow?.webContents.send('discord-relationship-add', data));
  gw.on('relationshipRemove',(data) => mainWindow?.webContents.send('discord-relationship-remove', data));
  gw.on('guildCreate',     (guild)  => {
    if (Array.isArray(guild.channels) && guild.channels.length) {
      _guildChannelCache.set(guild.id, guild.channels);
    }
    mainWindow?.webContents.send('discord-guild-create', guild);
  });
  gw.on('guildUpdate',     (guild)  => mainWindow?.webContents.send('discord-guild-update',     guild));
  gw.on('guildDelete',     (data)   => mainWindow?.webContents.send('discord-guild-delete',     data));
  gw.on('notification',    (notif)  => mainWindow?.webContents.send('discord-notification',     notif));
}

// ── Helper: require authentication ───────────────────────────────────────────
async function requireToken() {
  ensureDiscordInstances();
  const token = await _discordAuth.getAccessToken();
  if (!token) throw new Error('Not authenticated. Please sign in to Discord.');
  _discordRest.setToken(token, _discordAuth._session?.tokenType || 'Bearer');
  return token;
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC HANDLERS — AUTH
// ─────────────────────────────────────────────────────────────────────────────

/** Return current auth state without triggering a login. */
ipcMain.handle('discord-auth-status', async () => {
  ensureDiscordInstances();
  const session = _discordAuth.getSession();
  if (!session) return { authenticated: false };
  return {
    authenticated: _discordAuth.isAuthenticated(),
    user: session.user ? sanitizeUser(session.user) : null,
    connected: _discordGateway?.connected || false,
  };
});

/** Start the OAuth2 login flow. */
ipcMain.handle('discord-login', async () => {
  ensureDiscordInstances();
  const ds = getDiscordSettings();
  if (!ds.discordClientId || !ds.discordClientSecret) {
    return {
      success: false,
      error: 'Discord application credentials not configured. Add your Client ID and Secret in Discord Settings.',
    };
  }
  try {
    const { user, accessToken } = await _discordAuth.startOAuthFlow(mainWindow);
    _discordRest.setToken(accessToken, _discordAuth._session?.tokenType || 'Bearer');

    // Connect Gateway
    _discordGateway.connect(accessToken);

    // Start Rich Presence
    if (!_discordPresence.isConnected) _discordPresence.start();

    return { success: true, user: sanitizeUser(user) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** Disconnect and log out. */
ipcMain.handle('discord-logout', async () => {
  ensureDiscordInstances();
  _discordGateway.disconnect();
  _discordPresence.clearActivity();
  _discordRest.clearToken();
  await _discordAuth.logout();
  _discordReady = false;
  mainWindow?.webContents.send('discord-disconnected');
  return { success: true };
});

/** Auto-restore session on startup. */
ipcMain.handle('discord-restore-session', async () => {
  ensureDiscordInstances();
  const session = _discordAuth.loadSession();
  if (!session) return { restored: false };

  try {
    const token = await _discordAuth.getAccessToken();
    if (!token) return { restored: false };
    _discordRest.setToken(token, session.tokenType || 'Bearer');
    _discordGateway.connect(token);
    if (!_discordPresence.isConnected) _discordPresence.start();
    return { restored: true, user: session.user ? sanitizeUser(session.user) : null };
  } catch {
    return { restored: false };
  }
});

/** Save Discord application credentials (client ID + secret). */
ipcMain.handle('discord-save-credentials', async (_event, { clientId, clientSecret, presenceClientId }) => {
  const patch = {};
  if (typeof clientId         === 'string') patch.discordClientId           = sanitizeText(clientId.trim(), 20);
  // Only overwrite secret when the user actually provided a new non-empty value
  if (typeof clientSecret     === 'string' && clientSecret.trim().length > 0)
    patch.discordClientSecret = clientSecret.trim().slice(0, 64);
  if (typeof presenceClientId === 'string') patch.discordPresenceClientId  = sanitizeText(presenceClientId.trim(), 20);
  persistDiscordSettings(patch);
  // Re-init with new creds
  if (_discordAuth) {
    _discordAuth._clientId     = patch.discordClientId     || _discordAuth._clientId;
    _discordAuth._clientSecret = patch.discordClientSecret || _discordAuth._clientSecret;
  }
  return { success: true };
});

ipcMain.handle('discord-get-app-config', () => {
  const ds = getDiscordSettings();
  return {
    clientId:        ds.discordClientId         || '',
    presenceClientId: ds.discordPresenceClientId || '',
    hasSecret:       !!(ds.discordClientSecret && ds.discordClientSecret.length > 0),
  };
});

// ── Discord webview session token cache ────────────────────────────────────
// Stores the Discord browser-side auth token so the webview can auto-login
// after the persist:discord session expires. File is gitignored.
const DISCORD_WEB_TOKEN_FILE = path.join(__dirname, '.discord-auth');

ipcMain.handle('discord-save-webtoken', (_event, token) => {
  if (typeof token !== 'string' || !token.trim()) return;
  // Only accept plausible Discord token format (base64url segments joined by dots)
  if (!/^[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+$/.test(token.trim())) return;
  try { fs.writeFileSync(DISCORD_WEB_TOKEN_FILE, token.trim(), { encoding: 'utf8', mode: 0o600 }); }
  catch (_) {}
});

ipcMain.handle('discord-load-webtoken', () => {
  try {
    const raw = fs.readFileSync(DISCORD_WEB_TOKEN_FILE, 'utf8').trim();
    // Validate before returning to the renderer
    if (/^[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-=]+$/.test(raw)) return raw;
    return null;
  } catch (_) { return null; }
});

// ─────────────────────────────────────────────────────────────────────────────
// IPC HANDLERS — FRIENDS
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('discord-get-friends', async () => {
  // Prefer cache from Gateway READY (relationships.read is a restricted scope).
  if (_relationshipCache.length > 0) return { friends: _relationshipCache };
  try {
    await requireToken();
    const raw = await _discordRest.getRelationships();
    _relationshipCache = sanitizeFriends(raw);
    return { friends: _relationshipCache };
  } catch (err) {
    // Gracefully return empty list if the scope is unavailable.
    return { friends: [], notice: 'Friends list requires Discord partner approval for this app.' };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// IPC HANDLERS — DIRECT MESSAGES
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('discord-get-dm-channels', async () => {
  // Prefer cache from Gateway READY (dm_channels.read is a restricted scope).
  if (_dmChannelCache.length > 0) return { channels: _dmChannelCache };
  try {
    await requireToken();
    const raw = await _discordRest.getMyChannels();
    // Filter to DM channels (type 1) and group DMs (type 3)
    const dms = Array.isArray(raw)
      ? raw.filter(c => c.type === 1 || c.type === 3)
      : [];
    _dmChannelCache = sanitizeChannels(dms);
    return { channels: _dmChannelCache };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('discord-open-dm', async (_event, userId) => {
  try {
    const uid = sanitizeText(String(userId || ''), 20).replace(/[^0-9]/g, '');
    if (!uid) return { error: 'Invalid user ID.' };
    await requireToken();
    const raw = await _discordRest.openDM(uid);
    return { channel: sanitizeChannel(raw) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('discord-get-messages', async (_event, channelId, options) => {
  try {
    const cid = sanitizeText(String(channelId || ''), 20).replace(/[^0-9]/g, '');
    if (!cid) return { error: 'Invalid channel ID.' };
    await requireToken();
    const raw = await _discordRest.getChannelMessages(cid, {
      limit:  Math.min(options?.limit  || 50, 100),
      before: options?.before || undefined,
      after:  options?.after  || undefined,
    });
    const messages = sanitizeMessages(raw);
    // Merge with any cached Gateway messages and update cache.
    const existing = _messageCache.get(cid) || [];
    const merged   = [...messages].reverse();
    const ids      = new Set(merged.map(m => m.id));
    for (const m of existing) { if (!ids.has(m.id)) { ids.add(m.id); merged.push(m); } }
    merged.sort((a, b) => (a.id > b.id ? 1 : -1));
    const trimmed = merged.slice(-100);
    _messageCache.set(cid, trimmed);
    return { messages: sanitizeMessages(raw) };
  } catch (err) {
    // messages.read scope may still be refused — fall back to Gateway cache.
    const cached = _messageCache.get(
      sanitizeText(String(channelId || ''), 20).replace(/[^0-9]/g, '')
    ) || [];
    return { messages: cached, limited: cached.length === 0 };
  }
});

ipcMain.handle('discord-send-message', async (_event, channelId, content, opts) => {
  try {
    const cid  = sanitizeText(String(channelId || ''), 20).replace(/[^0-9]/g, '');
    const text = String(content || '').trim().slice(0, 2000);
    if (!cid || !text) return { error: 'Channel ID and message content are required.' };
    await requireToken();
    const raw = await _discordRest.sendMessage(cid, text, {
      replyTo: opts?.replyTo ? String(opts.replyTo).replace(/[^0-9]/g, '') : undefined,
    });
    return { message: sanitizeMessage(raw) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('discord-edit-message', async (_event, channelId, messageId, content) => {
  try {
    const cid  = sanitizeText(String(channelId || ''), 20).replace(/[^0-9]/g, '');
    const mid  = sanitizeText(String(messageId || ''), 20).replace(/[^0-9]/g, '');
    const text = String(content || '').trim().slice(0, 2000);
    if (!cid || !mid || !text) return { error: 'Channel, message ID, and content required.' };
    await requireToken();
    const raw = await _discordRest.editMessage(cid, mid, text);
    return { message: sanitizeMessage(raw) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('discord-delete-message', async (_event, channelId, messageId) => {
  try {
    const cid = sanitizeText(String(channelId || ''), 20).replace(/[^0-9]/g, '');
    const mid = sanitizeText(String(messageId || ''), 20).replace(/[^0-9]/g, '');
    if (!cid || !mid) return { error: 'Channel and message ID required.' };
    await requireToken();
    await _discordRest.deleteMessage(cid, mid);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('discord-add-reaction', async (_event, channelId, messageId, emoji) => {
  try {
    const cid  = String(channelId || '').replace(/[^0-9]/g, '');
    const mid  = String(messageId || '').replace(/[^0-9]/g, '');
    const safe = sanitizeText(String(emoji || ''), 64);
    if (!cid || !mid || !safe) return { error: 'Channel, message ID, and emoji required.' };
    await requireToken();
    await _discordRest.addReaction(cid, mid, safe);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('discord-ack-message', async (_event, channelId, messageId) => {
  try {
    const cid = String(channelId || '').replace(/[^0-9]/g, '');
    const mid = String(messageId || '').replace(/[^0-9]/g, '');
    if (!cid || !mid) return { success: false };
    await requireToken();
    await _discordRest.ackMessage(cid, mid).catch(() => {});
    return { success: true };
  } catch {
    return { success: false };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// IPC HANDLERS — SERVERS (GUILDS)
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('discord-get-guilds', async () => {
  try {
    await requireToken();
    const raw = await _discordRest.getMyGuilds();
    return { guilds: sanitizeGuilds(raw) };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('discord-get-guild-channels', async (_event, guildId) => {
  try {
    const gid = String(guildId || '').replace(/[^0-9]/g, '');
    if (!gid) return { error: 'Invalid guild ID.' };

    // Prefer channels cached from the Gateway GUILD_CREATE event —
    // the REST endpoint is not accessible with OAuth2 Bearer tokens.
    if (_guildChannelCache.has(gid)) {
      return { channels: _guildChannelCache.get(gid) };
    }

    // Fall back to REST (may fail if the Gateway hasn't sent GUILD_CREATE yet).
    await requireToken();
    const raw = await _discordRest.getGuildChannels(gid);
    const channels = sanitizeChannels(raw);
    _guildChannelCache.set(gid, channels);
    return { channels };
  } catch (err) {
    return { error: err.message };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// IPC HANDLERS — NOTIFICATIONS / ACTIVITY FEED
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('discord-get-mentions', async () => {
  try {
    await requireToken();
    const raw = await _discordRest.getMyMentions(25);
    return { messages: sanitizeMessages(raw) };
  } catch (err) {
    return { error: err.message };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// IPC HANDLERS — RICH PRESENCE
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('discord-set-game-presence', async (_event, gameInfo) => {
  ensureDiscordInstances();
  try {
    const activity = buildGameActivity({
      gameName:       gameInfo?.gameName       ? sanitizeText(gameInfo.gameName, 64)    : null,
      platform:       gameInfo?.platform       ? sanitizeText(gameInfo.platform, 32)   : null,
      launchSource:   gameInfo?.launchSource   ? sanitizeText(gameInfo.launchSource, 32) : null,
      startTimestamp: typeof gameInfo?.startTimestamp === 'number' ? gameInfo.startTimestamp : undefined,
    });
    _discordPresence.setActivity(activity);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('discord-set-idle-presence', async () => {
  ensureDiscordInstances();
  _discordPresence.setActivity(buildIdleActivity());
  return { success: true };
});

ipcMain.handle('discord-clear-presence', async () => {
  ensureDiscordInstances();
  _discordPresence.clearActivity();
  return { success: true };
});

ipcMain.handle('discord-get-presence-status', async () => {
  ensureDiscordInstances();
  return {
    connected: _discordPresence.isConnected,
    presenceClientId: getDiscordSettings().discordPresenceClientId,
  };
});