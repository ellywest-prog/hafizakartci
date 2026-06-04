const fs = require('fs');
const html = fs.readFileSync('product_dump.html', 'utf8');

// Find the product options wrapper
const optionsSection = html.match(/id="product"[\s\S]*?name="quantity"/);
if (optionsSection) {
  console.log("Found product section");
  const sectionHtml = optionsSection[0];
  
  // Find all option groups
  const groups = [...sectionHtml.matchAll(/class="form-group[^"]*"[^>]*>([\s\S]*?)<\/div>/g)];
  for (const group of groups) {
    const groupHtml = group[1];
    const labelMatch = groupHtml.match(/<label[^>]*>([^<]+)<\/label>/);
    if (!labelMatch) continue;
    
    const label = labelMatch[1].trim();
    console.log("Option Group:", label);
    
    // Select dropdowns
    const selectMatch = groupHtml.match(/name="option\[(\d+)\]"[\s\S]*?<select([\s\S]*?)<\/select>/);
    if (selectMatch) {
      console.log("  Type: Select");
      const optionId = selectMatch[1];
      const optionsStr = selectMatch[2];
      const options = [...optionsStr.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/g)];
      for (const opt of options) {
        console.log(`    Value: ${opt[1]} -> ${opt[2].trim()}`);
      }
    }
    
    // Radios
    const radios = [...groupHtml.matchAll(/name="option\[(\d+)\]"\s*value="(\d+)"[\s\S]*?<\/label>/g)];
    if (radios.length > 0) {
      console.log("  Type: Radio");
      for (const radio of radios) {
        const optionId = radio[1];
        const valueId = radio[2];
        const textMatch = radio[0].match(/>\s*([^<]+)\s*$/);
        const text = textMatch ? textMatch[1].trim() : "Unknown";
        console.log(`    Value: ${valueId} -> ${text}`);
      }
    }
  }
} else {
  console.log("No product section found");
}
