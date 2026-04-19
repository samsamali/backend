const mongoose = require('mongoose');

// ================================================================
//  UserCompany Model
//  User aur Company ka link
//  Jab user login kare → is table se companyId nikalo
//  → CompanyStore se allowedStoreIds nikalo
//  → JWT mein save karo
// ================================================================

const userCompanySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Company',
            required: true,
            index: true,
        },
        // Role within company — future use ke liye
        role: {
            type: String,
            enum: ['owner', 'member', 'viewer'],
            default: 'member',
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        assignedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
);

// Ek user sirf ek company mein ho sakta hai (unique)
userCompanySchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('UserCompany', userCompanySchema);