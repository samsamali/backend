const Product = require('../models/Product');

async function saveProductsToDB(products, supplierName, companyId) {
    console.log('Saving products to DB:', products); // Add this
  if (!products.length) {
    console.log('No products to save');
    return;
  }
  const productDocs = products.map(product => ({
    ...product,
    supplier: {
      name: supplierName,
      productId: product.productId,
    },
    companyId,
  }));

  try {
    await Product.insertMany(productDocs);
    console.log('Products saved successfully!');
  } catch (err) {
    console.error('Error saving products:', err);
  }
}

module.exports = saveProductsToDB;
