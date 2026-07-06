/**
 * Browser Agent - HTTP tabanlı site etkileşimi
 * hafizakartci.com ile oturum yönetimi ve HTTP istekleri
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const storage = require('./storage');

const BASE_URL = 'https://www.hafizakartci.com';

class BrowserAgent {
  constructor() {
    this.cookies = {};
    this.loggedIn = false;
    this._reloginInProgress = false;
    this.loadCookies();
  }

  /**
   * Cookie'leri dosyadan yükle
   */
  loadCookies() {
    try {
      const data = storage.getCookies();
      this.cookies = data.cookies || {};
      this.loggedIn = data.loggedIn || false;
      if (this.loggedIn) {
        console.log('🍪 Kayıtlı çerezler yüklendi (loggedIn:', this.loggedIn, ')');
      }
    } catch {
      this.cookies = {};
      this.loggedIn = false;
    }
  }

  /**
   * Cookie'leri dosyaya kaydet
   */
  saveCookies() {
    try {
      storage.saveCookies({
        cookies: this.cookies,
        loggedIn: this.loggedIn,
        savedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('Cookie kaydetme hatası:', err.message);
    }
  }

  /**
   * Cookie string oluştur
   */
  getCookieString() {
    return Object.entries(this.cookies)
      .map(([key, val]) => `${key}=${val}`)
      .join('; ');
  }

  /**
   * Set-Cookie header'ından cookie'leri parse et
   */
  parseCookies(setCookieHeaders) {
    if (!setCookieHeaders) return;
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const header of headers) {
      const parts = header.split(';')[0].trim().split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim();
        this.cookies[key] = val;
      }
    }
  }

  /**
   * HTTP isteği gönder
   */
  request(urlStr, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr, BASE_URL);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cookie': this.getCookieString(),
          ...options.headers
        }
      };

      if (options.body) {
        reqOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        reqOptions.headers['Content-Length'] = Buffer.byteLength(options.body);
      }

      const req = lib.request(reqOptions, (res) => {
        // Cookie'leri kaydet
        this.parseCookies(res.headers['set-cookie']);

        // Redirect takip et
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, BASE_URL).toString();

          // Redirect body'yi tüket
          res.resume();

          return this.request(redirectUrl, {
            ...options,
            method: 'GET',
            body: undefined
          }).then(resolve).catch(reject);
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      });

      req.on('error', reject);

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  /**
   * Giriş durumunu kontrol et
   */
  isLoggedIn() {
    return this.loggedIn;
  }

  /**
   * Siteye giriş yap
   */
  async login(email, password) {
    console.log('🔐 Giriş yapılıyor:', email);

    // Önce ana sayfayı ziyaret et (session cookie almak için)
    await this.request(BASE_URL);

    // Giriş sayfasını aç
    await this.request(`${BASE_URL}/index.php?route=account/login`);

    // Giriş yap
    const loginBody = `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;
    const response = await this.request(`${BASE_URL}/index.php?route=account/login`, {
      method: 'POST',
      body: loginBody,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `${BASE_URL}/index.php?route=account/login`
      }
    });

    // Başarılı giriş kontrolü - hesap sayfasına yönlendirilir
    const isSuccess = response.body.includes('account/account') ||
                      response.body.includes('Hesabım') ||
                      response.body.includes('route=account/logout') ||
                      response.statusCode === 302;

    if (isSuccess) {
      this.loggedIn = true;
      this.saveCookies();
      console.log('✅ Giriş başarılı!');
      return { loggedIn: true };
    }

    // Hata mesajı çıkar
    const errorMatch = response.body.match(/class="alert[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const errorMsg = errorMatch
      ? errorMatch[1].replace(/<[^>]+>/g, '').trim()
      : 'Bilinmeyen giriş hatası';

    throw new Error(errorMsg);
  }

  /**
   * Çıkış yap
   */
  async logout() {
    await this.request(`${BASE_URL}/index.php?route=account/logout`);
    this.loggedIn = false;
    this.cookies = {};
    this.saveCookies();
    console.log('🔴 Çıkış yapıldı');
  }

  /**
   * Oturum geçerliliğini kontrol et
   */
  async checkSession() {
    try {
      const response = await this.request(`${BASE_URL}/index.php?route=account/account`);
      const isValid = response.body.includes('route=account/logout');
      
      if (this.loggedIn && !isValid) {
        console.log('⚠️ Oturum süresi dolmuş, cookie\'ler geçersiz.');
      }
      
      this.loggedIn = isValid;
      this.saveCookies();
      return isValid;
    } catch {
      this.loggedIn = false;
      return false;
    }
  }

  /**
   * Oturumun geçerli olduğundan emin ol.
   * Geçersizse çevresel değişkenlerden otomatik yeniden giriş yapar.
   * @returns {boolean} Oturum geçerliyse true
   */
  async ensureLoggedIn() {
    // Zaten yeniden giriş yapılıyor
    if (this._reloginInProgress) return this.loggedIn;

    // Önce mevcut oturumu kontrol et
    if (this.loggedIn) {
      const sessionValid = await this.checkSession();
      if (sessionValid) return true;
    }

    // Oturum geçersiz, otomatik yeniden giriş dene
    const email = process.env.HAFIZAKARTCI_EMAIL;
    const password = process.env.HAFIZAKARTCI_PASSWORD;

    if (!email || !password) {
      console.error('❌ Otomatik yeniden giriş yapılamıyor: Giriş bilgileri yok.');
      return false;
    }

    this._reloginInProgress = true;
    try {
      console.log('🔄 Otomatik yeniden giriş yapılıyor...');
      await this.login(email, password);
      console.log('✅ Otomatik yeniden giriş başarılı!');
      return true;
    } catch (err) {
      console.error('❌ Otomatik yeniden giriş başarısız:', err.message);
      return false;
    } finally {
      this._reloginInProgress = false;
    }
  }
}

module.exports = { BrowserAgent };
