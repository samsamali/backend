const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  title: String,
  description: String,
  price: String,
  images: [String],
  category: String, // Supplier-specific category
  stock: Number,
  supplier: {
    name: String, // e.g., "Temu"
    productId: String, // Unique ID from supplier
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true, // Ensure products are tied to a company
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Product', productSchema);
