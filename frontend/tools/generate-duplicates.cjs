const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', 'src');
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'public'].includes(e.name)) continue;
      walk(p);
    } else {
      files.push(path.relative(root, p).replace(/\\\\/g, '/'));
    }
  }
}
walk(root);
const groups = {};
files.forEach(f => {
  const base = path.basename(f, path.extname(f));
  const dir = path.dirname(f);
  const key = dir === '.' ? base : dir + '/' + base;
  (groups[key] || (groups[key] = [])).push(f);
});
const removes = [];
Object.values(groups).forEach(v => {
  const hasTS = v.some(x => x.endsWith('.ts') || x.endsWith('.tsx'));
  if (!hasTS) return;
  v.forEach(x => { if (x.endsWith('.js') || x.endsWith('.d.ts')) removes.push(x); });
});
removes.sort();
fs.writeFileSync(path.resolve(__dirname, '..', 'duplicate_files_for_review.txt'), removes.join('\n'));
console.log('WROTE', removes.length, 'to frontend/duplicate_files_for_review.txt');
