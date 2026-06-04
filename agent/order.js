/**
 * Order Manager - Sipariş yönetimi
 * Sipariş özeti hazırlama ve onaylama
 */

const BASE_URL = 'https://www.hafizakartci.com';

class OrderManager {
  constructor(browserAgent, cartManager) {
    this.browser = browserAgent;
    this.cart = cartManager;
  }

  /**
   * Sipariş özetini hazırla
   */
  getSummary() {
    const items = this.cart.getLocalCart();
    const total = this.cart.getLocalCartTotal();

    return {
      items: items.map((item, index) => ({
        index,
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        totalPrice: item.price * item.quantity,
        image: item.image
      })),
      subtotal: total,
      total: total,
      itemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Siparişi onayla - Site üzerinde sepeti senkronize et
   * NOT: Gerçek sipariş oluşturmaz, sadece sepeti senkronize eder
   * Kullanıcı siteye gidip checkout yapacak
   */
  async confirmOrder() {
    console.log('📦 Sipariş onaylanıyor...');

    // Önce sitedeki sepeti kontrol et
    const localItems = this.cart.getLocalCart();

    if (localItems.length === 0) {
      return { success: false, error: 'Sepet boş' };
    }

    // Her bir ürünü siteye ekle
    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const item of localItems) {
      try {
        const result = await this.cart.addToCart(item.productId, item.quantity);
        results.push({
          name: item.name,
          productId: item.productId,
          quantity: item.quantity,
          ...result
        });
        if (result.success) successCount++;
        else failCount++;
      } catch (err) {
        results.push({
          name: item.name,
          productId: item.productId,
          success: false,
          error: err.message
        });
        failCount++;
      }

      // Rate limiting - istekler arası bekleme
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const summary = this.getSummary();

    console.log(`✅ Sipariş senkronize edildi: ${successCount} başarılı, ${failCount} başarısız`);

    return {
      success: failCount === 0,
      message: failCount === 0
        ? `Siparişiniz başarıyla oluşturuldu! ${successCount} ürün siteye eklendi. Lütfen hafizakartci.com'a giderek siparişinizi tamamlayın.`
        : `${successCount} ürün eklendi, ${failCount} ürün eklenemedi.`,
      checkoutUrl: `${BASE_URL}/index.php?route=checkout/checkout`,
      cartUrl: `${BASE_URL}/index.php?route=checkout/cart`,
      results,
      summary
    };
  }
}

module.exports = { OrderManager };
