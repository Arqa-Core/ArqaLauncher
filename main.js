const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 1100,
    minHeight: 640,
    title: 'Arqa Launcher',
    frame: false,
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

ipcMain.handle('select-bazzite-executable', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Bazzite Executable',
    properties: ['openFile'],
    filters: [
      { name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'sh'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-rom-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Game Folder',
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const roms = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(iso|bin|cue|pbp|elf)$/i.test(name))
    .sort();

  return {
    folderPath,
    roms
  };
});

ipcMain.handle('launch-bazzite', async (_event, { executablePath, romPath, extraArgs = [] }) => {
  if (!executablePath || !romPath) {
    return { success: false, error: 'Bazzite path and ROM path are required.' };
  }

  try {
    const args = [romPath, ...extraArgs];
    const process = spawn(executablePath, args, {
      windowsHide: true,
      cwd: path.dirname(executablePath)
    });

    process.stdout.on('data', (data) => {
      mainWindow.webContents.send('bazzite-output', data.toString());
    });

    process.stderr.on('data', (data) => {
      mainWindow.webContents.send('bazzite-output', data.toString());
    });

    process.on('close', (code) => {
      mainWindow.webContents.send('bazzite-exit', code);
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('close-window', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
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
