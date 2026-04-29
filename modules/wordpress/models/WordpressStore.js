const mongoose = require('mongoose');

const wordpressStoreSchema = new mongoose.Schema({
    store_name: {
        type: String,
        required: true,
        trim: true,
    },
    site_url: {
        type: String,
        default: '',
        trim: true,
    },
    platform: {
        type: String,
        default: 'wordpress',
    },
    token: {
        type: String,
        required: true,
        unique: true,
    },
    is_connected: {
        type: Boolean,
        default: false,
    },
    plugin_version: {
        type: String,
        default: '',
    },
    connected_at: {
        type: Date,
        default: null,
    },
    last_synced_at: {
        type: Date,
        default: null,
    },
    total_products_cached: {
        type: Number,
        default: 0,
    },
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    // Links this WP store to a SellviaStore — prevents old-token reconnection and duplicate stores
    sellvia_store_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SellviaStore',
        default: null,
        index: true,
    },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

module.exports = mongoose.model('WordpressStore', wordpressStoreSchema);
