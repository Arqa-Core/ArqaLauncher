#!/usr/bin/env node
/**
 * Setup Validator - Check if ArqaLauncher is properly configured
 * Verifies dependencies, settings, and emulator availability
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const checks = {
  passed: [],
  warnings: [],
  errors: []
};

function check(name, condition, errorMsg = null) {
  if (condition) {
    checks.passed.push(name);
    console.log(`✓ ${name}`);
  } else {
    const message = errorMsg || name;
    checks.errors.push(message);
    console.log(`❌ ${message}`);
  }
}

function warn(name, condition, warnMsg = null) {
  if (!condition) {
    const message = warnMsg || name;
    checks.warnings.push(message);
    console.log(`⚠️  ${message}`);
  }
}

console.log('\n🔍 ArqaLauncher Setup Validation\n');

// Node and npm
console.log('📦 Environment:');
try {
  const nodeVer = process.version;
  check(`Node.js installed (${nodeVer})`);
} catch (e) {
  check('Node.js installed', false, 'Node.js not found');
}

try {
  const npmVer = execSync('npm -v', { encoding: 'utf-8' }).trim();
  check(`npm installed (v${npmVer})`);
} catch (e) {
  check('npm installed', false, 'npm not found');
}

// Dependencies
console.log('\n📚 Dependencies:');
const pkgPath = path.join(__dirname, '..', 'package.json');
check('package.json exists', fs.existsSync(pkgPath));

const nodeModules = path.join(__dirname, '..', 'node_modules');
check('node_modules installed', fs.existsSync(nodeModules), 'Run "npm install" first');

// Configuration
console.log('\n⚙️  Configuration:');
const settingsPath = path.join(
  process.env.APPDATA ||
  process.env.XDG_CONFIG_HOME ||
  path.join(os.homedir(), '.config'),
  'ArqaLauncher',
  'arqa-settings.json'
);

if (fs.existsSync(settingsPath)) {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    console.log(`✓ Settings file found`);
    
    warn(
      'Bazzite executable configured',
      settings.bazzitePath && fs.existsSync(settings.bazzitePath),
      'Bazzite executable not set or missing - run launcher and select it from Home'
    );

    warn(
      'Library folder configured',
      settings.libraryFolder && fs.existsSync(settings.libraryFolder),
      'Library folder not set or missing - select one from Library section'
    );
  } catch (e) {
    checks.errors.push(`Invalid settings file: ${e.message}`);
    console.log(`❌ Invalid settings file: ${e.message}`);
  }
} else {
  console.log(`ℹ️  No settings file yet (will be created on first launch)`);
}

// Platform-specific checks
console.log('\n🖥️  Platform:');
const platform = process.platform;
console.log(`Running on ${platform}`);

if (platform === 'linux') {
  warn(
    'Gamescope available',
    checkCommand('gamescope --version'),
    'Gamescope not found (optional but recommended)'
  );
}

function checkCommand(cmd) {
  try {
    execSync(`${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Summary
console.log('\n📋 Summary:');
console.log(`   ✓ Passed: ${checks.passed.length}`);
console.log(`   ⚠️  Warnings: ${checks.warnings.length}`);
console.log(`   ❌ Errors: ${checks.errors.length}`);

if (checks.errors.length > 0) {
  console.log('\n❌ Setup issues found. Please resolve the errors above.\n');
  process.exit(1);
} else if (checks.warnings.length > 0) {
  console.log('\n⚠️  Setup has warnings, but should work.\n');
  process.exit(0);
} else {
  console.log('\n✓ Setup looks good! You can run "npm start" to launch the app.\n');
  process.exit(0);
}
