#!/usr/bin/env node
/**
 * clear-cache  —  wipe all locally-cached data for ArqaLauncher
 *
 * Removes:
 *   • arqa-settings.json        (app settings / library config)
 *   • Electron userData dir     (GPU cache, network cache, webview partitions
 *                                including persist:discord session/cookies)
 *   • .discord-auth             (locally-cached Discord web token)
 *
 * Run via:  npm run clear-cache
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Resolve platform paths ──────────────────────────────────────────────────
const APP_NAME = 'arqa-launcher';   // matches forge.config.js packagerConfig.name

const appData =
  process.env.APPDATA                                     // Windows  → %APPDATA%
  || process.env.XDG_CONFIG_HOME                          // Linux XDG
  || (process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : path.join(os.homedir(), '.config'));             // Linux fallback

const TARGETS = [
  {
    label:  'Settings file',
    path:   path.join(appData, 'ArqaLauncher', 'arqa-settings.json'),
    type:   'file',
  },
  {
    label:  'Electron userData (cache + Discord session)',
    path:   path.join(appData, APP_NAME),
    type:   'dir',
  },
  {
    label:  'Discord web token cache',
    path:   path.join(__dirname, '..', '.discord-auth'),
    type:   'file',
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function rmrf(target) {
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

function printTarget(t) {
  const exists = fs.existsSync(t.path);
  const tag    = exists ? '' : ' (not found)';
  console.log(`  ${t.label}${tag}`);
  console.log(`    ${t.path}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log('\n🗑️  ArqaLauncher — Clear Cache\n');
console.log('The following will be permanently deleted:\n');
TARGETS.forEach(printTarget);

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('\nProceed? (yes/no): ', answer => {
  rl.close();

  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('\n✓ Cancelled — nothing was changed.\n');
    process.exit(0);
  }

  console.log();
  let anyError = false;

  for (const t of TARGETS) {
    try {
      const removed = rmrf(t.path);
      console.log(removed ? `✓ Removed: ${t.label}` : `– Skipped: ${t.label} (not found)`);
    } catch (err) {
      console.error(`❌ Failed to remove ${t.label}: ${err.message}`);
      anyError = true;
    }
  }

  console.log();
  if (anyError) {
    console.log('⚠️  Some items could not be removed (see errors above).');
  } else {
    console.log('✓ Done. All cached data cleared.');
    console.log('  The app will start fresh on next launch.\n');
  }

  process.exit(anyError ? 1 : 0);
});
