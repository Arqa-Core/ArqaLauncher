#!/usr/bin/env node
/**
 * Settings Reset - Clear stored settings and reset to defaults
 * Useful for testing fresh startup experience
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const settingsPath = path.join(
  process.env.APPDATA ||
  process.env.XDG_CONFIG_HOME ||
  path.join(os.homedir(), '.config'),
  'ArqaLauncher',
  'arqa-settings.json'
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log(`\n⚙️  Settings file: ${settingsPath}\n`);

rl.question('Are you sure you want to reset all settings? (yes/no): ', (answer) => {
  rl.close();

  if (answer.toLowerCase() !== 'yes') {
    console.log('✓ Cancelled.\n');
    process.exit(0);
  }

  try {
    if (fs.existsSync(settingsPath)) {
      fs.unlinkSync(settingsPath);
      console.log('✓ Settings file deleted.\n');
    } else {
      console.log('ℹ️  Settings file did not exist.\n');
    }

    const defaultSettings = {
      bazzitePath: null,
      libraryFolder: null,
      useGamescope: true,
      extraArgs: '',
      recentlyPlayed: []
    };

    const dir = path.dirname(settingsPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));

    console.log('✓ Default settings created.\n');
    console.log('Default settings:');
    console.log(JSON.stringify(defaultSettings, null, 2));
    console.log();
  } catch (err) {
    console.error(`❌ Error: ${err.message}\n`);
    process.exit(1);
  }
});
