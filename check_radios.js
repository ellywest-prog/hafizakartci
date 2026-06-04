const fs = require('fs');
const html = fs.readFileSync('product_dump.html', 'utf8');
const matches = html.match(/<input type="radio"[^>]*>/g);
console.log(matches);
