# ArqaLauncher - Known Issues & Fixes

## Bug Report & TODO List

### 🔴 Critical Issues

#### 1. Windows Compatibility - Executable Permission Check
**File:** [main.js](../main.js#L185)  
**Issue:** The code checks executable permissions with `fs.accessSync(selected, fs.constants.X_OK)`, which doesn't work on Windows. Windows doesn't have Unix-style execute permissions.

**Current Code:**
```javascript
try {
  fs.accessSync(selected, fs.constants.X_OK);
} catch {
  return { error: 'That file is not marked executable. Run "chmod +x" on it first.' };
}
```

**Fix:**
```javascript
try {
  if (process.platform !== 'win32') {
    fs.accessSync(selected, fs.constants.X_OK);
  }
} catch {
  return { error: 'That file is not marked executable. Run "chmod +x" on it first.' };
}
```

**Status:** Not fixed yet

---

#### 2. Game Process Lifecycle - No Timeout for Stuck Processes
**File:** [main.js](../main.js#L210)  
**Issue:** If a game process hangs and never exits, `gameProcess` will remain in memory, blocking future launches permanently.

**Problem:** User launches game → crashes/hangs → stuck in zombie state → can't launch another game without restarting app

**Suggested Fix:** Add 5-minute timeout to kill stuck processes:
```javascript
let processTimeout = setTimeout(() => {
  if (gameProcess) {
    console.warn('Game process exceeded 5-hour timeout, force-killing');
    gameProcess.kill('SIGKILL');
  }
}, 5 * 60 * 60 * 1000);

gameProcess.on('close', (code) => {
  clearTimeout(processTimeout);
  mainWindow?.webContents.send('bazzite-exit', code);
  gameProcess = null;
  // ... rest of handler
});
```

**Status:** Not fixed yet

---

#### 3. Settings Persistence - No Validation
**File:** [main.js](../main.js#L35)  
**Issue:** Settings are loaded with JSON.parse in a try-catch, but corrupted settings could cause the app to silently fail. No schema validation.

**Current Code:**
```javascript
function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultSettings(); // Silent fallback
  }
}
```

**Risk:** User's settings silently lost if JSON is invalid

**Suggested Fix:** Log the error and alert user:
```javascript
function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch (err) {
    console.warn('Failed to load settings, using defaults:', err.message);
    return defaultSettings();
  }
}
```

**Status:** Not fixed yet

---

### 🟡 Medium Priority Issues

#### 4. ROM Scanning - Missing Error Messages
**File:** [main.js](../main.js#L74)  
**Issue:** If folder reading fails, the error is generic. Doesn't tell user why the scan failed.

**Current Code:**
```javascript
try {
  entries = fs.readdirSync(folderPath, { withFileTypes: true });
} catch (err) {
  return { error: `Could not read folder: ${err.message}` };
}
```

**Improvement:** Add more specific error details:
```javascript
try {
  entries = fs.readdirSync(folderPath, { withFileTypes: true });
} catch (err) {
  const details = err.code === 'EACCES' 
    ? 'Permission denied' 
    : err.code === 'ENOENT' 
    ? 'Folder does not exist' 
    : err.message;
  return { error: `Could not read folder: ${details}` };
}
```

**Status:** Not fixed yet

---

#### 5. Gamescope Detection - No stderr Output
**File:** [main.js](../main.js#L229)  
**Issue:** Emulator stderr is sent to UI, but if the emulator fails to start, those messages might not reach the console before the process exits.

**Current Code:**
```javascript
gameProcess.stderr.on('data', (data) => {
  mainWindow?.webContents.send('bazzite-output', data.toString());
});
```

**Issue:** Buffer may not be flushed if process exits immediately. Consider:
```javascript
gameProcess.on('error', (error) => {
  mainWindow?.webContents.send('bazzite-output', `❌ Failed to start emulator: ${error.message}`);
  mainWindow?.webContents.send('bazzite-exit', -1);
  gameProcess = null;
});
```

**Status:** Partially addressed, could be improved

---

#### 6. Fullscreen Logic - XMB Startup
**File:** [main.js](../main.js#L125)  
**Issue:** Window starts fullscreen, but on multi-display systems, fullscreen behavior varies.

**Current Code:**
```javascript
mainWindow = new BrowserWindow({
  // ...
  fullscreen: true,
  // ...
});
```

**Suggestion:** Use `app.whenReady()` callback to set fullscreen after load:
```javascript
mainWindow.once('ready-to-show', () => {
  mainWindow.setFullScreen(true);
  mainWindow.show();
});
```

**Status:** Not fixed yet

---

### 🟢 Low Priority / Enhancements

#### 7. Add Logging to File
**File:** [main.js](../main.js)  
**Enhancement:** Create debug log file to persist output for crash analysis

**Suggested Implementation:**
```javascript
const LOG_FILE = path.join(app.getPath('userData'), 'arqa-debug.log');

function appendLog(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}
```

**Status:** Not implemented

---

#### 8. Add Resource Limits Validation
**File:** [main.js](../main.js)  
**Enhancement:** Check available disk space before launching emulator

**Suggested Check:**
```javascript
const diskSpace = require('diskusage'); // would need npm package
const freeSpace = diskSpace.check(path.dirname(romPath));
if (freeSpace.available < 100 * 1024 * 1024) {
  return { success: false, error: 'Less than 100MB free disk space. Emulator may fail.' };
}
```

**Status:** Not implemented

---

## Summary

| Category | Count | Severity |
|----------|-------|----------|
| Critical | 3 | High - blocks usage on Windows, breaks multi-game sessions |
| Medium | 3 | Medium - poor UX, missing error details |
| Low | 2 | Low - nice-to-have improvements |

## Recommended Fix Order

1. **Windows executable check** - blocks entire platform
2. **Game process timeout** - affects multi-game play
3. **Settings validation** - prevents silent data loss
4. **Error messages** - improves debugging
5. **Fullscreen logic** - multi-display support
6. **File logging** - post-crash analysis
