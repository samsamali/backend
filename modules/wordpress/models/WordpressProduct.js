const mongoose = require('mongoose');

const wordpressProductSchema = new mongoose.Schema({
    wp_store_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WordpressStore',
        required: true,
    },
    site_url: {
        type: String,
        default: '',
    },
    store_name: {
        type: String,
        default: '',
    },
    wp_product_id: {
        type: Number,
        required: true,
    },
    name: {
        type: String,
        default: '',
    },
    slug: {
        type: String,
        default: '',
    },
    description: {
        type: String,
        default: '',
    },
    short_description: {
        type: String,
        default: '',
    },
    sku: {
        type: String,
        default: '',
    },
    price: {
        type: String,
        default: '0',
    },
    regular_price: {
        type: String,
        default: '0',
    },
    sale_price: {
        type: String,
        default: '',
    },
    stock_status: {
        type: String,
        default: 'instock',
    },
    stock_quantity: {
        type: Number,
        default: 0,
    },
    images: [{
        id:  { type: Number, default: 0 },
        src: { type: String, default: '' },
        alt: { type: String, default: '' },
    }],
    categories: [{
        id:   { type: Number, default: 0 },
        name: { type: String, default: '' },
        slug: { type: String, default: '' },
    }],
    tags: [{
        id:   { type: Number, default: 0 },
        name: { type: String, default: '' },
    }],
    status: {
        type: String,
        default: 'publish',
    },
    date_created: {
        type: String,
        default: '',
    },
    currency: {
        type: String,
        default: 'USD',
    },
    synced_at: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

// One product per (store, wp_product_id) — upsert-safe
wordpressProductSchema.index({ wp_store_id: 1, wp_product_id: 1 }, { unique: true });

module.exports = mongoose.model('WordpressProduct', wordpressProductSchema);
