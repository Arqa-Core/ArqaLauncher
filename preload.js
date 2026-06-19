const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bazziteAPI', {
  selectBazziteExecutable: () => ipcRenderer.invoke('select-bazzite-executable'),
  selectRomFolder: () => ipcRenderer.invoke('select-rom-folder'),
  launchBazzite: (payload) => ipcRenderer.invoke('launch-bazzite', payload),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('toggle-maximize-window'),
  onOutput: (callback) => ipcRenderer.on('bazzite-output', (_event, data) => callback(data)),
  onExit: (callback) => ipcRenderer.on('bazzite-exit', (_event, code) => callback(code))
});
