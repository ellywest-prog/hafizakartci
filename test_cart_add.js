const { BrowserAgent } = require('./agent/browser.js');
const { CartManager } = require('./agent/cart.js');
require('dotenv').config();

async function test() {
  const browser = new BrowserAgent();
  
  if (!browser.isLoggedIn()) {
    console.log("Logging in...");
    await browser.login(process.env.HAFIZAKARTCI_EMAIL, process.env.HAFIZAKARTCI_PASSWORD);
  }
  
  const cart = new CartManager(browser);
  const addRes = await cart.addToCart('21006', 1);
  console.log("Add response:", addRes);

  const body = `product_id=21006&quantity=1`;
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
  
  console.log("Raw Response Body:", response.body);
}

test();
