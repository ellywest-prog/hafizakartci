const { BrowserAgent } = require('./agent/browser.js');
const { CartManager } = require('./agent/cart.js');
require('dotenv').config();

async function research() {
  const browser = new BrowserAgent();
  
  if (!browser.isLoggedIn()) {
    console.log("Logging in...");
    await browser.login(process.env.HAFIZAKARTCI_EMAIL, process.env.HAFIZAKARTCI_PASSWORD);
  }
  
  const body = `product_id=685978&quantity=1`;
  const response = await browser.request(
    'https://www.hafizakartci.com/index.php?route=checkout/cart/add',
    {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json'
      }
    }
  );
  
  console.log("Status:", response.statusCode);
  console.log("Body:", response.body);
}

research();
