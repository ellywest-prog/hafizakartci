/**
 * Hafıza Kartçı Ajan Sistemi - Ana Sunucu
 * Express.js tabanlı API sunucusu
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

const {
  isVercel,
  initStorage,
  getSettings: storageGetSettings,
  saveSettings: storageSaveSettings
} = require('./agent/storage');

const { BrowserAgent } = require('./agent/browser');
const { Searcher } = require('./agent/searcher');
const { CartManager } = require('./agent/cart');
const { OrderManager } = require('./agent/order');
const { TelegramBot } = require('./agent/telegram');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Agent instances
const browser = new BrowserAgent();
const searcher = new Searcher(browser);
const cart = new CartManager(browser);
const order = new OrderManager(browser, cart);
const telegram = new TelegramBot();

function getSettings() {
  return storageGetSettings();
}

function saveSettings(settings) {
  return storageSaveSettings(settings);
}

// ==================== API ROUTES ====================

// Durum kontrolü
app.get('/api/status', async (req, res) => {
  try {
    const loggedIn = browser.isLoggedIn();
    const settings = getSettings();
    const cartTotal = cart.getLocalCartTotal();
    const cartItems = cart.getLocalCart();

    res.json({
      success: true,
      loggedIn,
      settings,
      cartTotal,
      cartItemCount: cartItems.length,
      targetReached: cartTotal >= settings.targetCartAmount
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Giriş yap
app.post('/api/login', async (req, res) => {
  try {
    const email = req.body.email || process.env.HAFIZAKARTCI_EMAIL;
    const password = req.body.password || process.env.HAFIZAKARTCI_PASSWORD;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'E-posta ve şifre gerekli' });
    }

    const result = await browser.login(email, password);
    telegram.notifyLoginStatus(true, email).catch(() => {});
    res.json({ success: true, message: 'Giriş başarılı', ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Giriş başarısız: ' + err.message });
  }
});

// Çıkış yap
app.post('/api/logout', async (req, res) => {
  try {
    await browser.logout();
    res.json({ success: true, message: 'Çıkış yapıldı' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Ürün ara
app.post('/api/search', async (req, res) => {
  try {
    const { query, page, sort, order: sortOrder, limit } = req.body;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Arama terimi gerekli' });
    }

    if (!browser.isLoggedIn()) {
      // Otomatik giriş dene
      const email = process.env.HAFIZAKARTCI_EMAIL;
      const password = process.env.HAFIZAKARTCI_PASSWORD;
      if (email && password) {
        await browser.login(email, password);
      } else {
        return res.status(401).json({ success: false, error: 'Önce giriş yapmalısınız' });
      }
    }

    const results = await searcher.search(query, { page, sort, order: sortOrder, limit });
    res.json({ success: true, ...results });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Arama hatası: ' + err.message });
  }
});

// Sepete ekle
app.post('/api/cart/add', async (req, res) => {
  try {
    const { productId, quantity, productName, productPrice, productImage } = req.body;

    if (!productId) {
      return res.status(400).json({ success: false, error: 'Ürün ID gerekli' });
    }

    if (!browser.isLoggedIn()) {
      return res.status(401).json({ success: false, error: 'Önce giriş yapmalısınız' });
    }

    const result = await cart.addToCart(productId, quantity || 1);

    // Lokal sepete de ekle
    if (result.success) {
      cart.addToLocalCart({
        productId,
        name: productName || 'Ürün #' + productId,
        price: productPrice || 0,
        image: productImage || '',
        quantity: quantity || 1
      });

      const settings = getSettings();
      const cartTotal = cart.getLocalCartTotal();
      const targetReached = cartTotal >= settings.targetCartAmount;

      // Telegram bildirimi
      telegram.notifyCartAdd(
        productName || 'Ürün #' + productId,
        productPrice || 0,
        cartTotal,
        settings.targetCartAmount
      ).catch(() => {});

      // Hedef tutara ulaşıldıysa özel bildirim
      if (targetReached) {
        telegram.notifyTargetReached(
          cartTotal,
          settings.targetCartAmount,
          cart.getLocalCart().length
        ).catch(() => {});
      }

      res.json({
        success: true,
        message: result.message,
        cartTotal,
        targetReached,
        targetAmount: settings.targetCartAmount
      });
    } else {
      res.json(result);
    }
  } catch (err) {
    res.status(500).json({ success: false, error: 'Sepete ekleme hatası: ' + err.message });
  }
});

// Sepet içeriğini getir
app.get('/api/cart', async (req, res) => {
  try {
    const localCart = cart.getLocalCart();
    const cartTotal = cart.getLocalCartTotal();
    const settings = getSettings();

    res.json({
      success: true,
      items: localCart,
      total: cartTotal,
      targetAmount: settings.targetCartAmount,
      targetReached: cartTotal >= settings.targetCartAmount,
      remaining: Math.max(0, settings.targetCartAmount - cartTotal)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sepetten ürün çıkar
app.post('/api/cart/remove', async (req, res) => {
  try {
    const { index } = req.body;
    cart.removeFromLocalCart(index);

    const settings = getSettings();
    const cartTotal = cart.getLocalCartTotal();

    res.json({
      success: true,
      message: 'Ürün sepetten çıkarıldı',
      cartTotal,
      targetReached: cartTotal >= settings.targetCartAmount,
      remaining: Math.max(0, settings.targetCartAmount - cartTotal)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sepeti güncelle (miktar değiştir)
app.post('/api/cart/update', async (req, res) => {
  try {
    const { index, quantity } = req.body;
    cart.updateLocalCart(index, quantity);

    const settings = getSettings();
    const cartTotal = cart.getLocalCartTotal();

    res.json({
      success: true,
      cartTotal,
      targetReached: cartTotal >= settings.targetCartAmount,
      remaining: Math.max(0, settings.targetCartAmount - cartTotal)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sepeti temizle
app.post('/api/cart/clear', async (req, res) => {
  try {
    cart.clearLocalCart();
    res.json({ success: true, message: 'Sepet temizlendi' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sipariş özeti
app.get('/api/order/summary', async (req, res) => {
  try {
    const summary = order.getSummary();
    res.json({ success: true, ...summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Siparişi onayla
app.post('/api/order/confirm', async (req, res) => {
  try {
    if (!browser.isLoggedIn()) {
      return res.status(401).json({ success: false, error: 'Önce giriş yapmalısınız' });
    }

    const result = await order.confirmOrder();

    // Telegram sipariş bildirimi
    if (result.summary) {
      const successCount = (result.results || []).filter(r => r.success).length;
      const failCount = (result.results || []).filter(r => !r.success).length;
      telegram.notifyOrderConfirmed(
        successCount,
        failCount,
        result.summary.total
      ).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Sipariş onay hatası: ' + err.message });
  }
});

// Ayarları getir
app.get('/api/settings', (req, res) => {
  res.json({ success: true, settings: getSettings() });
});

// Ayarları güncelle
app.post('/api/settings', (req, res) => {
  try {
    const current = getSettings();
    const updated = { ...current, ...req.body };
    saveSettings(updated);
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Siteye doğrudan sepeti senkronize et
app.post('/api/cart/sync', async (req, res) => {
  try {
    if (!browser.isLoggedIn()) {
      return res.status(401).json({ success: false, error: 'Önce giriş yapmalısınız' });
    }

    const localItems = cart.getLocalCart();
    const results = [];

    for (const item of localItems) {
      try {
        const result = await cart.addToCart(item.productId, item.quantity);
        results.push({ productId: item.productId, name: item.name, ...result });
      } catch (err) {
        results.push({ productId: item.productId, name: item.name, success: false, error: err.message });
      }
    }

    res.json({ success: true, results, message: `${results.filter(r => r.success).length}/${results.length} ürün siteye senkronize edildi` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== TELEGRAM ROUTES ====================

// Telegram bot durumu
app.get('/api/telegram/status', async (req, res) => {
  try {
    if (!telegram.enabled) {
      return res.json({ success: true, enabled: false, message: 'Telegram bot yapılandırılmamış' });
    }

    const me = await telegram.getMe();
    res.json({
      success: true,
      enabled: true,
      chatId: telegram.chatId || null,
      bot: me?.result ? {
        name: me.result.first_name,
        username: me.result.username
      } : null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Telegram Chat ID otomatik algılama
// Kullanıcı bota herhangi bir mesaj attıktan sonra bu endpoint çağrılır
app.post('/api/telegram/setup', async (req, res) => {
  try {
    if (!telegram.enabled) {
      return res.status(400).json({ success: false, error: 'Telegram bot token ayarlanmamış' });
    }

    const updates = await telegram.getUpdates();
    if (!updates?.ok || !updates.result?.length) {
      return res.json({
        success: false,
        error: 'Henüz mesaj yok. Lütfen Telegram\'da bota bir mesaj gönderin ve tekrar deneyin.'
      });
    }

    // En son mesajın chat ID'sini al
    const lastMessage = updates.result[updates.result.length - 1];
    const chatId = lastMessage.message?.chat?.id || lastMessage.channel_post?.chat?.id;
    const chatName = lastMessage.message?.chat?.first_name || lastMessage.message?.chat?.title || 'Bilinmiyor';

    if (!chatId) {
      return res.json({ success: false, error: 'Chat ID bulunamadı' });
    }

    telegram.setChatId(String(chatId));

    // Hoşgeldin mesajı gönder
    await telegram.sendMessage(
      `🤖 <b>Hafıza Kartçı Ajan</b> bağlandı!\n\n` +
      `✅ Telegram bildirimleri aktif.\n` +
      `📱 Sepet güncellemeleri, hedef tutar bildirimleri ve sipariş raporları bu kanala gelecek.`
    );

    res.json({
      success: true,
      chatId: String(chatId),
      chatName,
      message: 'Telegram bağlantısı kuruldu!'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Test mesajı gönder
app.post('/api/telegram/test', async (req, res) => {
  try {
    const result = await telegram.sendMessage(
      `🧪 <b>Test Mesajı</b>\n\n` +
      `✅ Bildirim sistemi çalışıyor!\n` +
      `🕐 ${new Date().toLocaleString('tr-TR')}`
    );

    if (result.ok) {
      res.json({ success: true, message: 'Test mesajı gönderildi' });
    } else {
      res.json({ success: false, error: result.description || 'Mesaj gönderilemedi' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Günlük rapor gönder
app.post('/api/telegram/report', async (req, res) => {
  try {
    const items = cart.getLocalCart();
    const total = cart.getLocalCartTotal();
    const settings = getSettings();

    const result = await telegram.notifyDailyReport(items, total, settings.targetCartAmount);

    if (result.ok) {
      res.json({ success: true, message: 'Rapor gönderildi' });
    } else {
      res.json({ success: false, error: result.description || 'Rapor gönderilemedi' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== TELEGRAM POLLING ====================

let lastSearchResults = [];
let pendingSelections = {};

// ...

// Helper function to ask the next option
async function askNextOption(chatId) {
  const state = pendingSelections[chatId];
  if (!state) return;

  if (state.currentOptionIndex >= state.options.length) {
    // Tüm seçenekler seçildi, sepete ekle
    try {
      await telegram.sendMessage(`⏳ Seçeneklerinizle sepete ekleniyor...`);
      const result = await cart.addToCartWithOptions(state.productId, state.quantity, state.selectedOptions);
      
      if (result.success) {
        cart.addToLocalCart({
          productId: state.productId,
          name: state.productName,
          price: state.productPrice,
          image: state.productImage,
          quantity: state.quantity
        });
        
        const settings = getSettings();
        const cartTotal = cart.getLocalCartTotal();
        const targetReached = cartTotal >= settings.targetCartAmount;
        
        await telegram.notifyCartAdd(state.productName, state.productPrice, cartTotal, settings.targetCartAmount);
        
        if (targetReached) {
          await telegram.notifyTargetReached(cartTotal, settings.targetCartAmount, cart.getLocalCart().length);
        }
      } else {
        await telegram.sendMessage('❌ Sepete eklenemedi: ' + (result.error || 'Bilinmeyen hata'));
      }
    } catch (err) {
      await telegram.sendMessage('❌ Hata: ' + err.message);
    } finally {
      delete pendingSelections[chatId];
    }
    return;
  }

  const currentOption = state.options[state.currentOptionIndex];
  let msg = `⚠️ Bu ürün için "${currentOption.name}" seçmeniz gerekiyor:\n\n`;
  currentOption.values.forEach((val, i) => {
    msg += `${i + 1}. ${val.name}\n`;
  });
  msg += `\n👉 Lütfen seçmek istediğiniz seçeneğin numarasını yazıp gönderin (Örn: 1)`;
  
  await telegram.sendMessage(msg);
}

// Helper to process option input
async function processOptionSelection(chatId, text) {
  const state = pendingSelections[chatId];
  if (!state) return false;

  const num = parseInt(text.trim());
  const currentOption = state.options[state.currentOptionIndex];

  if (isNaN(num) || num < 1 || num > currentOption.values.length) {
    await telegram.sendMessage(`⚠️ Geçersiz seçim. Lütfen 1 ile ${currentOption.values.length} arasında bir numara girin.`);
    return true;
  }

  const selectedValue = currentOption.values[num - 1];
  state.selectedOptions[currentOption.id] = selectedValue.id;
  
  state.currentOptionIndex++;
  await askNextOption(chatId);
  return true;
}

const telegramHandlers = {
  onRawText: async (text, chatId) => {
    return await processOptionSelection(chatId, text);
  },

  onSearch: async (query) => {
    try {
      await telegram.sendMessage(`🔍 "${query}" aranıyor...`);
      if (!browser.isLoggedIn()) {
         const email = process.env.HAFIZAKARTCI_EMAIL;
         const password = process.env.HAFIZAKARTCI_PASSWORD;
         if (email && password) await browser.login(email, password);
         else return await telegram.sendMessage('⚠️ Önce giriş yapmalısınız (Uygulama üzerinden).');
      }
      
      const results = await searcher.search(query, { page: 1, limit: 12 });
      if (!results.success) return await telegram.sendMessage('❌ Arama hatası: ' + results.error);
      if (results.products.length === 0) return await telegram.sendMessage('😕 Ürün bulunamadı.');
      
      lastSearchResults = results.products.slice(0, 10);
      let text = `🔎 <b>${results.totalProducts || results.products.length} sonuç bulundu:</b>\n\n`;
      lastSearchResults.forEach((p, i) => {
        text += `${i + 1}. ${telegram.escapeHtml(p.name)}\n   💰 <b>${telegram.formatPrice(p.price)}</b>\n`;
      });
      text += `\nSepete eklemek için: <b>/ekle [no]</b> (Örn: /ekle 1)`;
      await telegram.sendMessage(text);
    } catch(err) {
      await telegram.sendMessage('❌ Hata: ' + err.message);
    }
  },

  onSpecials: async () => {
    try {
      await telegram.sendMessage('🔍 İndirimdeki ürünler aranıyor...');
      if (!browser.isLoggedIn()) {
         const email = process.env.HAFIZAKARTCI_EMAIL;
         const password = process.env.HAFIZAKARTCI_PASSWORD;
         if (email && password) await browser.login(email, password);
         else return await telegram.sendMessage('⚠️ Önce giriş yapmalısınız (Uygulama üzerinden).');
      }
      
      const results = await searcher.getSpecials();
      if (!results.success) return await telegram.sendMessage('❌ İndirimleri çekerken hata: ' + results.error);
      if (!results.products || results.products.length === 0) return await telegram.sendMessage('😕 Şu an indirimde ürün bulunmuyor.');
      
      lastSearchResults = results.products.slice(0, 10);
      let text = `🔥 <b>GÜNÜN İNDİRİMLERİ (${results.products.length} ürün)</b>\n\n`;
      lastSearchResults.forEach((p, i) => {
        text += `${i + 1}. ${telegram.escapeHtml(p.name)}\n   🔻 <del>${telegram.formatPrice(p.oldPrice)}</del> ➡️ 💰 <b>${telegram.formatPrice(p.price)}</b>\n\n`;
      });
      text += `Sepete eklemek için: <b>/ekle [no]</b> (Örn: /ekle 1)`;
      await telegram.sendMessage(text);
    } catch(err) {
      await telegram.sendMessage('❌ Hata: ' + err.message);
    }
  },

  onAdd: async (argsStr) => {
    const parts = argsStr.trim().split(/[\s,]+/);
    const indexStr = parts[0];
    const qtyStr = parts[1] || "1";
    
    const idx = parseInt(indexStr) - 1;
    const quantity = Math.max(1, parseInt(qtyStr) || 1);

    if (isNaN(idx) || idx < 0 || idx >= lastSearchResults.length) {
      return await telegram.sendMessage('⚠️ Geçersiz ürün numarası. Lütfen arama sonuçlarındaki numaralardan birini girin. (Örn: /ekle 1 veya /ekle 1,10)');
    }
    const product = lastSearchResults[idx];
    if (!product.productId) {
      return await telegram.sendMessage('⚠️ Bu ürün direkt olarak eklenemiyor (Seçenekleri olabilir). Lütfen site üzerinden ekleyin.');
    }
    
    try {
      await telegram.sendMessage(`⏳ ${telegram.escapeHtml(product.name)} (${quantity} adet) sepete ekleniyor...`);
      const result = await cart.addToCart(product.productId, quantity);
      
      if (result.success) {
        cart.addToLocalCart({
          productId: product.productId,
          name: product.name,
          price: product.price,
          image: product.image,
          quantity: quantity
        });
        
        const settings = getSettings();
        const cartTotal = cart.getLocalCartTotal();
        const targetReached = cartTotal >= settings.targetCartAmount;
        
        await telegram.notifyCartAdd(product.name, product.price, cartTotal, settings.targetCartAmount);
        
        if (targetReached) {
          await telegram.notifyTargetReached(cartTotal, settings.targetCartAmount, cart.getLocalCart().length);
        }
      } else {
        if (result.needsOptions && result.redirect) {
          await telegram.sendMessage('⏳ Ürün seçenekleri alınıyor...');
          const details = await searcher.getProductDetails(result.redirect);
          if (details && details.options && details.options.length > 0) {
            const chatId = String(telegram.chatId);
            pendingSelections[chatId] = {
              productId: product.productId,
              productName: product.name,
              productImage: product.image,
              productPrice: product.price,
              quantity: quantity,
              options: details.options,
              currentOptionIndex: 0,
              selectedOptions: {}
            };
            await askNextOption(chatId);
          } else {
            await telegram.sendMessage('⚠️ Bu ürün seçenek gerektiriyor ancak stokta seçenek bulunamadı veya okunamadı. Lütfen site üzerinden ekleyin.');
          }
        } else {
           await telegram.sendMessage('❌ Sepete eklenemedi: ' + (result.error || 'Bilinmeyen hata'));
        }
      }
    } catch(err) {
      await telegram.sendMessage('❌ Hata: ' + err.message);
    }
  },

  onStatus: async () => {
    const settings = getSettings();
    const cartTotal = cart.getLocalCartTotal();
    const pct = Math.min(100, (cartTotal / settings.targetCartAmount) * 100).toFixed(0);
    await telegram.sendMessage(`📊 <b>Sepet Durumu (Lokal)</b>\n\n💰 Toplam: <b>${telegram.formatPrice(cartTotal)}</b>\n🎯 Hedef: ${telegram.formatPrice(settings.targetCartAmount)}\n📊 İlerleme: %${pct}`);
  },

  onCart: async () => {
    try {
      if (!browser.isLoggedIn()) return await telegram.sendMessage('⚠️ Önce uygulamanın giriş yapması gerekiyor.');
      
      await telegram.sendMessage('⏳ Sepet siteden alınıyor...');
      const siteCart = await cart.getSiteCartContents();
      
      if (!siteCart || siteCart.items.length === 0) {
        return await telegram.sendMessage('🛒 Hafıza Kartçı sitesindeki sepetiniz boş.');
      }
      
      let text = `🛒 <b>Hafıza Kartçı Sitesindeki Sepetiniz:</b>\n\n`;
      siteCart.items.forEach((item, i) => {
        text += `${i + 1}. ${telegram.escapeHtml(item.name)}\n   ${item.quantity}x ${telegram.formatPrice(item.price)} = <b>${telegram.formatPrice(item.price * item.quantity)}</b>\n`;
      });
      text += `\n💰 <b>Toplam: ${telegram.formatPrice(siteCart.total)}</b>`;
      
      const settings = getSettings();
      const pct = Math.min(100, (siteCart.total / settings.targetCartAmount) * 100).toFixed(0);
      text += `\n🎯 İlerleme: %${pct}`;
      
      await telegram.sendMessage(text);
    } catch(err) {
      await telegram.sendMessage('❌ Sepet alınamadı: ' + err.message);
    }
  },

  onOrder: async () => {
    if (!browser.isLoggedIn()) return await telegram.sendMessage('⚠️ Önce uygulamanın giriş yapması gerekiyor.');
    
    await telegram.sendMessage('⏳ Sipariş onaylanıyor...');
    try {
      const result = await order.confirmOrder();
      if (result.summary) {
        const successCount = (result.results || []).filter(r => r.success).length;
        const failCount = (result.results || []).filter(r => !r.success).length;
        await telegram.notifyOrderConfirmed(successCount, failCount, result.summary.total);
        cart.clearLocalCart();
      } else {
        await telegram.sendMessage('❌ Sipariş onayı başarısız oldu: ' + (result.message || result.error));
      }
    } catch (err) {
      await telegram.sendMessage('❌ Sipariş hatası: ' + err.message);
    }
  }
};

// ==================== WEBHOOK ROUTES ====================

// Telegram Webhook Endpoint
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update) {
      console.log('📱 Telegram Webhook güncellemesi alındı:', update.update_id);
      
      // Otomatik giriş kontrolü
      if (!browser.isLoggedIn()) {
        const email = process.env.HAFIZAKARTCI_EMAIL;
        const password = process.env.HAFIZAKARTCI_PASSWORD;
        if (email && password) {
          try {
            await browser.login(email, password);
          } catch (e) {
            console.error('Webhook otomatik giriş hatası:', e.message);
          }
        }
      }

      await telegram.processUpdate(update, telegramHandlers);
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook işleme hatası:', err.message);
    res.status(200).send('OK'); // Telegram'ın sürekli tekrar etmesini önlemek için 200 dönülür
  }
});

// Vercel Cron Raporu Endpoint'i
app.get('/api/cron/daily-report', async (req, res) => {
  // Cron güvenliği
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  console.log('⏰ Daily Report Cron tetiklendi.');
  try {
    if (!telegram.enabled || !telegram.chatId) {
      return res.json({ success: false, message: 'Telegram pasif veya chat ID yok' });
    }

    if (!browser.isLoggedIn()) {
      const email = process.env.HAFIZAKARTCI_EMAIL;
      const password = process.env.HAFIZAKARTCI_PASSWORD;
      if (email && password) await browser.login(email, password);
    }
    
    if (browser.isLoggedIn()) {
      const results = await searcher.getSpecials();
      if (results.success && results.products && results.products.length > 0) {
        lastSearchResults = results.products.slice(0, 10);
        let text = `⏰🔥 <b>GÜNÜN İNDİRİMLERİ (${results.products.length} ürün)</b>\n\n`;
        lastSearchResults.forEach((p, i) => {
          text += `${i + 1}. ${telegram.escapeHtml(p.name)}\n   🔻 <del>${telegram.formatPrice(p.oldPrice)}</del> ➡️ 💰 <b>${telegram.formatPrice(p.price)}</b>\n\n`;
        });
        text += `Sepete eklemek için: <b>/ekle [no]</b> (Örn: /ekle 1)`;
        await telegram.sendMessage(text);
        return res.json({ success: true, message: 'Rapor gönderildi' });
      }
      return res.json({ success: true, message: 'İndirimli ürün bulunamadı' });
    }
    return res.status(401).json({ success: false, message: 'Oturum açılamadı' });
  } catch (err) {
    console.error('Cron çalışırken hata:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== START SERVER ====================

(async () => {
  // Depolamayı başlat ve çerez/ayarları KV'den eşitle
  await initStorage();
  
  // Vercel'de değilsek yerel polling ve cron'u başlat
  if (!isVercel) {
    telegram.startPolling(telegramHandlers);
    
    // Her gün saat 10:00'da çalışacak yerel cron
    cron.schedule('0 10 * * *', async () => {
      if (!telegram.enabled || !telegram.chatId) return;
      console.log('⏰ Günlük indirim raporu cron job tetiklendi.');
      
      try {
        if (!browser.isLoggedIn()) {
          const email = process.env.HAFIZAKARTCI_EMAIL;
          const password = process.env.HAFIZAKARTCI_PASSWORD;
          if (email && password) await browser.login(email, password);
        }
        
        if (browser.isLoggedIn()) {
          const results = await searcher.getSpecials();
          if (results.success && results.products && results.products.length > 0) {
            lastSearchResults = results.products.slice(0, 10);
            let text = `⏰🔥 <b>GÜNÜN İNDİRİMLERİ (${results.products.length} ürün)</b>\n\n`;
            lastSearchResults.forEach((p, i) => {
              text += `${i + 1}. ${telegram.escapeHtml(p.name)}\n   🔻 <del>${telegram.formatPrice(p.oldPrice)}</del> ➡️ 💰 <b>${telegram.formatPrice(p.price)}</b>\n\n`;
            });
            text += `Sepete eklemek için: <b>/ekle [no]</b> (Örn: /ekle 1)`;
            await telegram.sendMessage(text);
          }
        }
      } catch (err) {
        console.error('Cron job hatası:', err);
      }
    });
  }

  // Sunucuyu başlat (Sadece yerel ortamda)
  if (!isVercel) {
    app.listen(PORT, () => {
      console.log(`
  ╔══════════════════════════════════════════════════╗
  ║                                                  ║
  ║   🤖 Hafıza Kartçı Ajan Sistemi                  ║
  ║   📍 http://localhost:${PORT}                      ║
  ║   ⚙️  Vercel Modu: HAYIR                         ║
  ║                                                  ║
  ╚══════════════════════════════════════════════════╝
      `);
    });
  }
})();

module.exports = app;
