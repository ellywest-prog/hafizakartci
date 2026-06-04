/**
 * Telegram Bot - Bildirim sistemi
 * Sepet güncellemeleri, hedef tutar bildirimleri ve sipariş raporları gönderir
 */

const https = require('https');

class TelegramBot {
  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';
    this.apiBase = `https://api.telegram.org/bot${this.token}`;
    this.enabled = !!this.token;
    
    this.lastUpdateId = 0;
    this.isPolling = false;
    this.pollTimer = null;

    if (this.enabled) {
      console.log('📱 Telegram bot aktif');
      if (!this.chatId) {
        console.log('⚠️  TELEGRAM_CHAT_ID ayarlanmamış. /api/telegram/setup ile alabilirsiniz.');
      }
    }
  }

  /**
   * Token'ı yeniden yükle (.env değiştiğinde)
   */
  reload() {
    this.token = process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';
    this.apiBase = `https://api.telegram.org/bot${this.token}`;
    this.enabled = !!this.token;
  }

  /**
   * Chat ID'yi güncelle
   */
  setChatId(chatId) {
    this.chatId = chatId;
    // .env dosyasına da yaz
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env');
    try {
      let envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('TELEGRAM_CHAT_ID=')) {
        envContent = envContent.replace(/TELEGRAM_CHAT_ID=.*/, `TELEGRAM_CHAT_ID=${chatId}`);
      } else {
        envContent += `\nTELEGRAM_CHAT_ID=${chatId}`;
      }
      fs.writeFileSync(envPath, envContent, 'utf8');
      process.env.TELEGRAM_CHAT_ID = chatId;
      console.log(`📱 Telegram Chat ID kaydedildi: ${chatId}`);
    } catch (err) {
      console.error('Chat ID kaydetme hatası:', err.message);
    }
  }

  /**
   * Telegram API'ye istek gönder
   */
  apiRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(params);

      const url = new URL(`${this.apiBase}/${method}`);

      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ ok: false, description: body });
          }
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  /**
   * Mesaj gönder (Markdown v2 formatında)
   */
  async sendMessage(text, options = {}) {
    if (!this.enabled || !this.chatId) {
      console.log('📱 Telegram: Mesaj gönderilemedi (bot veya chat_id ayarlanmamış)');
      return { ok: false, reason: 'Bot veya chat_id ayarlanmamış' };
    }

    try {
      const result = await this.apiRequest('sendMessage', {
        chat_id: this.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options
      });

      if (result.ok) {
        console.log('📱 Telegram mesaj gönderildi');
      } else {
        console.error('📱 Telegram hata:', result.description);
      }
      return result;
    } catch (err) {
      console.error('📱 Telegram gönderim hatası:', err.message);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Son gelen mesajları kontrol et (chat_id almak için)
   */
  async getUpdates() {
    if (!this.enabled) return null;

    try {
      const result = await this.apiRequest('getUpdates', { limit: 5, offset: -5 });
      return result;
    } catch (err) {
      console.error('Telegram updates hatası:', err.message);
      return null;
    }
  }

  /**
   * Bot bilgisini al
   */
  async getMe() {
    if (!this.enabled) return null;
    return await this.apiRequest('getMe');
  }

  // ==================== POLLING & KOMUT İŞLEME ====================

  /**
   * Telegram'dan düzenli aralıklarla mesajları çeker
   * @param {Object} handlers - { onSearch, onAdd, onStatus, onCart, onOrder }
   */
  startPolling(handlers) {
    if (!this.enabled) return;
    if (this.isPolling) return;
    
    this.isPolling = true;
    console.log('📱 Telegram bot dinlemeye başladı (Polling)...');
    
    this.pollLoop(handlers);
  }

  stopPolling() {
    this.isPolling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollLoop(handlers) {
    if (!this.isPolling) return;

    try {
      // Sadece en son mesajları al (offset ile)
      const params = { limit: 10, timeout: 30 }; // Long polling
      if (this.lastUpdateId > 0) {
        params.offset = this.lastUpdateId + 1;
      }
      
      const result = await this.apiRequest('getUpdates', params);
      
      if (result.ok && result.result && result.result.length > 0) {
        for (const update of result.result) {
          this.lastUpdateId = update.update_id;
          await this.processUpdate(update, handlers);
        }
      }
    } catch (err) {
      console.error('📱 Telegram polling hatası:', err.message);
    }

    // Döngüyü tekrarla
    if (this.isPolling) {
      this.pollTimer = setTimeout(() => this.pollLoop(handlers), 2000);
    }
  }

  async processUpdate(update, handlers) {
    const msg = update.message;
    if (!msg || !msg.text) return;

    // Otomatik Chat ID kaydet (eğer yoksa veya farklıysa)
    if (msg.chat && msg.chat.id && String(msg.chat.id) !== String(this.chatId)) {
      console.log(`📱 Yeni bir chat algılandı: ${msg.chat.id}`);
      this.setChatId(String(msg.chat.id));
    }

    // Slashsız komutları slashlı versiyona çevir
    let normalizedText = msg.text.trim();
    const lowerText = normalizedText.toLowerCase();
    if (lowerText.startsWith('ekle ')) normalizedText = '/' + normalizedText;
    else if (lowerText === 'ekle') normalizedText = '/ekle';
    else if (lowerText.startsWith('ara ')) normalizedText = '/' + normalizedText;
    else if (lowerText === 'sepet') normalizedText = '/sepet';
    else if (lowerText === 'durum') normalizedText = '/durum';
    else if (lowerText === 'indirimler') normalizedText = '/indirimler';
    else if (lowerText === 'onayla') normalizedText = '/onayla';

    console.log(`📱 Telegram'dan mesaj geldi: ${normalizedText}`);

    if (normalizedText.startsWith('/')) {
      const parts = normalizedText.split(' ');
      const command = parts[0].toLowerCase();
      const args = parts.slice(1).join(' ');

      switch (command) {
        case '/start':
          await this.sendMessage('🤖 Hafıza Kartçı Ajanına Hoşgeldiniz!\n\nKomutlar:\n/durum - Sepet durumu\n/ara [ürün] - Ürün arama\n/ekle [no] [adet] - Sepete ürün ekle (Örn: /ekle 1,10)\n/sepet - Sepettekileri listele\n/indirimler - İndirimdeki ürünler\n/onayla - Siparişi tamamla\n\n*Arama yapmak için direkt ürün adını yazabilirsiniz!');
          break;
        case '/durum':
          if (handlers.onStatus) await handlers.onStatus();
          break;
        case '/sepet':
          if (handlers.onCart) await handlers.onCart();
          break;
        case '/onayla':
          if (handlers.onOrder) await handlers.onOrder();
          break;
        case '/indirimler':
          if (handlers.onSpecials) await handlers.onSpecials();
          break;
        case '/ara':
          if (args && handlers.onSearch) await handlers.onSearch(args);
          else await this.sendMessage('⚠️ Lütfen aranacak kelimeyi girin. Örnek: /ara kılıf');
          break;
        case '/ekle':
          if (args && handlers.onAdd) await handlers.onAdd(args);
          else await this.sendMessage('⚠️ Lütfen ürün numarası girin. Örnek: /ekle 1');
          break;
        default:
          await this.sendMessage('❓ Bilinmeyen komut. Direkt arama yapmak için / kullanmadan yazın.');
      }
      } else {
        // Komut değilse, önce rawText handler'ına gönder
        let handled = false;
        if (handlers.onRawText) {
          handled = await handlers.onRawText(normalizedText, String(msg.chat.id));
        }
        
        // Eğer rawText tarafından işlenmediyse arama yap
        if (!handled && handlers.onSearch) {
          await handlers.onSearch(normalizedText);
        }
      }
  }

  // ==================== BİLDİRİM ŞABLONLARI ====================

  /**
   * 🛒 Sepete ürün eklendiğinde bildirim
   */
  async notifyCartAdd(productName, price, cartTotal, targetAmount) {
    const pct = Math.min(100, (cartTotal / targetAmount) * 100).toFixed(0);
    const remaining = Math.max(0, targetAmount - cartTotal);
    const progressBar = this.createProgressBar(pct);

    const text =
      `🛒 <b>Sepete Eklendi</b>\n` +
      `\n` +
      `📦 ${this.escapeHtml(productName)}\n` +
      `💰 Fiyat: <b>${this.formatPrice(price)}</b>\n` +
      `\n` +
      `${progressBar} ${pct}%\n` +
      `📊 Sepet: <b>${this.formatPrice(cartTotal)}</b> / ${this.formatPrice(targetAmount)}\n` +
      `${remaining > 0 ? `📌 Kalan: ${this.formatPrice(remaining)}` : '✅ Hedef tutara ulaşıldı!'}`;

    return await this.sendMessage(text);
  }

  /**
   * 🎯 Hedef tutara ulaşıldığında bildirim
   */
  async notifyTargetReached(cartTotal, targetAmount, itemCount) {
    const text =
      `🎯🎉 <b>HEDEF TUTARA ULAŞILDI!</b>\n` +
      `\n` +
      `💰 Sepet Toplamı: <b>${this.formatPrice(cartTotal)}</b>\n` +
      `🎯 Hedef Tutar: ${this.formatPrice(targetAmount)}\n` +
      `📦 Ürün Sayısı: ${itemCount}\n` +
      `\n` +
      `👉 Panelden siparişinizi kontrol edip onaylayabilirsiniz.\n` +
      `🌐 http://localhost:${process.env.PORT || 3000}`;

    return await this.sendMessage(text);
  }

  /**
   * 📦 Sipariş özeti bildirimi
   */
  async notifyOrderSummary(items, total) {
    let itemList = items.slice(0, 15).map((item, i) =>
      `${i + 1}. ${this.escapeHtml(item.name)}\n   ${item.quantity}x ${this.formatPrice(item.price)} = <b>${this.formatPrice(item.price * item.quantity)}</b>`
    ).join('\n');

    if (items.length > 15) {
      itemList += `\n... ve ${items.length - 15} ürün daha`;
    }

    const text =
      `📦 <b>SİPARİŞ ÖZETİ</b>\n` +
      `${'─'.repeat(25)}\n` +
      `\n` +
      `${itemList}\n` +
      `\n` +
      `${'─'.repeat(25)}\n` +
      `💰 <b>TOPLAM: ${this.formatPrice(total)}</b>\n` +
      `📦 ${items.length} farklı ürün, ${items.reduce((s, i) => s + i.quantity, 0)} adet\n` +
      `\n` +
      `⏳ Onayınız bekleniyor...`;

    return await this.sendMessage(text);
  }

  /**
   * ✅ Sipariş onaylandığında bildirim
   */
  async notifyOrderConfirmed(successCount, failCount, total) {
    const emoji = failCount === 0 ? '✅' : '⚠️';
    const status = failCount === 0 ? 'BAŞARILI' : 'KISMI BAŞARILI';

    const text =
      `${emoji} <b>SİPARİŞ ${status}</b>\n` +
      `\n` +
      `✅ Başarılı: ${successCount} ürün\n` +
      `${failCount > 0 ? `❌ Başarısız: ${failCount} ürün\n` : ''}` +
      `💰 Toplam: <b>${this.formatPrice(total)}</b>\n` +
      `\n` +
      `🌐 Siparişi tamamlamak için siteye gidin:\n` +
      `https://www.hafizakartci.com/index.php?route=checkout/cart\n` +
      `\n` +
      `💳 Havale bilgisi site tarafından iletilecektir.`;

    return await this.sendMessage(text);
  }

  /**
   * 🔐 Giriş durumu bildirimi
   */
  async notifyLoginStatus(success, email) {
    const text = success
      ? `🟢 <b>Giriş Başarılı</b>\n📧 ${this.escapeHtml(email)}\n🕐 ${new Date().toLocaleString('tr-TR')}`
      : `🔴 <b>Giriş Başarısız</b>\n📧 ${this.escapeHtml(email)}\n🕐 ${new Date().toLocaleString('tr-TR')}`;

    return await this.sendMessage(text);
  }

  /**
   * 📊 Günlük rapor
   */
  async notifyDailyReport(cartItems, cartTotal, targetAmount) {
    const pct = Math.min(100, (cartTotal / targetAmount) * 100).toFixed(0);
    const progressBar = this.createProgressBar(pct);

    const text =
      `📊 <b>GÜNLÜK RAPOR</b>\n` +
      `🕐 ${new Date().toLocaleString('tr-TR')}\n` +
      `\n` +
      `${progressBar} ${pct}%\n` +
      `🛒 Sepetteki Ürün: ${cartItems.length}\n` +
      `💰 Sepet Toplamı: <b>${this.formatPrice(cartTotal)}</b>\n` +
      `🎯 Hedef: ${this.formatPrice(targetAmount)}\n` +
      `📌 Kalan: ${this.formatPrice(Math.max(0, targetAmount - cartTotal))}`;

    return await this.sendMessage(text);
  }

  // ==================== YARDIMCI FONKSİYONLAR ====================

  formatPrice(amount) {
    if (!amount && amount !== 0) return '0,00 ₺';
    return new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount) + ' ₺';
  }

  escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  createProgressBar(pct) {
    const filled = Math.round(pct / 10);
    const empty = 10 - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty);
  }
}

module.exports = { TelegramBot };
