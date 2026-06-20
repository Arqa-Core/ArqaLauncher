#!/usr/bin/env node
/**
 * Build Helper - Build the app with better error reporting
 * Usage: node scripts/build.js [--package|--make]
 */

const { spawn } = require('child_process');
const path = require('path');

const isWin = process.platform === 'win32';
const electronCmd = isWin ? 'npx.cmd' : 'npx';
const command = process.argv[2] === '--make' ? 'make' : 'package';

console.log(`\n🏗️  Building ArqaLauncher (${command} mode)...\n`);

const proc = spawn(electronCmd, ['electron-forge', command], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  shell: isWin
});

proc.on('error', (err) => {
  console.error('\n❌ Build failed:', err.message);
  console.error('\nTroubleshooting:');
  console.error('  1. Run "npm install" to ensure dependencies are installed');
  console.error('  2. Check that you have write permissions to the output directory');
  console.error('  3. On Windows, ensure you have Visual C++ build tools installed');
  process.exit(1);
});

proc.on('exit', (code) => {
  if (code === 0) {
    console.log(`\n✓ Build completed successfully!`);
    console.log(`\nOutput location depends on your system:`);
    console.log(`  - Windows: out/make/`);
    console.log(`  - Linux: out/make/`);
    console.log(`  - macOS: out/make/`);
  } else {
    console.error(`\n❌ Build failed with exit code ${code}`);
  }
  process.exit(code);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n✓ Build cancelled...');
  proc.kill('SIGINT');
});
