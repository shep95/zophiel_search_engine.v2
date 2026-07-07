import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src', 'execution', 'in-page', 'extract-bundle.js');
const destDir = join(root, 'dist', 'execution', 'in-page');
const dest = join(destDir, 'extract-bundle.js');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log('Copied extract-bundle.js to dist');
