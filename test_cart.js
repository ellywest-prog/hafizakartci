const { BrowserAgent } = require('./agent/browser.js');
const { CartManager } = require('./agent/cart.js');
require('dotenv').config();

async function test() {
  const browser = new BrowserAgent();
  
  if (!browser.isLoggedIn()) {
    console.log("Logging in...");
    await browser.login(process.env.HAFIZAKARTCI_EMAIL, process.env.HAFIZAKARTCI_PASSWORD);
  }
  
  const response = await browser.request('https://www.hafizakartci.com/index.php?route=checkout/cart');
  const fs = require('fs');
  fs.writeFileSync('cart_dump.html', response.body);
  console.log("Cart HTML dumped to cart_dump.html");
  
  const cart = new CartManager(browser);
  const result = cart.parseCartPage(response.body);
  console.log("Parsed result:", JSON.stringify(result, null, 2));
}

test();
