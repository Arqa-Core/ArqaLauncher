#!/usr/bin/env node
/**
 * Show Settings - Display current settings without launching the app
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const settingsPath = path.join(
  process.env.APPDATA ||
  process.env.XDG_CONFIG_HOME ||
  path.join(os.homedir(), '.config'),
  'ArqaLauncher',
  'arqa-settings.json'
);

console.log(`\n📂 Settings file: ${settingsPath}\n`);

if (!fs.existsSync(settingsPath)) {
  console.log('ℹ️  No settings file found (will be created on first launch)\n');
  console.log('Default settings would be:');
  console.log(JSON.stringify({
    bazzitePath: null,
    libraryFolder: null,
    useGamescope: true,
    extraArgs: '',
    recentlyPlayed: []
  }, null, 2));
  console.log();
  process.exit(0);
}

try {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  
  console.log('📝 Current Settings:\n');
  console.log(`  Bazzite Path: ${settings.bazzitePath || '(not set)'}`);
  console.log(`  Library Folder: ${settings.libraryFolder || '(not set)'}`);
  console.log(`  Use Gamescope: ${settings.useGamescope}`);
  console.log(`  Extra Args: ${settings.extraArgs || '(none)'}`);
  
  if (settings.recentlyPlayed && settings.recentlyPlayed.length > 0) {
    console.log(`  Recently Played (${settings.recentlyPlayed.length}):`);
    settings.recentlyPlayed.forEach((rom, i) => {
      console.log(`    ${i + 1}. ${path.basename(rom)}`);
    });
  } else {
    console.log('  Recently Played: (none)');
  }

  console.log('\nFull settings object:\n');
  console.log(JSON.stringify(settings, null, 2));
  console.log();
} catch (err) {
  console.error(`❌ Error reading settings: ${err.message}\n`);
  process.exit(1);
}
