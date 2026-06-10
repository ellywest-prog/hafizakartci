/**
 * Storage Manager - Veri kalıcılığı katmanı
 * Vercel sunucusuz (Serverless) ortamında çerezlerin ve ayarların kaybolmasını önler.
 * Vercel KV (Redis) varsa oraya yazar, yoksa yerel dosya sistemini (/tmp) kullanır.
 */

const fs = require('fs');
const path = require('path');

const isVercel = !!process.env.VERCEL;

// Vercel'de sadece /tmp yazılabilirdir
const DATA_DIR = isVercel ? '/tmp' : path.join(__dirname, '..', 'data');

const COOKIES_PATH = path.join(DATA_DIR, 'cookies.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const CHAT_ID_PATH = path.join(DATA_DIR, 'telegram_chat_id.txt');
const SEARCH_RESULTS_PATH = path.join(DATA_DIR, 'search_results.json');

// Dizin varlığını kontrol et ve oluştur
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  console.error('Storage dizini olusturma hatasi:', e.message);
}

// Vercel KV (Redis) yapılandırması
const hasKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

/**
 * Vercel KV REST API'sine istek atar
 */
async function kvRequest(command, args = []) {
  if (!hasKV) return null;
  try {
    const response = await fetch(`${process.env.KV_REST_API_URL}/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([command, ...args])
    });
    const result = await response.json();
    return result.result;
  } catch (err) {
    console.error('Vercel KV baglanti hatasi:', err.message);
    return null;
  }
}

/**
 * Sunucu başlarken KV'deki verileri yerel /tmp/ dosyalarıyla eşitler
 */
async function initStorage() {
  console.log(`📦 Storage baslatiliyor (Vercel ortamı: ${isVercel}, KV: ${hasKV})`);
  
  if (hasKV) {
    try {
      // 1. Ayarları al ve yaz
      const settingsVal = await kvRequest('GET', ['settings']);
      if (settingsVal) {
        fs.writeFileSync(SETTINGS_PATH, settingsVal, 'utf8');
        console.log('✅ Ayarlar KV\'den yuklendi ve esitlendi.');
      }
      
      // 2. Çerezleri al ve yaz
      const cookiesVal = await kvRequest('GET', ['cookies']);
      if (cookiesVal) {
        fs.writeFileSync(COOKIES_PATH, cookiesVal, 'utf8');
        console.log('✅ Cerezler KV\'den yuklendi ve esitlendi.');
      }

      // 3. Telegram Chat ID al ve yaz/ortama ekle
      const chatIdVal = await kvRequest('GET', ['telegram_chat_id']);
      if (chatIdVal) {
        fs.writeFileSync(CHAT_ID_PATH, chatIdVal, 'utf8');
        process.env.TELEGRAM_CHAT_ID = chatIdVal;
        console.log('✅ Telegram Chat ID KV\'den yuklendi:', chatIdVal);
      }
    } catch (err) {
      console.error('Storage esitleme hatasi:', err.message);
    }
  } else {
    // KV yoksa ve yerel ortamdaysak, zaten dosyalar data/ içinde vardır.
    // Eğer Vercel'deysek ve Chat ID env'den geliyorsa ortama aktaralım
    if (process.env.TELEGRAM_CHAT_ID) {
      try {
        fs.writeFileSync(CHAT_ID_PATH, process.env.TELEGRAM_CHAT_ID, 'utf8');
      } catch {}
    }
  }
}

/**
 * Ayarları getirir (Senkron)
 */
function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('Ayarlar okunurken hata:', err.message);
  }
  return { targetCartAmount: 5000, maxSearchResults: 12, currency: 'TL' };
}

/**
 * Ayarları kaydeder (Senkron kaydeder, KV'ye arka planda yazar)
 */
function saveSettings(settings) {
  try {
    const settingsStr = JSON.stringify(settings, null, 2);
    fs.writeFileSync(SETTINGS_PATH, settingsStr, 'utf8');
    
    if (hasKV) {
      kvRequest('SET', ['settings', settingsStr]).catch(err => {
        console.error('KV ayar kaydetme hatasi:', err.message);
      });
    }
    return true;
  } catch (err) {
    console.error('Ayarlar kaydedilirken hata:', err.message);
    return false;
  }
}

/**
 * Çerezleri getirir (Senkron)
 */
function getCookies() {
  try {
    if (fs.existsSync(COOKIES_PATH)) {
      return JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('Cerezler okunurken hata:', err.message);
  }
  return { cookies: {}, loggedIn: false };
}

/**
 * Çerezleri kaydeder
 */
function saveCookies(cookiesData) {
  try {
    const cookiesStr = JSON.stringify(cookiesData, null, 2);
    fs.writeFileSync(COOKIES_PATH, cookiesStr, 'utf8');
    
    if (hasKV) {
      kvRequest('SET', ['cookies', cookiesStr]).catch(err => {
        console.error('KV cerez kaydetme hatasi:', err.message);
      });
    }
    return true;
  } catch (err) {
    console.error('Cerezler kaydedilirken hata:', err.message);
    return false;
  }
}

/**
 * Telegram Chat ID getirir (Senkron)
 */
function getTelegramChatId() {
  if (process.env.TELEGRAM_CHAT_ID) {
    return process.env.TELEGRAM_CHAT_ID;
  }
  try {
    if (fs.existsSync(CHAT_ID_PATH)) {
      return fs.readFileSync(CHAT_ID_PATH, 'utf8').trim();
    }
  } catch {}
  return '';
}

/**
 * Telegram Chat ID kaydeder
 */
function saveTelegramChatId(chatId) {
  try {
    fs.writeFileSync(CHAT_ID_PATH, chatId, 'utf8');
    process.env.TELEGRAM_CHAT_ID = chatId;

    if (hasKV) {
      kvRequest('SET', ['telegram_chat_id', chatId]).catch(err => {
        console.error('KV chat ID kaydetme hatasi:', err.message);
      });
    }

    // Yerel ortamdaysak .env dosyasını da güncel tutalım
    if (!isVercel) {
      try {
        const envPath = path.join(__dirname, '..', '.env');
        if (fs.existsSync(envPath)) {
          let envContent = fs.readFileSync(envPath, 'utf8');
          if (envContent.includes('TELEGRAM_CHAT_ID=')) {
            envContent = envContent.replace(/TELEGRAM_CHAT_ID=.*/, `TELEGRAM_CHAT_ID=${chatId}`);
          } else {
            envContent += `\nTELEGRAM_CHAT_ID=${chatId}`;
          }
          fs.writeFileSync(envPath, envContent, 'utf8');
        }
      } catch {}
    }
    return true;
  } catch (err) {
    console.error('Telegram Chat ID kaydedilirken hata:', err.message);
    return false;
  }
}

/**
 * Arama sonuçlarını getirir (Senkron)
 */
function getLastSearchResults() {
  try {
    if (fs.existsSync(SEARCH_RESULTS_PATH)) {
      return JSON.parse(fs.readFileSync(SEARCH_RESULTS_PATH, 'utf8'));
    }
  } catch {}
  return [];
}

/**
 * Arama sonuçlarını kaydeder
 */
function saveLastSearchResults(results) {
  try {
    const dataStr = JSON.stringify(results);
    fs.writeFileSync(SEARCH_RESULTS_PATH, dataStr, 'utf8');
    if (hasKV) {
      kvRequest('SET', ['search_results', dataStr]).catch(()=>{});
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  isVercel,
  COOKIES_PATH,
  SETTINGS_PATH,
  CHAT_ID_PATH,
  initStorage,
  getSettings,
  saveSettings,
  getCookies,
  saveCookies,
  getTelegramChatId,
  saveTelegramChatId,
  getLastSearchResults,
  saveLastSearchResults
};
