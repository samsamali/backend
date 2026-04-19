const scrapeTemuProducts = require('../scrapers/temuScraper');
const saveProductsToDB = require('../services/productService');
const Company = require('../../company/models/Company'); // Import the Company model

// Controller for importing products from Temu
const importTemuProducts = async (req, res) => {
  try {
    console.log('Starting product scraping...');
    
      const { companyId } = req.body; // Ensure `companyId` is sent in the request body
      if (!companyId) {
        return res.status(400).json({ message: 'companyId is required.' });
      }

      // Validate the existence of the company
    const companyExists = await Company.findById(companyId);
    if (!companyExists) {
      return res.status(404).json({ message: 'The provided companyId does not exist.' });
    }


    const products = await scrapeTemuProducts("https://www.temu.com/uk/womens-curve-plus-o3-589.html"); // Scrape products from Temu

    if (!products || products.length === 0) {
      console.log('No products found during scraping');
      return res.status(400).json({ message: 'No products found to import' });
    }

    console.log(`Scraped ${products.length} products successfully:`, products);

    console.log('Saving products to the database...');
    await saveProductsToDB(products, 'Temu', companyId); // Save products to the database
    console.log('Products saved successfully.');

    res.status(200).json({ message: 'Products imported successfully', count: products.length });
  } catch (err) {
    console.error('Error during product import:', err); // Log the full error stack
    res.status(500).json({ message: 'Failed to import products', error: err.message });
  }
};

module.exports = { importTemuProducts };

