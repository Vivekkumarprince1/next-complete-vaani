const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public', 'sounds');
const files = fs.readdirSync(dir);

files.forEach(f => {
  const p = path.join(dir, f);
  const buf = fs.readFileSync(p, { encoding: 'utf8' });
  const head = buf.slice(0, 200);
  console.log('---', f, '---');
  console.log(head.replace(/\n/g, '\n'));
});
