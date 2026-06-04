/**
 * Hafıza Kartçı Ajan - Frontend Mantığı
 */

const API_BASE = '';  // Same origin

// ==================== DURUM YÖNETİMİ ====================

let appState = {
  loggedIn: false,
  cart: [],
  cartTotal: 0,
  targetAmount: 5000,
  searchResults: [],
  currentQuery: '',
  currentPage: 1,
  totalPages: 1
};

// ==================== SAYFA YÜKLENDİĞİNDE ====================

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  bindEvents();
});

async function initApp() {
  try {
    // Durumu kontrol et
    const status = await apiGet('/api/status');
    if (status.success) {
      appState.loggedIn = status.loggedIn;
      appState.targetAmount = status.settings?.targetCartAmount || 5000;
      updateConnectionStatus(status.loggedIn);
      updateProgressBar(status.cartTotal || 0, appState.targetAmount);
    }

    // Sepeti yükle
    await refreshCart();

    // Ayarları yükle
    const settings = await apiGet('/api/settings');
    if (settings.success) {
      document.getElementById('settings-target').value = settings.settings.targetCartAmount || 5000;
    }

    // Otomatik giriş dene (env'den)
    if (!appState.loggedIn) {
      setConnectionStatus('loading', 'Giriş yapılıyor...');
      try {
        const loginResult = await apiPost('/api/login', {});
        if (loginResult.success) {
          appState.loggedIn = true;
          updateConnectionStatus(true);
          showNotification('success', '✅', 'Toptancı sitesine bağlandı!');
        } else {
          updateConnectionStatus(false);
        }
      } catch {
        updateConnectionStatus(false);
      }
    }
  } catch (err) {
    console.error('Uygulama başlatma hatası:', err);
  }
}

// ==================== EVENT BINDINGS ====================

function bindEvents() {
  // Arama formu
  document.getElementById('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    performSearch();
  });

  // Enter tuşu
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performSearch();
    }
  });

  // Ayarlar butonu
  document.getElementById('btn-settings').addEventListener('click', openSettingsModal);

  // Giriş butonu
  document.getElementById('btn-login').addEventListener('click', handleLogin);

  // Ayarları kaydet
  document.getElementById('btn-save-settings').addEventListener('click', handleSaveSettings);

  // Telegram butonları
  document.getElementById('btn-telegram-setup').addEventListener('click', handleTelegramSetup);
  document.getElementById('btn-telegram-test').addEventListener('click', handleTelegramTest);
  document.getElementById('btn-telegram-report').addEventListener('click', handleTelegramReport);

  // Sepeti temizle
  document.getElementById('btn-clear-cart').addEventListener('click', handleClearCart);

  // Senkronize et
  document.getElementById('btn-sync-cart').addEventListener('click', handleSyncCart);

  // Sipariş butonu
  document.getElementById('btn-order').addEventListener('click', openOrderModal);

  // Sipariş onayla
  document.getElementById('btn-confirm-order').addEventListener('click', handleConfirmOrder);

  // Hedef banner sipariş butonu
  document.getElementById('btn-review-order').addEventListener('click', openOrderModal);

  // Mini sepete tıkla (mobilde sepet paneline kaydır)
  document.getElementById('cart-mini').addEventListener('click', () => {
    document.getElementById('cart-panel').scrollIntoView({ behavior: 'smooth' });
  });
}

// ==================== ARAMA ====================

async function performSearch(page = 1) {
  const query = document.getElementById('search-input').value.trim();
  if (!query) return;

  const sortVal = document.getElementById('search-sort').value.split('-');
  const limit = document.getElementById('search-limit').value;

  appState.currentQuery = query;
  appState.currentPage = page;

  showSearchLoading(true);
  hideSearchResults();

  try {
    const result = await apiPost('/api/search', {
      query,
      page,
      sort: sortVal[0],
      order: sortVal[1],
      limit: parseInt(limit)
    });

    if (result.success) {
      appState.searchResults = result.products || [];
      appState.totalPages = result.totalPages || 1;
      renderSearchResults(result.products, result.totalProducts);
      renderPagination(page, result.totalPages);
    } else {
      showSearchError(result.error || 'Arama yapılamadı');
    }
  } catch (err) {
    showSearchError('Bağlantı hatası: ' + err.message);
  } finally {
    showSearchLoading(false);
  }
}

