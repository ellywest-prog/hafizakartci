/**
 * Searcher - Ürün arama motoru
 * hafizakartci.com'da ürün arar ve sonuçları parse eder
 */

const BASE_URL = 'https://www.hafizakartci.com';

class Searcher {
  constructor(browserAgent) {
    this.browser = browserAgent;
  }

  /**
   * Ürün ara
   */
  async search(query, options = {}) {
    try {
      const {
        page = 1,
        sort = 'pd.name',
        order = 'ASC',
        limit = 12
      } = options;

      const searchUrl = `${BASE_URL}/index.php?route=product/search` +
        `&search=${encodeURIComponent(query)}` +
        `&sub_category=1` +
        `&description=0` +
        `&sort=${sort}` +
        `&order=${order}` +
        `&limit=${limit}` +
        `&page=${page}`;

      console.log(`🔍 Aranıyor: "${query}" (sayfa ${page})`);

      const response = await this.browser.request(searchUrl);
      const products = this.parseProducts(response.body);
      const totalInfo = this.parsePagination(response.body);

      console.log(`📦 ${products.length} ürün bulundu`);

      return {
        success: true,
        query,
        products,
        page,
        ...totalInfo
      };
    } catch (err) {
      console.error('Arama hatası:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * İndirimdeki ürünleri (Specials) getir
   */
  async getSpecials(page = 1) {
    try {
      const url = `${BASE_URL}/index.php?route=product/special&page=${page}&limit=100`;
      const response = await this.browser.request(url);
      
      const products = this.parseProducts(response.body);
      
      // Sadece gerçekten indirimli (eski fiyatı olan) ürünleri filtrele
      const discountedProducts = products.filter(p => p.oldPrice > 0 && p.price < p.oldPrice);
      
      return {
        success: true,
        products: discountedProducts
      };
    } catch (err) {
      console.error('İndirimleri çekerken hata:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * HTML'den ürünleri parse et
   */
  parseProducts(html) {
    const products = [];

    // product-thumb blokları bul
    const productRegex = /<div[^>]*class="[^"]*product-thumb[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*product-thumb[^"]*"|<div[^>]*class="[^"]*pagination|<\/main|<footer)/g;

    // Alternatif: product-layout bloklarını bul
    const layoutRegex = /<div[^>]*class="[^"]*product-layout[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*product-layout[^"]*"|<nav|<div[^>]*class="[^"]*pagination|<\/main|<footer)/g;

    let matches = [];
    let match;

    // Önce product-layout dene
    while ((match = layoutRegex.exec(html)) !== null) {
      matches.push(match[0]);
    }

    // Eğer bulunamazsa product-thumb dene
    if (matches.length === 0) {
      while ((match = productRegex.exec(html)) !== null) {
        matches.push(match[0]);
      }
    }

    for (const block of matches) {
      const product = this.parseProductBlock(block);
      if (product) {
        products.push(product);
      }
    }

    return products;
  }

  /**
   * Tek bir ürün bloğunu parse et
   */
  parseProductBlock(html) {
    try {
      // Ürün adı
      const nameMatch = html.match(/<(?:h4|div)[^>]*class="[^"]*name[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
        || html.match(/<h4[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
        || html.match(/<a[^>]*href="([^"]*)"[^>]*title="([^"]*)"[^>]*>/i);

      if (!nameMatch) return null;

      const url = nameMatch[1];
      const name = (nameMatch[2] || '').replace(/<[^>]+>/g, '').trim();

      // Product ID
      let productId = null;
      const idMatch = html.match(/cart\.add\(['"]\s*(\d+)/i)
        || html.match(/product_id[=:][\s'"]*(\d+)/i)
        || (url && url.match(/product_id=(\d+)/i));
      if (idMatch) productId = idMatch[1];

      // Resim
      let image = '';
      const imgMatch = html.match(/<img[^>]*(?:data-src|src)="([^"]*)"[^>]*(?:class="[^"]*"|alt=)/i)
        || html.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      if (imgMatch) {
        image = imgMatch[1];
        if (image.startsWith('//')) image = 'https:' + image;
        else if (!image.startsWith('http')) image = BASE_URL + '/' + image;
      }

      // Fiyat
      let price = 0;
      let priceText = '';
      const priceMatch = html.match(/<(?:span|div|p)[^>]*class="[^"]*price-new[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/i)
        || html.match(/<(?:span|div|p)[^>]*class="[^"]*price[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/i);

      if (priceMatch) {
        priceText = priceMatch[1].replace(/<[^>]+>/g, '').trim();
        // Fiyat parse: "149,90 TL" veya "₺149.90"
        const numMatch = priceText.replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.');
        price = parseFloat(numMatch) || 0;
      }

      // İndirimli fiyat kontrolü
      let oldPrice = 0;
      let oldPriceText = '';
      const oldPriceMatch = html.match(/<(?:span|div|p)[^>]*class="[^"]*price-old[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/i);
      if (oldPriceMatch) {
        oldPriceText = oldPriceMatch[1].replace(/<[^>]+>/g, '').trim();
        const oldNumMatch = oldPriceText.replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.');
        oldPrice = parseFloat(oldNumMatch) || 0;
      }

      // Stok durumu
      const inStock = !html.includes('out-of-stock') && !html.includes('Stokta Yok');

      // Model / SKU
      let model = '';
      const modelMatch = html.match(/model[^>]*>([^<]+)/i);
      if (modelMatch) model = modelMatch[1].trim();

      return {
        productId,
        name,
        url: url && !url.startsWith('http') ? BASE_URL + '/' + url : url,
        image,
        price,
        priceText,
        oldPrice,
        oldPriceText,
        inStock,
        model
      };
    } catch (err) {
      console.error('Ürün parse hatası:', err.message);
      return null;
    }
  }

  /**
   * Sayfalama bilgisini parse et
   */
  parsePagination(html) {
    let totalProducts = 0;
    let totalPages = 1;

    // "X - Y arası gösteriliyor (Toplam Z)" formatı
    const totalMatch = html.match(/(?:Toplam|toplam)\s*(\d+)/i)
      || html.match(/(\d+)\s*(?:ürün|sonuç)/i);
    if (totalMatch) {
      totalProducts = parseInt(totalMatch[1]) || 0;
    }

    // Sayfa sayısı
    const pageLinks = html.match(/<a[^>]*page=(\d+)/g);
    if (pageLinks) {
      for (const link of pageLinks) {
        const pageNum = parseInt(link.match(/page=(\d+)/)[1]);
        if (pageNum > totalPages) totalPages = pageNum;
      }
    }

    return { totalProducts, totalPages };
  }

  /**
   * Ürün detaylarını getir
   */
  async getProductDetails(productUrl) {
    const response = await this.browser.request(productUrl);
    const product = this.parseProductDetail(response.body);
    return product;
  }

  /**
   * Ürün detay sayfasını parse et
   */
  parseProductDetail(html) {
    try {
      // Ürün adı
      const nameMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
      const name = nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      // Product ID
      const idMatch = html.match(/product_id['":\s]*['"]?(\d+)/);
      const productId = idMatch ? idMatch[1] : null;

      // Fiyat
      let price = 0;
      let priceText = '';
      const priceMatch = html.match(/<(?:span|li)[^>]*class="[^"]*product-price[^"]*"[^>]*>([\s\S]*?)<\/(?:span|li)>/i)
        || html.match(/<(?:span|div)[^>]*class="[^"]*price-new[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/i);
      if (priceMatch) {
        priceText = priceMatch[1].replace(/<[^>]+>/g, '').trim();
        const numMatch = priceText.replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.');
        price = parseFloat(numMatch) || 0;
      }

      // Açıklama
      const descMatch = html.match(/<div[^>]*id="tab-description"[^>]*>([\s\S]*?)<\/div>/i);
      const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 500) : '';

      // Resimler
      const images = [];
      const imgMatches = html.matchAll(/<a[^>]*class="[^"]*thumbnail[^"]*"[^>]*href="([^"]*)"[^>]*>/g);
      for (const m of imgMatches) {
        images.push(m[1]);
      }

      // Seçenekler (renk, boyut vb.)
      const options = [];
      const optionsSection = html.match(/id="product"[\s\S]*?name="quantity"/);
      if (optionsSection) {
        const sectionHtml = optionsSection[0];
        const groups = sectionHtml.split(/class="form-group[^"]*"/);
        
        for (let i = 1; i < groups.length; i++) {
          const groupHtml = groups[i];
          const labelMatch = groupHtml.match(/<label[^>]*>([^<]+)<\/label>/);
          if (!labelMatch) continue;
          
          const optionName = labelMatch[1].trim();
          const optionValues = [];
          let optionId = null;
          
          // Dropdowns
          const selectMatch = groupHtml.match(/name="option\[(\d+)\]"[\s\S]*?<select([\s\S]*?)<\/select>/);
          if (selectMatch) {
            optionId = selectMatch[1];
            const optionsMatches = [...selectMatch[2].matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/g)];
            for (const opt of optionsMatches) {
              if (opt[1]) optionValues.push({ id: opt[1], name: opt[2].trim() });
            }
          }
          
          // Radios
          const radios = [...groupHtml.matchAll(/name="option\[(\d+)\]"\s*value="(\d+)"([^>]*)(?:>|[\s\S]*?<\/label>)/g)];
          if (radios.length > 0) {
            for (const radio of radios) {
              optionId = radio[1];
              const valueId = radio[2];
              const attrs = radio[3];
              
              // Extract name from title or aria-label
              const titleMatch = attrs.match(/(?:title|aria-label)="([^"]+)"/);
              let text = titleMatch ? titleMatch[1].trim() : "";
              
              // If not in title, extract from label text
              if (!text) {
                const textMatch = radio[0].match(/>\s*([^<]+)\s*$/);
                if (textMatch) text = textMatch[1].trim();
              }
              
              if (!text) text = "Seçenek " + valueId;
              
              optionValues.push({ id: valueId, name: text });
            }
          }
          
          if (optionId && optionValues.length > 0) {
            options.push({ id: optionId, name: optionName, values: optionValues });
          }
        }
      }

      return {
        productId,
        name,
        price,
        priceText,
        description,
        images,
        options
      };
    } catch (err) {
      console.error('Ürün detay parse hatası:', err.message);
      return null;
    }
  }
}

module.exports = { Searcher };
