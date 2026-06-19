const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let gameProcess = null;

// ---------- Settings persistence ----------
// Remembers the emulator path, last library folder, gamescope preference,
// and recently played titles across restarts so the user isn't re-picking
// the same files every session.

const SETTINGS_FILE = path.join(app.getPath('userData'), 'arqa-settings.json');

function defaultSettings() {
  return {
    bazzitePath: null,
    libraryFolder: null,
    useGamescope: true,
    extraArgs: '',
    recentlyPlayed: []
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

// Keep the original extension set (.iso/.bin/.cue/.pbp/.elf) plus the wider
// set above, so anything that scanned before still scans now.
const KNOWN_EXTENSIONS = new Set([
  '.iso', '.bin', '.cue', '.pbp', '.elf',
  ...Object.values(PLATFORM_EXTENSIONS).flat()
]);

function detectPlatform(filename) {
  const ext = path.extname(filename).toLowerCase();
  for (const [platform, exts] of Object.entries(PLATFORM_EXTENSIONS)) {
    if (exts.includes(ext)) return platform;
  }
  if (ext === '.iso') return 'ps2'; // common default for a bare .iso
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

// Crude PATH lookup so we know whether gamescope is actually installed
// before relying on it. Arqa ships it by default; a derivative image might not.
function which(binary) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, binary);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
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
    backgroundColor: '#05080f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

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
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Bazzite Executable',
    properties: ['openFile'],
    filters: [{ name: 'All Files', extensions: ['*'] }]
  });

  if (result.canceled || !result.filePaths.length) return null;

  const selected = result.filePaths[0];
  try {
    fs.accessSync(selected, fs.constants.X_OK);
  } catch {
    return { error: 'That file is not marked executable. Run "chmod +x" on it first.' };
  }

  settings.bazzitePath = selected;
  persistSettings();
  return selected;
});

ipcMain.handle('select-rom-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Game Folder',
    properties: ['openDirectory']
  });

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

// Re-scan a previously chosen folder without opening a dialog, used to
// restore the library on launch and for the "Rescan Library" settings item.
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
  try {
    fs.accessSync(executablePath, fs.constants.X_OK);
  } catch {
    return { success: false, error: 'Emulator executable is not marked executable (chmod +x).' };
  }

  const wantsGamescope = useGamescope !== false;
  const gamescopeBin = wantsGamescope ? which('gamescope') : null;
  const globalArgs = (settings.extraArgs || '').split(' ').filter(Boolean);

  let command;
  let args;
  if (gamescopeBin) {
    // -f: fullscreen. "--" hands the remaining args straight to the wrapped process.
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

  gameProcess.stdout.on('data', (data) => {
    mainWindow?.webContents.send('bazzite-output', data.toString());
  });

  gameProcess.stderr.on('data', (data) => {
    mainWindow?.webContents.send('bazzite-output', data.toString());
  });

  gameProcess.on('error', (error) => {
    mainWindow?.webContents.send('bazzite-output', `Process error: ${error.message}`);
    mainWindow?.webContents.send('bazzite-exit', -1);
    gameProcess = null;
  });

  gameProcess.on('close', (code) => {
    mainWindow?.webContents.send('bazzite-exit', code);
    gameProcess = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFullScreen(true);
      mainWindow.focus();
    }
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

// ---------- Window chrome controls (unchanged) ----------

ipcMain.handle('close-window', () => {
  if (mainWindow) {
    // Disable programmatic close; only Alt+F4 should terminate the app.
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