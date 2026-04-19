const mongoose = require('mongoose');

const sellviaDashboardSchema = new mongoose.Schema({
    dashboard_name: {
        type: String,
        required: true
    },
    jwt_token: {
        type: String,
        required: true
    },
    base_url: {
        type: String,
        default: 'https://account.sellvia.com'
    },
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
});

module.exports = mongoose.model('SellviaDashboard', sellviaDashboardSchema);