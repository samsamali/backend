const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const {TemuSelectors, SupplierXSelectors, SupplierYSelectors}  = require('../../../config/selectors');

async function scrapeTemuProducts(pageUrl) {
  const browser = await puppeteer.launch({ headless: false }); // Non-headless for debugging
  const page = await browser.newPage();

  try {
    // Set User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // Navigate to the page
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    
    
    // Wait for the selector or log a screenshot for debugging
    await page.waitForSelector(TemuSelectors.product_card, { timeout: 60000 });

    // Extract product data
    const products = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('div._6q6qVUF5._1UrrHYym')).map(product => {
        const title = product.getAttribute('data-tooltip-title');
        const image = product.querySelector('div.img.goods-img-external')?.getAttribute('src');
        const priceContainer = product.querySelector('div._382YgpSF');
        const price = priceContainer ? priceContainer.textContent.trim() : null;
        const productId = product.querySelector('div._6q6qVUF5._1QhQr8pq.goods-image-container-external')?.getAttribute('data-tooltip')?.split('-')[1];
        const productUrl = product.querySelector('a._2Tl9qLr1._1ak1dai3')?.getAttribute('href');

        return {
          title,
          image,
          price,
          productId,
          productUrl: productUrl ? `https://temu.com${productUrl}` : null,
        };
      });
    });

    console.log('Extracted Products:', products);

    await browser.close();
    return products;
  } catch (error) {
    console.error('Error scraping Temu products:', error);
    await page.screenshot({ "../images": 'error-screenshot.png', fullPage: true }); // Save screenshot for debugging
    await browser.close();
    throw error;
  }
}


module.exports = scrapeTemuProducts;