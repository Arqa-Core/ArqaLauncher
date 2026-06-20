#!/usr/bin/env node
/**
 * ROM Scanner - Standalone tool to scan folders and validate ROM detection
 * Usage: node scripts/scan-roms.js /path/to/folder
 */

const fs = require('fs');
const path = require('path');

// Copy platform detection logic from main.js
const PLATFORM_EXTENSIONS = {
  ps1: ['.bin', '.cue', '.img', '.pbp', '.chd'],
  ps2: ['.iso', '.chd'],
  psp: ['.cso'],
  gamecube: ['.rvz', '.gcm'],
  wii: ['.wbfs'],
  snes: ['.sfc', '.smc'],
  nes: ['.nes'],
  n64: ['.n64', '.z64', '.v64'],
  genesis: ['.md', '.gen'],
  gba: ['.gba'],
  gb: ['.gb', '.gbc'],
  arcade: ['.zip', '.7z'],
  dreamcast: ['.cdi', '.gdi'],
  switch: ['.nsp', '.xci'],
  generic: ['.elf']
};

const KNOWN_EXTENSIONS = new Set([
  '.iso', '.bin', '.cue', '.pbp', '.elf',
  ...Object.values(PLATFORM_EXTENSIONS).flat()
]);

function detectPlatform(filename) {
  const ext = path.extname(filename).toLowerCase();
  for (const [platform, exts] of Object.entries(PLATFORM_EXTENSIONS)) {
    if (exts.includes(ext)) return platform;
  }
  if (ext === '.iso') return 'ps2';
  if (ext === '.elf') return 'generic';
  return 'unknown';
}

function scanFolder(folderPath) {
  if (!fs.existsSync(folderPath)) {
    console.error(`❌ Folder does not exist: ${folderPath}`);
    process.exit(1);
  }

  let entries;
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch (err) {
    console.error(`❌ Could not read folder: ${err.message}`);
    process.exit(1);
  }

  const roms = entries
    .filter((entry) => entry.isFile() && KNOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => ({
      name: entry.name,
      platform: detectPlatform(entry.name),
      size: fs.statSync(path.join(folderPath, entry.name)).size
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { folderPath, roms };
}

const targetFolder = process.argv[2] || process.cwd();

console.log(`\n📁 Scanning: ${targetFolder}\n`);

const result = scanFolder(targetFolder);

if (result.roms.length === 0) {
  console.log('⚠️  No compatible ROM files found.\n');
  console.log('Supported extensions:');
  Object.entries(PLATFORM_EXTENSIONS).forEach(([platform, exts]) => {
    console.log(`  ${platform.padEnd(10)} ${exts.join(', ')}`);
  });
  process.exit(0);
}

console.log(`✓ Found ${result.roms.length} ROM file(s):\n`);

const byPlatform = {};
result.roms.forEach((rom) => {
  if (!byPlatform[rom.platform]) byPlatform[rom.platform] = [];
  byPlatform[rom.platform].push(rom);
});

Object.entries(byPlatform).forEach(([platform, roms]) => {
  console.log(`\n🎮 ${platform.toUpperCase()} (${roms.length})`);
  roms.forEach((rom) => {
    const sizeMB = (rom.size / 1024 / 1024).toFixed(1);
    console.log(`   ${rom.name.padEnd(40)} ${sizeMB.padStart(6)} MB`);
  });
});

console.log(`\n✓ Total: ${result.roms.length} file(s)\n`);
