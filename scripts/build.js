#!/usr/bin/env node
/**
 * Build helper that packages the app and optionally zips the packaged output.
 *
 * This avoids Forge's make/postPackage path, which has been flaky in this repo.
 * Usage:
 *   node scripts/build.js
 *   node scripts/build.js --make
 *   node scripts/build.js --platform linux --arch x64 --make
 */

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const archiver = require('archiver');

const projectRoot = path.join(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));
const forgeConfig = require(path.join(projectRoot, 'forge.config.js'));
const scriptPath = path.join(__dirname, 'build.js');

function readArg(flag, fallback = undefined) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function spawnCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
    process.on('SIGINT', () => child.kill('SIGINT'));
  });
}

async function rerunWithCompatibleNodeIfNeeded() {
  const major = Number(process.versions.node.split('.')[0] || 0);

  // electron-packager currently fails silently on Node 24+ in this project.
  if (major < 24 || process.env.ARQA_BUILD_NODE22_FALLBACK === '1' || hasFlag('--no-node-fallback')) {
    return;
  }

  const rerunArgs = process.argv.slice(2);
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['exec', '--yes', '--package=node@22', '--', 'node', scriptPath, ...rerunArgs];

  console.log('\nℹ Node 24+ detected. Re-running build with Node 22 for packaging compatibility...\n');

  const result = await spawnCommand(
    npmCommand,
    args,
    {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        ARQA_BUILD_NODE22_FALLBACK: '1',
      },
    }
  );

  if (typeof result.code === 'number') {
    process.exit(result.code);
  }

  throw new Error(`Node 22 fallback build exited via signal ${result.signal || 'unknown'}`);
}

function runForgePackage(platform, arch) {
  const forgeCli = require.resolve('@electron-forge/cli/dist/electron-forge.js');

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [forgeCli, 'package', '--platform', platform, '--arch', arch], {
      cwd: projectRoot,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`electron-forge package exited via signal ${signal}`));
        return;
      }

      reject(new Error(`electron-forge package exited with code ${code}`));
    });

    process.on('SIGINT', () => child.kill('SIGINT'));
  });
}

async function zipDirectory(sourceDir, destinationZip) {
  await fsp.mkdir(path.dirname(destinationZip), { recursive: true });

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destinationZip);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('warning', (warning) => {
      if (warning.code === 'ENOENT') {
        console.warn(warning.message);
        return;
      }

      reject(warning);
    });
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function main() {
  await rerunWithCompatibleNodeIfNeeded();

  const shouldMake = hasFlag('--make');
  const platform = readArg('--platform', process.platform === 'win32' ? 'win32' : 'linux');
  const arch = readArg('--arch', process.arch);
  const appName = packageJson.name || forgeConfig.packagerConfig?.name || 'arqa-launcher';
  const packageDir = path.join(projectRoot, 'out', `${appName}-${platform}-${arch}`);
  const zipPath = path.join(projectRoot, 'out', 'make', `${appName}-${platform}-${arch}.zip`);

  console.log(`\n🏗️  Packaging ArqaLauncher for ${platform}/${arch}...\n`);
  await runForgePackage(platform, arch);

  if (!fs.existsSync(packageDir)) {
    throw new Error(`Packaged app directory not found: ${packageDir}`);
  }

  if (!shouldMake) {
    console.log(`\n✓ Packaged app created at ${packageDir}`);
    return;
  }

  if (fs.existsSync(zipPath)) {
    await fsp.unlink(zipPath);
  }

  console.log(`\n📦 Creating release archive...\n`);
  await zipDirectory(packageDir, zipPath);

  console.log(`\n✓ Release archive created at ${zipPath}`);
}

main().catch((err) => {
  console.error('\n❌ Build failed:', err.message);
  process.exit(1);
});
