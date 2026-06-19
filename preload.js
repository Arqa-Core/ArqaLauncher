const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arqaAPI', {
  // Executable / library
  selectBazziteExecutable: () => ipcRenderer.invoke('select-bazzite-executable'),
  selectRomFolder: () => ipcRenderer.invoke('select-rom-folder'),
  rescanLibrary: (folderPath) => ipcRenderer.invoke('rescan-rom-folder', folderPath),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial),

  // Launching
  launchBazzite: (payload) => ipcRenderer.invoke('launch-bazzite', payload),
  stopGame: () => ipcRenderer.invoke('stop-bazzite'),

  // Window control
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('toggle-maximize-window'),

  // Fullscreen
  enterFullscreen: () => ipcRenderer.invoke('enter-fullscreen'),
  exitFullscreen: () => ipcRenderer.invoke('exit-fullscreen'),

  // System power
  systemPower: (action) => ipcRenderer.invoke('system-power', action),

  // Process events (main -> renderer)
  onOutput: (callback) =>
    ipcRenderer.on('bazzite-output', (_event, data) => callback(data)),

  onExit: (callback) =>
    ipcRenderer.on('bazzite-exit', (_event, code) => callback(code))
});