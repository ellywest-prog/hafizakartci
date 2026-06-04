/**
 * Cart Manager - Sepet yönetimi
 * Hem lokal sepet takibi hem de hafizakartci.com sepet işlemleri
 */

const BASE_URL = 'https://www.hafizakartci.com';

class CartManager {
  constructor(browserAgent) {
    this.browser = browserAgent;
    this.localCart = []; // Lokal sepet
  }

  /**
   * Siteye ürün ekle (AJAX API)
   */
  async addToCart(productId, quantity = 1) {
    const body = `product_id=${productId}&quantity=${quantity}`;

    const response = await this.browser.request(
      `${BASE_URL}/index.php?route=checkout/cart/add`,
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

    try {
      const json = JSON.parse(response.body);

      if (json.error) {
        const errorMsg = typeof json.error === 'string'
          ? json.error
          : (json.error.option ? 'Seçenek belirtmelisiniz (renk, model vb.)' : JSON.stringify(json.error));
          
        return { 
          success: false, 
          error: errorMsg,
          needsOptions: !!(json.error.option || json.redirect),
          redirect: json.redirect 
        };
      }

      if (json.redirect && !json.options_popup) {
        // Ürün seçenek gerektiriyor ve options_popup yok
        return {
          success: false,
          needsOptions: true,
          redirect: json.redirect,
          error: 'Bu ürün için seçenek belirlemeniz gerekiyor (renk, boyut vb.)'
        };
      }

      // Site has an options_popup extension that overrides standard OpenCart response
      if (json.success || json.options_popup) {
        console.log(`✅ Sepete eklendi: Ürün #${productId} x${quantity}`);
        const successMsg = json.success ? json.success.replace(/<[^>]+>/g, '').trim() : 'Ürün sepete eklendi';
        return {
          success: true,
          message: successMsg,
          total: json.total || ''
        };
      }

      return { success: false, error: 'Bilinmeyen hata' };
    } catch {
      // JSON parse edilemedi, HTML dönmüş olabilir
      if (response.body.includes('account/login')) {
        return { success: false, error: 'Oturum süresi dolmuş, tekrar giriş yapın' };
      }
      return { success: false, error: 'Beklenmeyen yanıt alındı' };
    }
  }

  /**
   * Seçeneklerle birlikte ürünü sepete ekle
   * @param {string} productId
   * @param {number} quantity
   * @param {Object} options - { "17970": "50282" } formatında
   */
  async addToCartWithOptions(productId, quantity = 1, options = {}) {
    let body = `product_id=${productId}&quantity=${quantity}`;
    for (const [optId, optVal] of Object.entries(options)) {
      body += `&option%5B${optId}%5D=${optVal}`;
    }

    const response = await this.browser.request(
      `${BASE_URL}/index.php?route=checkout/cart/add`,
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

    try {
      const json = JSON.parse(response.body);

      if (json.error) {
        const errorMsg = typeof json.error === 'string'
          ? json.error
          : (json.error.option ? 'Seçenek belirtmelisiniz (renk, model vb.)' : JSON.stringify(json.error));
        return { success: false, error: errorMsg };
      }

      if (json.success || json.options_popup) {
        console.log(`✅ Sepete eklendi (Seçenekli): Ürün #${productId} x${quantity}`);
        const successMsg = json.success ? json.success.replace(/<[^>]+>/g, '').trim() : 'Ürün sepete eklendi';
        return {
          success: true,
          message: successMsg,
          total: json.total || ''
        };
      }

      return { success: false, error: 'Bilinmeyen hata' };
    } catch {
      return { success: false, error: 'Beklenmeyen yanıt alındı' };
    }
  }

  /**
   * Sitedeki sepet içeriğini getir
   */
  async getSiteCartContents() {
    const response = await this.browser.request(
      `${BASE_URL}/index.php?route=checkout/cart`,
      {
        headers: {
          'Accept': 'text/html'
        }
      }
    );

    return this.parseCartPage(response.body);
  }

  /**
   * Sepet sayfasını parse et
   */
  parseCartPage(html) {
    const items = [];

    // Sepet tablosundaki satırları bul
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let match;

    while ((match = rowRegex.exec(html)) !== null) {
      const row = match[1];

      // Sadece ürün satırlarını al (td-name olan)
      if (!row.includes('td-name')) continue;

      const nameMatch = row.match(/<td[^>]*class="[^"]*td-name[^"]*"[^>]*><a[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      const detailsMatch = row.match(/(\d+)\s*Adet\s*-\s*<strong>([\d.,\s]+)(?:TL|₺)<\/strong>/);
      const imgMatch = row.match(/<img[^>]*src="([^"]*)"[^>]*/);
      const removeMatch = row.match(/cart\.remove\(['"](\d+)['"]\)/);

      if (nameMatch) {
        let quantity = 1;
        let price = 0;
        
        if (detailsMatch) {
          quantity = parseInt(detailsMatch[1]) || 1;
          const priceStr = detailsMatch[2].replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.');
          // Bu fiyat o satırın toplam fiyatıdır, biz birim fiyatı bulalım
          const rowTotal = parseFloat(priceStr) || 0;
          price = rowTotal / quantity;
        }

        items.push({
          productId: removeMatch ? removeMatch[1] : null,
          name: nameMatch[1].replace(/<[^>]+>/g, '').trim(),
          price: price,
          quantity: quantity,
          image: imgMatch ? imgMatch[1] : ''
        });
      }
    }

    // Toplam tutar
    let total = 0;
    const totalMatch = html.match(/(?:Toplam|Alt Toplam)[^<]*<\/td>\s*<td[^>]*>([\d.,\s]+)(?:TL|₺)/);
    if (totalMatch) {
      total = parseFloat(totalMatch[1].replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.'));
    }

    return { items, total };
  }

  // ==================== LOKAL SEPET YÖNETİMİ ====================

  /**
   * Lokal sepete ürün ekle
   */
  addToLocalCart(product) {
    // Aynı ürün varsa miktarı artır
    const existing = this.localCart.find(item => item.productId === product.productId);
    if (existing) {
      existing.quantity += product.quantity || 1;
      existing.totalPrice = existing.price * existing.quantity;
    } else {
      this.localCart.push({
        ...product,
        quantity: product.quantity || 1,
        totalPrice: (product.price || 0) * (product.quantity || 1),
        addedAt: new Date().toISOString()
      });
    }
    console.log(`🛒 Lokal sepete eklendi: ${product.name} (Toplam: ${this.getLocalCartTotal().toFixed(2)} TL)`);
  }

  /**
   * Lokal sepetten ürün çıkar
   */
  removeFromLocalCart(index) {
    if (index >= 0 && index < this.localCart.length) {
      const removed = this.localCart.splice(index, 1)[0];
      console.log(`🗑️ Sepetten çıkarıldı: ${removed.name}`);
    }
  }

  /**
   * Lokal sepet miktarını güncelle
   */
  updateLocalCart(index, quantity) {
    if (index >= 0 && index < this.localCart.length) {
      this.localCart[index].quantity = Math.max(1, quantity);
      this.localCart[index].totalPrice = this.localCart[index].price * this.localCart[index].quantity;
    }
  }

  /**
   * Lokal sepeti getir
   */
  getLocalCart() {
    return this.localCart;
  }

  /**
   * Lokal sepet toplamını hesapla
   */
  getLocalCartTotal() {
    return this.localCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }

  /**
   * Lokal sepeti temizle
   */
  clearLocalCart() {
    this.localCart = [];
    console.log('🗑️ Sepet temizlendi');
  }
}

module.exports = { CartManager };
