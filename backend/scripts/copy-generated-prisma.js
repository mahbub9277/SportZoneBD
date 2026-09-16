import { copyFile, mkdir, readdir, stat, access } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '../src/generated/prisma');
const destDir = join(__dirname, '../dist/generated/prisma');

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function copyRecursive(src, dest) {
  const stats = await stat(src);
  if (stats.isDirectory()) {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src);
    await Promise.all(entries.map(async (entry) => {
      await copyRecursive(join(src, entry), join(dest, entry));
    }));
    return;
  }

  const ext = extname(src);
  const base = src.slice(0, -ext.length);
  const tsCandidate = `${base}.ts`;
  const dtsCandidate = `${base}.d.ts`;

  if (ext === '.js' && (await fileExists(tsCandidate))) {
    return;
  }
  if (ext === '.d.ts' && (await fileExists(`${base}.ts`))) {
    return;
  }

  await mkdir(dirname(dest), { recursive: true });
  // If copying package.json, ensure it doesn't force ESM module interpretation
  if (src.endsWith('package.json')) {
    try {
      const raw = await readFile(src, 'utf8');
      const pkg = JSON.parse(raw);
      // If package.json declares module type, prefer commonjs for runtime compatibility
      if (pkg.type === 'module') {
        pkg.type = 'commonjs';
      }
      await writeFile(dest, JSON.stringify(pkg, null, 2), 'utf8');
      return;
    } catch (err) {
      // fallback to direct copy on error
    }
  }
  await copyFile(src, dest);
}

copyRecursive(srcDir, destDir)
  .then(() => {
    console.log('Copied generated Prisma client assets to dist.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to copy generated Prisma client assets:', error);
    process.exit(1);
  });
