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

  // Audio support - expose audio context and utilities
  audio: {
    // Preload audio buffers (optional, for more advanced audio handling)
    preloadAudio: (audioPaths) => ipcRenderer.invoke('preload-audio', audioPaths),
    
    // Get audio file status
    getAudioStatus: (audioPath) => ipcRenderer.invoke('get-audio-status', audioPath)
  },

  // Process events (main -> renderer)
  onOutput: (callback) =>
    ipcRenderer.on('bazzite-output', (_event, data) => callback(data)),

  onExit: (callback) =>
    ipcRenderer.on('bazzite-exit', (_event, code) => callback(code)),

  // Audio events
  onAudioError: (callback) =>
    ipcRenderer.on('audio-error', (_event, error) => callback(error)),
  
  onAudioReady: (callback) =>
    ipcRenderer.on('audio-ready', (_event, data) => callback(data))
});

// Audio context initialization helper
window.addEventListener('DOMContentLoaded', () => {
  // Initialize Web Audio API context for potential advanced audio features
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      // Create a singleton audio context that can be used by the renderer
      window.__arqaAudioContext = new AudioContext();
      
      // Resume audio context on first user interaction (required by some browsers)
      const resumeAudio = async () => {
        if (window.__arqaAudioContext && window.__arqaAudioContext.state === 'suspended') {
          await window.__arqaAudioContext.resume();
        }
      };
      
      // Listen for the first interaction to resume audio context
      document.addEventListener('keydown', resumeAudio, { once: true });
      document.addEventListener('click', resumeAudio, { once: true });
      
      console.log('Audio context initialized for Arqa sound system');
    }
  } catch (err) {
    console.warn('Web Audio API not available:', err.message);
  }
  
  // Verify audio files are accessible
  const requiredAudioFiles = [
    './assets/nav1.wav',
    './assets/nav2.wav',
    './assets/select.wav', 
    './assets/invalid.wav',
    './assets/menumusic1.mp3'
  ];
  
  // Pre-check audio availability (non-blocking)
  requiredAudioFiles.forEach(audioPath => {
    fetch(audioPath, { method: 'HEAD' })
      .then(response => {
        if (!response.ok) {
          console.warn(`Audio file not accessible: ${audioPath}`);
        }
      })
      .catch(() => {
        console.warn(`Cannot access audio file: ${audioPath}`);
      });
  });
});