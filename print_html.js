const fs = require('fs');
const text = fs.readFileSync('product_dump.html', 'utf8');
const idx = text.indexOf('name="option[17970]"');
console.log(text.substring(idx - 200, idx + 800));
