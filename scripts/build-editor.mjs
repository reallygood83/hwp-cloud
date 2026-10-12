// Builds the rhwp-studio editor into public/editor so it is served from /editor/.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const studioDir = resolve(
  process.env.RHWP_STUDIO_DIR ?? resolve(root, '../master-of-hwp-main/vendor/rhwp-main/rhwp-studio'),
);
if (!existsSync(resolve(studioDir, 'package.json'))) {
  console.error(`rhwp-studio not found: ${studioDir}\nSet RHWP_STUDIO_DIR to the rhwp-studio folder.`);
  process.exit(1);
}
const outDir = resolve(root, 'public/editor');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(npx, ['vite', 'build', '--base=/editor/', `--outDir=${outDir}`, '--emptyOutDir'], {
  cwd: studioDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
rmSync(resolve(outDir, 'samples'), { recursive: true, force: true });
console.log(`editor built -> ${outDir}`);