function renderSearchResults(products, total) {
  const container = document.getElementById('search-results');

  if (!products || products.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">😕</div>
        <h3>Ürün Bulunamadı</h3>
        <p>Farklı bir arama terimi deneyin.</p>
      </div>
    `;
    return;
  }

  const totalText = total ? `<div style="grid-column:1/-1;padding:0 0 8px;font-size:0.82rem;color:var(--text-muted);">🔎 ${total} ürün bulundu</div>` : '';

  container.innerHTML = totalText + products.map((product, index) => `
    <div class="product-card" style="animation-delay: ${index * 0.05}s">
      <img
        class="product-card-img"
        src="${escapeHtml(product.image || '')}"
        alt="${escapeHtml(product.name)}"
        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%2250%25%22 x=%2250%25%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22 font-size=%2240%22>📦</text></svg>'"
      >
      <div class="product-card-body">
        <div class="product-card-name" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</div>
        ${product.price > 0
          ? `<div class="product-card-price">${formatPrice(product.price)}</div>`
          : `<div class="product-card-price" style="font-size:0.82rem;opacity:0.6;">Fiyat bilgisi yok</div>`
        }
        ${product.oldPrice > 0
          ? `<div class="product-card-old-price">${formatPrice(product.oldPrice)}</div>`
          : ''
        }
      </div>
      <div class="product-card-footer">
        <button
          class="btn-add-cart"
          onclick="handleAddToCart('${product.productId}', '${escapeHtml(product.name).replace(/'/g, "\\'")}', ${product.price}, '${escapeHtml(product.image || '')}', this)"
          ${!product.productId ? 'disabled' : ''}
        >
          🛒 Sepete Ekle
        </button>
        ${product.url
          ? `<a href="${escapeHtml(product.url)}" target="_blank" class="btn-view" title="Sitede Göster">🔗</a>`
          : ''
        }
      </div>
    </div>
  `).join('');
}

function renderPagination(currentPage, totalPages) {
  const container = document.getElementById('pagination');

  if (totalPages <= 1) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  let html = '';
  if (currentPage > 1) {
    html += `<button onclick="performSearch(${currentPage - 1})">← Önceki</button>`;
  }

  for (let i = 1; i <= Math.min(totalPages, 10); i++) {
    html += `<button class="${i === currentPage ? 'active' : ''}" onclick="performSearch(${i})">${i}</button>`;
  }

  if (currentPage < totalPages) {
    html += `<button onclick="performSearch(${currentPage + 1})">Sonraki →</button>`;
  }

  container.innerHTML = html;
}

function showSearchLoading(show) {
  document.getElementById('search-loading').classList.toggle('hidden', !show);
}

function hideSearchResults() {
  // Yükleme sırasında sonuçları temizleme, loading gösterge yeterli
}

function showSearchError(message) {
  document.getElementById('search-results').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <h3>Hata</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

// ==================== SEPET ====================

async function handleAddToCart(productId, name, price, image, buttonEl) {
  if (!productId) return;

  // Buton durumunu güncelle
  const originalText = buttonEl.innerHTML;
  buttonEl.innerHTML = '⏳ Ekleniyor...';
  buttonEl.disabled = true;

  try {
    const result = await apiPost('/api/cart/add', {
      productId,
      quantity: 1,
      productName: name,
      productPrice: price,
      productImage: image
    });

    if (result.success) {
      buttonEl.innerHTML = '✅ Eklendi';
      buttonEl.classList.add('added');
      showNotification('success', '🛒', `${truncate(name, 40)} sepete eklendi`);

      // Sepeti güncelle
      await refreshCart();

      // Hedef tutarı kontrol et
      if (result.targetReached) {
        showTargetReachedBanner();
      }

      // 2 saniye sonra buton sıfırla
      setTimeout(() => {
        buttonEl.innerHTML = originalText;
        buttonEl.classList.remove('added');
        buttonEl.disabled = false;
      }, 2000);
    } else {
      buttonEl.innerHTML = originalText;
      buttonEl.disabled = false;

      if (result.needsOptions) {
        showNotification('warning', '⚠️', 'Bu ürün seçenek gerektiriyor. Siteye yönlendiriliyorsunuz.');
        if (result.redirect) {
          window.open(result.redirect, '_blank');
        }
      } else {
        showNotification('error', '❌', result.error || 'Sepete eklenemedi');
      }
    }
  } catch (err) {
    buttonEl.innerHTML = originalText;
    buttonEl.disabled = false;
    showNotification('error', '❌', 'Bağlantı hatası');
  }
}

async function refreshCart() {
  try {
    const result = await apiGet('/api/cart');
    if (result.success) {
      appState.cart = result.items || [];
      appState.cartTotal = result.total || 0;
      appState.targetAmount = result.targetAmount || 5000;
      renderCart();
      updateCartMini();
      updateProgressBar(result.total, result.targetAmount);
      updateOrderButton(result.targetReached);
    }
  } catch (err) {
    console.error('Sepet yükleme hatası:', err);
  }
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const footer = document.getElementById('cart-footer');

  if (appState.cart.length === 0) {
    container.innerHTML = `
      <div class="empty-state small">
        <div class="empty-icon">🛒</div>
        <p>Sepetiniz boş</p>
      </div>
    `;
    footer.classList.add('hidden');
    return;
  }

  footer.classList.remove('hidden');

  container.innerHTML = appState.cart.map((item, index) => `
    <div class="cart-item" style="animation-delay: ${index * 0.05}s">
      <img
        class="cart-item-img"
        src="${escapeHtml(item.image || '')}"
        alt="${escapeHtml(item.name)}"
        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%2250%25%22 x=%2250%25%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22 font-size=%2240%22>📦</text></svg>'"
      >
      <div class="cart-item-info">
        <div class="cart-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="cart-item-price">${formatPrice(item.price)} × ${item.quantity} = ${formatPrice(item.price * item.quantity)}</div>
      </div>
      <div class="cart-item-qty">
        <button onclick="handleUpdateQuantity(${index}, ${item.quantity - 1})">−</button>
        <span>${item.quantity}</span>
        <button onclick="handleUpdateQuantity(${index}, ${item.quantity + 1})">+</button>
      </div>
      <button class="cart-item-remove" onclick="handleRemoveFromCart(${index})" title="Çıkar">🗑️</button>
    </div>
  `).join('');

  // Özet
  document.getElementById('summary-count').textContent = appState.cart.reduce((sum, i) => sum + i.quantity, 0);
  document.getElementById('summary-total').textContent = formatPrice(appState.cartTotal);
}

function updateCartMini() {
  document.getElementById('cart-count').textContent = appState.cart.length;
  document.getElementById('cart-total-mini').textContent = formatPrice(appState.cartTotal);
}

function updateProgressBar(current, target) {
  const pct = Math.min(100, (current / target) * 100);
  const fill = document.getElementById('progress-fill');

  fill.style.width = pct + '%';
  fill.classList.toggle('completed', pct >= 100);

  document.getElementById('progress-amount').textContent = `${formatPrice(current)} / ${formatPrice(target)}`;
  document.getElementById('progress-remaining').textContent = current >= target
    ? '✅ Hedef tutara ulaşıldı!'
    : `Kalan: ${formatPrice(target - current)}`;
}

function updateOrderButton(targetReached) {
  const btn = document.getElementById('btn-order');
  btn.disabled = !targetReached;
  if (targetReached) {
    btn.textContent = '📦 Siparişi Tamamla';
  } else {
    btn.textContent = `📦 Hedef tutara ulaşın (${formatPrice(appState.targetAmount)})`;
  }
}

async function handleRemoveFromCart(index) {
  try {
    await apiPost('/api/cart/remove', { index });
    showNotification('success', '🗑️', 'Ürün sepetten çıkarıldı');
    await refreshCart();
  } catch (err) {
    showNotification('error', '❌', 'Ürün çıkarılamadı');
  }
}

async function handleUpdateQuantity(index, newQty) {
  if (newQty < 1) {
    handleRemoveFromCart(index);
    return;
  }

  try {
    await apiPost('/api/cart/update', { index, quantity: newQty });
    await refreshCart();
  } catch (err) {
    showNotification('error', '❌', 'Miktar güncellenemedi');
  }
}

async function handleClearCart() {
  if (!confirm('Sepeti temizlemek istediğinize emin misiniz?')) return;

  try {
    await apiPost('/api/cart/clear');
    showNotification('success', '🗑️', 'Sepet temizlendi');
    await refreshCart();
  } catch (err) {
    showNotification('error', '❌', 'Sepet temizlenemedi');
  }
}

async function handleSyncCart() {
  const btn = document.getElementById('btn-sync-cart');
  btn.innerHTML = '⏳ Senkronize ediliyor...';
  btn.disabled = true;

  try {
    const result = await apiPost('/api/cart/sync');
    if (result.success) {
      showNotification('success', '🔄', result.message);
    } else {
      showNotification('error', '❌', result.error || 'Senkronizasyon başarısız');
    }
  } catch (err) {
    showNotification('error', '❌', 'Bağlantı hatası');
  } finally {
    btn.innerHTML = '🔄 Siteye Senkronize Et';
    btn.disabled = false;
  }
}

// ==================== SİPARİŞ ====================

async function openOrderModal() {
  hideTargetBanner();

  try {
    const result = await apiGet('/api/order/summary');
    if (!result.success) {
      showNotification('error', '❌', 'Sipariş özeti alınamadı');
      return;
    }

    // Sipariş listesini render et
    const itemsContainer = document.getElementById('order-summary-items');
    itemsContainer.innerHTML = result.items.map(item => `
      <div class="order-item">
        <img
          class="order-item-img"
          src="${escapeHtml(item.image || '')}"
          alt="${escapeHtml(item.name)}"
          onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%2250%25%22 x=%2250%25%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22 font-size=%2240%22>📦</text></svg>'"
        >
        <div class="order-item-info">
          <div class="order-item-name">${escapeHtml(item.name)}</div>
          <div class="order-item-detail">${formatPrice(item.price)} × ${item.quantity} adet</div>
        </div>
        <div class="order-item-total">${formatPrice(item.totalPrice)}</div>
      </div>
    `).join('');

    document.getElementById('order-item-count').textContent = `${result.totalQuantity} adet (${result.itemCount} farklı ürün)`;
    document.getElementById('order-grand-total').textContent = formatPrice(result.total);

    document.getElementById('order-modal').classList.remove('hidden');
  } catch (err) {
    showNotification('error', '❌', 'Sipariş özeti yüklenemedi');
  }
}

function closeOrderModal() {
  document.getElementById('order-modal').classList.add('hidden');
}

async function handleConfirmOrder() {
  const btn = document.getElementById('btn-confirm-order');
  btn.innerHTML = '⏳ Sipariş oluşturuluyor...';
  btn.disabled = true;

  try {
    const result = await apiPost('/api/order/confirm');

    closeOrderModal();

    // Sonuç modalını göster
    const resultContent = document.getElementById('result-content');
    const resultTitle = document.getElementById('result-title');
    const siteLink = document.getElementById('result-site-link');

    if (result.success) {
      resultTitle.textContent = '✅ Sipariş Oluşturuldu';
      resultContent.innerHTML = `
        <div class="result-success">
          <div class="result-icon">🎉</div>
          <div class="result-message">${escapeHtml(result.message)}</div>
          <div class="result-details">
            ${(result.results || []).map(r => `
              <div class="result-detail-item">
                <span class="${r.success ? 'check' : 'cross'}">${r.success ? '✅' : '❌'}</span>
                <span>${escapeHtml(r.name)} ${r.success ? '' : '- ' + escapeHtml(r.error || 'Hata')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      siteLink.classList.remove('hidden');
      siteLink.href = result.cartUrl || 'https://www.hafizakartci.com/index.php?route=checkout/cart';

      // Sepeti temizle
      await apiPost('/api/cart/clear');
      await refreshCart();
    } else {
      resultTitle.textContent = '⚠️ Sipariş Hatası';
      resultContent.innerHTML = `
        <div class="result-success">
          <div class="result-icon">⚠️</div>
          <div class="result-message">${escapeHtml(result.message || result.error)}</div>
          ${result.results ? `
            <div class="result-details">
              ${result.results.map(r => `
                <div class="result-detail-item">
                  <span class="${r.success ? 'check' : 'cross'}">${r.success ? '✅' : '❌'}</span>
                  <span>${escapeHtml(r.name)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
      siteLink.classList.add('hidden');
    }

    document.getElementById('result-modal').classList.remove('hidden');
  } catch (err) {
    showNotification('error', '❌', 'Sipariş onay hatası: ' + err.message);
  } finally {
    btn.innerHTML = '✅ Siparişi Onayla';
    btn.disabled = false;
  }
}

function closeResultModal() {
  document.getElementById('result-modal').classList.add('hidden');
}

// ==================== AYARLAR ====================

function openSettingsModal() {
  document.getElementById('settings-modal').classList.remove('hidden');
  checkTelegramStatus();
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

async function handleLogin() {
  const email = document.getElementById('settings-email').value;
  const password = document.getElementById('settings-password').value;

  if (!email || !password) {
    showNotification('warning', '⚠️', 'E-posta ve şifre giriniz');
    return;
  }

  const btn = document.getElementById('btn-login');
  btn.innerHTML = '⏳ Giriş yapılıyor...';
  btn.disabled = true;

  setConnectionStatus('loading', 'Giriş yapılıyor...');

  try {
    const result = await apiPost('/api/login', { email, password });
    if (result.success) {
      appState.loggedIn = true;
      updateConnectionStatus(true);
      showNotification('success', '✅', 'Giriş başarılı!');
      closeSettingsModal();
    } else {
      updateConnectionStatus(false);
      showNotification('error', '❌', result.error || 'Giriş başarısız');
    }
  } catch (err) {
    updateConnectionStatus(false);
    showNotification('error', '❌', 'Bağlantı hatası');
  } finally {
    btn.innerHTML = 'Giriş Yap';
    btn.disabled = false;
  }
}

async function handleSaveSettings() {
  const target = parseInt(document.getElementById('settings-target').value);

  if (!target || target < 0) {
    showNotification('warning', '⚠️', 'Geçerli bir hedef tutar giriniz');
    return;
  }

  try {
    const result = await apiPost('/api/settings', { targetCartAmount: target });
    if (result.success) {
      appState.targetAmount = target;
      updateProgressBar(appState.cartTotal, target);
      showNotification('success', '✅', 'Ayarlar kaydedildi');
      closeSettingsModal();
    }
  } catch (err) {
    showNotification('error', '❌', 'Ayarlar kaydedilemedi');
  }
}

// ==================== TELEGRAM ====================

async function checkTelegramStatus() {
  const el = document.getElementById('telegram-status-info');
  const textEl = document.getElementById('telegram-status-text');
  const btnTest = document.getElementById('btn-telegram-test');
  const btnReport = document.getElementById('btn-telegram-report');

  if (!el) return;

  el.className = 'telegram-status';
  textEl.textContent = 'Kontrol ediliyor...';

  try {
    const res = await apiGet('/api/telegram/status');
    if (!res.success || !res.enabled) {
      el.className = 'telegram-status disconnected';
      textEl.textContent = 'Telegram bot yapılandırılmamış (.env)';
      return;
    }

    if (res.chatId) {
      el.className = 'telegram-status connected';
      textEl.textContent = `Bağlı: ${res.bot ? res.bot.name : ''} (ID: ${res.chatId})`;
      btnTest.disabled = false;
      btnReport.disabled = false;
    } else {
      el.className = 'telegram-status disconnected';
      textEl.textContent = 'Bağlı Değil (Chat ID yok)';
      btnTest.disabled = true;
      btnReport.disabled = true;
    }
  } catch (err) {
    el.className = 'telegram-status disconnected';
    textEl.textContent = 'Bağlantı hatası';
  }
}

async function handleTelegramSetup() {
  const btn = document.getElementById('btn-telegram-setup');
  const orig = btn.innerHTML;
  btn.innerHTML = '⏳ Bekleniyor...';
  btn.disabled = true;

  try {
    const res = await apiPost('/api/telegram/setup');
    if (res.success) {
      showNotification('success', '📱', res.message);
      checkTelegramStatus();
    } else {
      showNotification('error', '⚠️', res.error || 'Hata oluştu');
    }
  } catch (err) {
    showNotification('error', '❌', 'Bağlantı hatası');
  } finally {
    btn.innerHTML = orig;
    btn.disabled = false;
  }
}

async function handleTelegramTest() {
  const btn = document.getElementById('btn-telegram-test');
  btn.disabled = true;
  try {
    const res = await apiPost('/api/telegram/test');
    if (res.success) showNotification('success', '🧪', res.message);
    else showNotification('error', '❌', res.error);
  } catch (err) {
    showNotification('error', '❌', 'Bağlantı hatası');
  } finally {
    btn.disabled = false;
  }
}

async function handleTelegramReport() {
  const btn = document.getElementById('btn-telegram-report');
  btn.disabled = true;
  try {
    const res = await apiPost('/api/telegram/report');
    if (res.success) showNotification('success', '📊', res.message);
    else showNotification('error', '❌', res.error);
  } catch (err) {
    showNotification('error', '❌', 'Bağlantı hatası');
  } finally {
    btn.disabled = false;
  }
}

// ==================== UI YARDIMCILARI ====================

function updateConnectionStatus(connected) {
  const el = document.getElementById('connection-status');
  el.className = 'status-badge ' + (connected ? 'connected' : 'disconnected');
  el.querySelector('.status-text').textContent = connected ? 'Bağlı' : 'Bağlı Değil';
}

function setConnectionStatus(type, text) {
  const el = document.getElementById('connection-status');
  el.className = 'status-badge ' + type;
  el.querySelector('.status-text').textContent = text;
}

let notificationTimer = null;

function showNotification(type, icon, text) {
  const el = document.getElementById('notification');
  el.className = 'notification ' + type;
  document.getElementById('notification-icon').textContent = icon;
  document.getElementById('notification-text').textContent = text;

  if (notificationTimer) clearTimeout(notificationTimer);
  notificationTimer = setTimeout(hideNotification, 4000);
}

function hideNotification() {
  document.getElementById('notification').classList.add('hidden');
  if (notificationTimer) {
    clearTimeout(notificationTimer);
    notificationTimer = null;
  }
}

function showTargetReachedBanner() {
  document.getElementById('target-reached-banner').classList.remove('hidden');
}

function hideTargetBanner() {
  document.getElementById('target-reached-banner').classList.add('hidden');
}

// ==================== YARDIMCI FONKSİYONLAR ====================

function formatPrice(amount) {
  if (!amount && amount !== 0) return '0 ₺';
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount) + ' ₺';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '...' : str;
}

// ==================== API İSTEKLERİ ====================

async function apiGet(url) {
  const response = await fetch(API_BASE + url);
  return response.json();
}

async function apiPost(url, data) {
  const response = await fetch(API_BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {})
  });
  return response.json();
}
