const mongoose = require('mongoose');

// ================================================================
//  CompanyStore Model
//  Bridge table — Company ko kaun se Sellvia Stores assigned hain
//  Super admin CompanyStoreManager page se manage karta hai
// ================================================================

const companyStoreSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        store_id: {
            type: String,
            required: true,
            trim: true,
            // Sellvia store_id e.g. "373297"
        },
        store_name: {
            type: String,
            default: '',
            trim: true,
        },
        store_domain: {
            type: String,
            default: '',
            trim: true,
        },
        thumbnail_url: {
            type: String,
            default: '',
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
);

// Compound index — ek company mein ek store ek baar hi hoga
companyStoreSchema.index({ companyId: 1, store_id: 1 }, { unique: true });

module.exports = mongoose.model('CompanyStore', companyStoreSchema);