const fs = require('fs');
const html = fs.readFileSync('product_dump.html', 'utf8');
const optionsSection = html.match(/id="product"[\s\S]*?name="quantity"/);
if (optionsSection) {
  const sectionHtml = optionsSection[0];
  const groups = sectionHtml.split(/class="form-group[^"]*"/);
  
  for (let i = 1; i < groups.length; i++) {
    const groupHtml = groups[i];
    const labelMatch = groupHtml.match(/<label[^>]*>([^<]+)<\/label>/);
    if (!labelMatch) continue;
    
    console.log("Group:", labelMatch[1].trim());
    
    const radios = [...groupHtml.matchAll(/name="option\[(\d+)\]"\s*value="(\d+)"([^>]*)(?:>|[\s\S]*?<\/label>)/g)];
    for (const radio of radios) {
      console.log("  Radio:", radio[2]);
    }
  }
}
