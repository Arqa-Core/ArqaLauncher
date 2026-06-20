# ArqaLauncher Development Cheat Sheet

Quick reference for common development tasks.

## 🚀 Getting Started

```bash
git clone <repo>
cd ArqaLauncher
npm install
npm run validate       # Check setup
npm start              # Launch app
```

## 🧪 Testing & Debugging

| Task | Command |
|------|---------|
| Launch with debug output | `npm run debug` |
| Check setup status | `npm run validate` |
| Scan ROM folder | `npm run scan /path/to/roms` |
| View current settings | `npm run settings` |
| Reset settings to defaults | `npm run reset-settings` |

## 🏗️ Building

| Task | Command |
|------|---------|
| Package for current OS | `npm run package` |
| Build installers | `npm run build:make` |
| Build with helper | `npm run build` |

## 📝 Common Issues & Fixes

### Issue: "No games found" on first launch
```bash
npm run scan /path/to/games
# Check detected platforms match your ROMs
```

### Issue: Settings corrupted or app won't start
```bash
npm run reset-settings
npm run validate
npm start
```

### Issue: Emulator won't launch
```bash
npm run validate        # Check bazzite path
npm run debug           # See detailed error
npm run settings        # Verify configuration
```

### Issue: ROM detection not working
1. Check file extensions: `npm run scan /path`
2. Ensure files have valid game data (not just correct extension)
3. Check folder permissions: `npm run validate`

### Issue: Settings lost after crash
```bash
npm run settings        # See if settings still exist
npm run validate        # Check file system
# See BUGS_AND_FIXES.md for more info
```

## 📂 Project Structure

```
ArqaLauncher/
├── main.js                 # Electron main process
├── preload.js              # IPC security bridge
├── renderer/
│   ├── renderer.js         # React UI code
│   ├── index.html
│   ├── style.css
│   └── assets/
├── scripts/
│   ├── debug-launcher.js
│   ├── scan-roms.js
│   ├── validate-setup.js
│   ├── show-settings.js
│   ├── reset-settings.js
│   ├── build.js
│   └── BUGS_AND_FIXES.md
├── playstation-3-xmb-main/  # Theme assets
└── package.json
```

## 🔧 NPM Scripts Summary

```json
{
  "start": "npx electron-forge start",           // Run app
  "debug": "node scripts/debug-launcher.js",     // Debug mode
  "package": "npx electron-forge package",       // Package
  "make": "npx electron-forge make",             // Make installers
  "build": "node scripts/build.js",              // Build helper
  "build:make": "node scripts/build.js --make",  // Build with helper
  "scan": "node scripts/scan-roms.js",           // Scan ROMs
  "validate": "node scripts/validate-setup.js",  // Check setup
  "settings": "node scripts/show-settings.js",   // Show settings
  "reset-settings": "node scripts/reset-settings.js"  // Reset
}
```

## 🎮 Supported Platforms

| Platform | Extensions |
|----------|-----------|
| PS1 | `.bin`, `.cue`, `.img`, `.pbp`, `.chd` |
| PS2 | `.iso`, `.chd` |
| PSP | `.cso` |
| GameCube | `.rvz`, `.gcm` |
| Wii | `.wbfs` |
| SNES | `.sfc`, `.smc` |
| NES | `.nes` |
| N64 | `.n64`, `.z64`, `.v64` |
| Genesis | `.md`, `.gen` |
| GBA | `.gba` |
| GB | `.gb`, `.gbc` |
| Arcade | `.zip`, `.7z` |
| Dreamcast | `.cdi`, `.gdi` |
| Switch | `.nsp`, `.xci` |
| Generic | `.elf` |

## 📊 Settings File Format

**Location:** Platform-dependent, see [README.md](README.md#settings-location)

**Structure:**
```json
{
  "bazzitePath": "/path/to/bazzite",
  "libraryFolder": "/path/to/games",
  "useGamescope": true,
  "extraArgs": "--some-flag",
  "recentlyPlayed": [
    "/path/to/game1.iso",
    "/path/to/game2.iso"
  ]
}
```

## 🐛 Critical Bugs to Fix

See [BUGS_AND_FIXES.md](BUGS_AND_FIXES.md) for details:

1. **Windows executable check fails** - Needs platform detection
2. **Game process hangs forever** - Needs timeout mechanism  
3. **Settings validation missing** - Needs schema validation
4. **Poor error messages** - Needs better error handling
5. **Fullscreen multi-display issues** - Needs display detection

## 💡 Development Tips

### Testing ROM Scanning
```bash
# Create test ROMs folder structure
mkdir -p ~/test-roms/ps2 ~/test-roms/n64
touch ~/test-roms/ps2/game.iso
touch ~/test-roms/n64/game.z64

# Scan it
npm run scan ~/test-roms
```

### Debug Specific Features
```bash
npm run debug
# Then test in UI while watching console output
# Check browser DevTools with F12
```

### Testing Settings Persistence
```bash
npm run settings
npm start
# Change settings in UI
# Close app
npm run settings
# Verify changes persisted
```

## 🔗 Useful Links

- [Electron Forge Documentation](https://www.electronforge.io/)
- [Node.js Child Process](https://nodejs.org/api/child_process.html)
- [React Hooks](https://react.dev/reference/react)
- [Electron IPC](https://www.electronjs.org/docs/latest/api/ipc-main)

## 📚 Related Files to Review

- [BUGS_AND_FIXES.md](BUGS_AND_FIXES.md) - Known issues
- [README.md](README.md) - Detailed script docs
- [../main.js](../main.js) - Main process (IPC handlers)
- [../renderer/renderer.js](../renderer/renderer.js) - UI logic
