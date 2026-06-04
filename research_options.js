const { BrowserAgent } = require('./agent/browser.js');
const { Searcher } = require('./agent/searcher.js');
require('dotenv').config();

async function research() {
  const browser = new BrowserAgent();
  
  if (!browser.isLoggedIn()) {
    console.log("Logging in...");
    await browser.login(process.env.HAFIZAKARTCI_EMAIL, process.env.HAFIZAKARTCI_PASSWORD);
  }
  
  const searcher = new Searcher(browser);
  // Get product 21006 details
  const response = await browser.request('https://www.hafizakartci.com/index.php?route=product/product&product_id=21006');
  
  const fs = require('fs');
  fs.writeFileSync('product_dump.html', response.body);
  console.log("Product HTML dumped to product_dump.html");
  
  const product = searcher.parseProductDetail(response.body);
  console.log("Parsed Product:", JSON.stringify(product, null, 2));
}

research();
