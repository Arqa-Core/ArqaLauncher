# ArqaLauncher Helper Scripts

Utility scripts for debugging, development, and maintenance of ArqaLauncher.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm start` | Launch the app normally |
| `npm run debug` | Launch with console logging for troubleshooting |
| `npm run build` | Build the app (package mode) |
| `npm run build:make` | Build installers for distribution |
| `npm run scan <path>` | Scan a folder for ROM files (auto-detects platform) |
| `npm run validate` | Check if setup is correct and all dependencies are ready |
| `npm run settings` | Display current settings without launching the app |
| `npm run reset-settings` | Reset settings to defaults |

## Detailed Usage

### debug-launcher.js
**Purpose:** Start ArqaLauncher with verbose output for troubleshooting

**Usage:**
```bash
npm run debug
```

**Useful for:**
- Debugging IPC communication issues
- Seeing detailed error messages
- Testing gamepad input handling
- Monitoring emulator process spawning

---

### scan-roms.js
**Purpose:** Scan a directory for ROM files and detect their platform

**Usage:**
```bash
npm run scan /path/to/roms
npm run scan  # Scans current directory if path omitted
```

**Supported Platforms:**
- PlayStation (PS1): `.bin`, `.cue`, `.img`, `.pbp`, `.chd`
- PlayStation 2 (PS2): `.iso`, `.chd`
- PSP: `.cso`
- GameCube: `.rvz`, `.gcm`
- Wii: `.wbfs`
- SNES: `.sfc`, `.smc`
- NES: `.nes`
- Nintendo 64: `.n64`, `.z64`, `.v64`
- Genesis: `.md`, `.gen`
- Game Boy Advance: `.gba`
- Game Boy: `.gb`, `.gbc`
- Arcade: `.zip`, `.7z`
- Dreamcast: `.cdi`, `.gdi`
- Nintendo Switch: `.nsp`, `.xci`
- Generic: `.elf`

**Output:** Lists all detected ROMs with file size and detected platform

---

### validate-setup.js
**Purpose:** Check if ArqaLauncher is properly configured

**Usage:**
```bash
npm run validate
```

**Checks:**
- Node.js and npm version
- Dependencies installed
- Settings file and configuration
- Bazzite executable availability
- Library folder configuration
- Platform-specific tools (e.g., Gamescope on Linux)

**Exit codes:**
- `0` - Setup OK
- `1` - Critical errors found

---

### show-settings.js
**Purpose:** Display current settings without launching the app

**Usage:**
```bash
npm run settings
```

**Output:** Shows:
- Bazzite executable path
- Library folder path
- Gamescope preference
- Extra arguments
- Recently played games list

---

### reset-settings.js
**Purpose:** Clear all settings and reset to defaults

**Usage:**
```bash
npm run reset-settings
```

**Warning:** This will delete your configuration and recently played history. Use for:
- Testing fresh startup experience
- Resolving configuration corruption
- Starting over with setup wizard

---

## Directory Structure

```
scripts/
├── debug-launcher.js       # Run with verbose logging
├── scan-roms.js            # ROM folder scanner
├── validate-setup.js       # Setup checker
├── show-settings.js        # Display settings
├── reset-settings.js       # Reset to defaults
├── build.js                # Build helper with error reporting
├── README.md               # This file
└── BUGS_AND_FIXES.md       # Known issues and recommended fixes
```

## Known Issues & Bug Fixes

See [BUGS_AND_FIXES.md](BUGS_AND_FIXES.md) for a detailed analysis of:
- **3 Critical Issues:** Windows compatibility, game process lifecycle, settings validation
- **3 Medium Priority Issues:** Error messages, ROM scanning, fullscreen handling
- **2 Low Priority Improvements:** File logging, resource limits

Each issue includes:
- Problem description and impact
- Current code
- Suggested fix with code examples
- Priority level and recommended fix order

---

## Settings Location

Settings are stored in:
- **Windows:** `%APPDATA%\ArqaLauncher\arqa-settings.json`
- **Linux:** `~/.config/ArqaLauncher/arqa-settings.json`
- **macOS:** `~/Library/Application Support/ArqaLauncher/arqa-settings.json`

Default settings format:
```json
{
  "bazzitePath": null,
  "libraryFolder": null,
  "useGamescope": true,
  "extraArgs": "",
  "recentlyPlayed": []
}
```

## Development Tips

1. **First time setup:**
   ```bash
   npm install
   npm run validate
   npm start
   ```

2. **Debugging a ROM scanning issue:**
   ```bash
   npm run scan /path/to/roms
   # Then compare with what the launcher finds
   ```

3. **Resetting for testing:**
   ```bash
   npm run reset-settings
   npm run debug
   # Go through setup wizard again
   ```

4. **Checking configuration after crashing:**
   ```bash
   npm run settings
   npm run validate
   ```
