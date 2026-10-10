import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hash = createHash('sha256');
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  )) {
    if (entry.name === '.DS_Store') continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else {
      hash.update(relative(root, file));
      hash.update('\0');
      hash.update(readFileSync(file));
      hash.update('\0');
    }
  }
}
for (const dir of ['src', 'public', 'scripts']) walk(join(root, dir));
for (const file of [
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
]) {
  hash.update(file);
  hash.update('\0');
  hash.update(readFileSync(join(root, file)));
  hash.update('\0');
}
const digest = hash.digest('hex');
if (process.argv.includes('--write'))
  writeFileSync(join(root, 'dist', '.source-sha256'), digest + '\n');
else console.log(digest);
