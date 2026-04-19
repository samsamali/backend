const mongoose = require('mongoose');

const SellviaHomeSchema = new mongoose.Schema({
    sellvia_dashboard_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SellviaDashboard',
        required: true,
        index: true
    },
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    // Financial data from getMyAccountData API
    total_earnings: { type: Number, default: 0 },
    total_earnings_display: { type: String, default: '0.00' },
    amount_wallet: { type: Number, default: 0 },
    amount_payout: { type: Number, default: 0 },
    amount_payout_display: { type: String, default: '0.00' },
    balance_summary: { type: Number, default: 0 },
    balance_summary_display: { type: String, default: '0.00' },
    balance: { type: Number, default: 0 },
    balance_all_display: { type: String, default: '0.00' },
    
    // FastSource balance details
    fastsource_balance: {
        service_id: { type: Number, default: 0 },
        store_id: { type: Number, default: 0 },
        amount: { type: Number, default: 0 },
        amount_payout: { type: Number, default: 0 },
        payout_fee: { type: Number, default: 0 },
        amount_payment: { type: Number, default: 0 },
        amount_wallet: { type: Number, default: 0 },
        amount_risk: { type: Number, default: 0 },
        amount_pending: { type: Number, default: 0 }
    },
    
    // Progress data for the progress bar
    progress: {
        available_display: { type: String, default: '0.00' },
        available_pr: { type: Number, default: 0 },
        incoming_display: { type: String, default: '0.00' },
        incoming_pr: { type: Number, default: 0 },
        amount_pending_display: { type: String, default: '0.00' },
        amount_pending_pr: { type: Number, default: 0 },
        reserves_display: { type: String, default: '0.00' },
        reserves_pr: { type: Number, default: 100 }
    },
    
    show_withdraw: { type: Boolean, default: false },
    
    // Store-specific data (if we want to track per store)
    store_id: { type: String, default: null },
    
    // Raw API response for backup
    raw_response: { type: Object, default: {} },
    
    last_synced_at: { type: Date, default: Date.now },
    created_at: { type: Date, default: Date.now }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// Compound index for efficient queries
SellviaHomeSchema.index({ sellvia_dashboard_id: 1, store_id: 1 });

module.exports = mongoose.model('SellviaHome', SellviaHomeSchema);