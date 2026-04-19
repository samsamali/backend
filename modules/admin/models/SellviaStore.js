const mongoose = require('mongoose');

const sellviaStoreSchema = new mongoose.Schema({
    sellvia_dashboard_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SellviaDashboard',
        required: true,
    },

    // ── Core identifiers ──────────────────────────────────────────
    store_id: {
        type: String,
        required: true,
    },
    store_name: {         // site_title from API e.g. "Prime Treasure Selection"
        type: String,
        default: '',
    },
    store_domain: {       // title from API e.g. "primetreasureselection.shop"
        type: String,
        default: '',
    },

    // ── From getInfo / getSitesListInfo response ──────────────────
    site_title: {         // same as store_name — kept separate for raw storage
        type: String,
        default: '',
    },
    value: {              // index value from API
        type: Number,
        default: 0,
    },
    api_status: {         // numeric status from API (0=Not found, 1=Active, 2=Not active, 4=?, 6=?)
        type: Number,
        default: 0,
    },
    is_active: {          // derived: true when api_status === 1
        type: Boolean,
        default: false,
    },
    service: {            // e.g. "sellvia.com"
        type: String,
        default: '',
    },
    bill_id: {
        type: Number,
        default: 0,
    },
    type_id: {            // 1 or 2 (store type)
        type: Number,
        default: 0,
    },
    sub_end_at: {         // subscription end timestamp (unix seconds)
        type: Number,
        default: 0,
    },
    created_at_remote: {  // store creation timestamp from API
        type: Number,
        default: 0,
    },
    thumbnail_url: {
        type: String,
        default: '',
    },

    // ── Sync tracking ─────────────────────────────────────────────
    last_synced_at: {     // when orders were last auto-synced from backend scheduler
        type: Date,
        default: null,
    },
    next_sync_at: {       // when next auto-sync is scheduled (used by frontend timer)
        type: Date,
        default: null,
    },
    total_orders_cached: {
        type: Number,
        default: 0,
    },
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    },
});

// Compound unique index
sellviaStoreSchema.index({ sellvia_dashboard_id: 1, store_id: 1 }, { unique: true });

module.exports = mongoose.model('SellviaStore', sellviaStoreSchema);