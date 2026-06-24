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

  // Library manifest
  loadLibraryManifest: (folderPath) => ipcRenderer.invoke('load-library-manifest', folderPath),
  saveLibraryManifest: (folderPath, manifest) => ipcRenderer.invoke('save-library-manifest', folderPath, manifest),

  // ── Platform abstraction ──────────────────────────────────────────────────
  platformInfo:    ()          => ipcRenderer.invoke('platform-info'),

  // ── Steam integration ─────────────────────────────────────────────────────
  scanSteamLibrary:   (steamPathOverride) => ipcRenderer.invoke('scan-steam-library', steamPathOverride),

  // ── Multi-directory ROM scanning ──────────────────────────────────────────
  scanRomDirectories:  (dirs)    => ipcRenderer.invoke('scan-rom-directories', dirs),
  addRomDirectory:     ()        => ipcRenderer.invoke('add-rom-directory'),
  removeRomDirectory:  (dirPath) => ipcRenderer.invoke('remove-rom-directory', dirPath),

  // ── Application scanning ──────────────────────────────────────────────────
  scanAppDirectory:    (dirPath) => ipcRenderer.invoke('scan-app-directory', dirPath),
  addAppDirectory:     ()        => ipcRenderer.invoke('add-app-directory'),

  // ── Unified launcher ──────────────────────────────────────────────────────
  launchItem:          (payload) => ipcRenderer.invoke('launch-item', payload),

  // ── Emulator configuration ────────────────────────────────────────────────
  getEmulatorConfig:   ()        => ipcRenderer.invoke('get-emulator-config'),
  saveEmulatorConfig:  (map)     => ipcRenderer.invoke('save-emulator-config', map),

  // Process events (main -> renderer)
  onOutput: (callback) =>
    ipcRenderer.on('bazzite-output', (_event, data) => callback(data)),

  onExit: (callback) =>
    ipcRenderer.on('bazzite-exit', (_event, code) => callback(code)),

  // Audio events
  onAudioError: (callback) =>
    ipcRenderer.on('audio-error', (_event, error) => callback(error)),
  
  onAudioReady: (callback) =>
    ipcRenderer.on('audio-ready', (_event, data) => callback(data)),

  // ── Discord integration ───────────────────────────────────────────────────
  discord: {
    // Auth
    authStatus:        ()                              => ipcRenderer.invoke('discord-auth-status'),
    login:             ()                              => ipcRenderer.invoke('discord-login'),
    logout:            ()                              => ipcRenderer.invoke('discord-logout'),
    restoreSession:    ()                              => ipcRenderer.invoke('discord-restore-session'),
    saveCredentials:   (creds)                         => ipcRenderer.invoke('discord-save-credentials', creds),
    getAppConfig:      ()                              => ipcRenderer.invoke('discord-get-app-config'),
    saveWebToken:      (token)                         => ipcRenderer.invoke('discord-save-webtoken', token),
    loadWebToken:      ()                              => ipcRenderer.invoke('discord-load-webtoken'),

    // Friends
    getFriends:        ()                              => ipcRenderer.invoke('discord-get-friends'),

    // DMs
    getDMChannels:     ()                              => ipcRenderer.invoke('discord-get-dm-channels'),
    openDM:            (userId)                        => ipcRenderer.invoke('discord-open-dm', userId),
    getMessages:       (channelId, opts)               => ipcRenderer.invoke('discord-get-messages', channelId, opts),
    sendMessage:       (channelId, content, opts)      => ipcRenderer.invoke('discord-send-message', channelId, content, opts),
    editMessage:       (channelId, messageId, content) => ipcRenderer.invoke('discord-edit-message', channelId, messageId, content),
    deleteMessage:     (channelId, messageId)          => ipcRenderer.invoke('discord-delete-message', channelId, messageId),
    addReaction:       (channelId, messageId, emoji)   => ipcRenderer.invoke('discord-add-reaction', channelId, messageId, emoji),
    ackMessage:        (channelId, messageId)          => ipcRenderer.invoke('discord-ack-message', channelId, messageId),

    // Servers
    getGuilds:         ()                              => ipcRenderer.invoke('discord-get-guilds'),
    getGuildChannels:  (guildId)                       => ipcRenderer.invoke('discord-get-guild-channels', guildId),

    // Notifications / Activity
    getMentions:       ()                              => ipcRenderer.invoke('discord-get-mentions'),

    // Rich Presence
    setGamePresence:   (info)                          => ipcRenderer.invoke('discord-set-game-presence', info),
    setIdlePresence:   ()                              => ipcRenderer.invoke('discord-set-idle-presence'),
    clearPresence:     ()                              => ipcRenderer.invoke('discord-clear-presence'),
    getPresenceStatus: ()                              => ipcRenderer.invoke('discord-get-presence-status'),

    // Real-time events from Gateway (main → renderer)
    onReady:              (cb) => ipcRenderer.on('discord-ready',              (_, d) => cb(d)),
    onDisconnected:       (cb) => ipcRenderer.on('discord-disconnected',       ()     => cb()),
    onReconnected:        (cb) => ipcRenderer.on('discord-reconnected',        ()     => cb()),
    onError:              (cb) => ipcRenderer.on('discord-error',              (_, d) => cb(d)),
    onMessageCreate:      (cb) => ipcRenderer.on('discord-message-create',     (_, d) => cb(d)),
    onMessageUpdate:      (cb) => ipcRenderer.on('discord-message-update',     (_, d) => cb(d)),
    onMessageDelete:      (cb) => ipcRenderer.on('discord-message-delete',     (_, d) => cb(d)),
    onTypingStart:        (cb) => ipcRenderer.on('discord-typing-start',       (_, d) => cb(d)),
    onPresenceUpdate:     (cb) => ipcRenderer.on('discord-presence-update',    (_, d) => cb(d)),
    onChannelUpdate:      (cb) => ipcRenderer.on('discord-channel-update',     (_, d) => cb(d)),
    onChannelDelete:      (cb) => ipcRenderer.on('discord-channel-delete',     (_, d) => cb(d)),
    onReactionUpdate:     (cb) => ipcRenderer.on('discord-reaction-update',    (_, d) => cb(d)),
    onRelationshipAdd:    (cb) => ipcRenderer.on('discord-relationship-add',   (_, d) => cb(d)),
    onRelationshipRemove: (cb) => ipcRenderer.on('discord-relationship-remove',(_, d) => cb(d)),
    onGuildCreate:        (cb) => ipcRenderer.on('discord-guild-create',       (_, d) => cb(d)),
    onGuildUpdate:        (cb) => ipcRenderer.on('discord-guild-update',       (_, d) => cb(d)),
    onGuildDelete:        (cb) => ipcRenderer.on('discord-guild-delete',       (_, d) => cb(d)),
    onNotification:       (cb) => ipcRenderer.on('discord-notification',       (_, d) => cb(d)),
  },
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