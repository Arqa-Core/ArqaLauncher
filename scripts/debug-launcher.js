#!/usr/bin/env node
/**
 * Debug Launcher - Starts ArqaLauncher with verbose console logging
 * Useful for troubleshooting IPC issues, settings problems, and ROM scanning
 */

const { spawn } = require('child_process');
const path = require('path');

const isWin = process.platform === 'win32';
const electronCmd = isWin ? 'npx.cmd' : 'npx';

console.log('🎮 Starting ArqaLauncher in DEBUG mode...');
console.log('   Monitor the output below for IPC messages and errors\n');

const proc = spawn(electronCmd, ['electron-forge', 'start'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  shell: isWin
});

proc.on('error', (err) => {
  console.error('❌ Failed to start launcher:', err.message);
  process.exit(1);
});

proc.on('exit', (code) => {
  console.log(`\n✓ Launcher exited with code ${code}`);
  process.exit(code);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n✓ Stopping launcher...');
  proc.kill('SIGINT');
});
