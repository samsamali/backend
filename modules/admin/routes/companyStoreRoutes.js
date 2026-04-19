const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { verifyToken } = require('../../../modules/auth/middlewares/authMiddleware');
const CompanyStore = require('../models/CompanyStore');
const UserCompany  = require('../models/UserCompany');
const SellviaStore = require('../models/SellviaStore');

// ── Helper ────────────────────────────────────────────────────────
const isSuperAdmin = (req) =>
    req.user?.role === 'super-admin' || req.user?.role === 'superadmin';

const toObjId = (id) => {
    try { return new mongoose.Types.ObjectId(String(id)); }
    catch (_) { return null; }
};

// ================================================================
//  GET /api/company-stores
//  All companies with their assigned store count + store list
//  Super-admin only
// ================================================================
router.get('/', verifyToken, async (req, res) => {
    try {
        if (!isSuperAdmin(req))
            return res.status(403).json({ success: false, error: 'Forbidden' });

        // Get Company model dynamically (already exists in project)
        const Company = require('../models/Company');

        const companies = await Company.find({}).lean();

        // For each company → get assigned stores
        const result = await Promise.all(companies.map(async (company) => {
            const assignedStores = await CompanyStore.find({
                companyId: company._id,
                isActive: true,
            }).lean();

            return {
                _id:         company._id,
                name:        company.name        || company.company_name || '',
                email:       company.email        || '',
                phone:       company.phone        || '',
                description: company.description  || '',
                isActive:    company.isActive,
                storeCount:  assignedStores.length,
                stores:      assignedStores,
            };
        }));

        console.log(`[CompanyStores] GET / → ${result.length} companies`);
        res.json({ success: true, companies: result });
    } catch (err) {
        console.error('[CompanyStores] GET / error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ================================================================
//  GET /api/company-stores/:companyId/stores
//  Get assigned stores for ONE company
// ================================================================
router.get('/:companyId/stores', verifyToken, async (req, res) => {
    try {
        if (!isSuperAdmin(req))
            return res.status(403).json({ success: false, error: 'Forbidden' });

        const { companyId } = req.params;

        const assigned = await CompanyStore.find({
            companyId: toObjId(companyId),
            isActive: true,
        }).lean();

        console.log(`[CompanyStores] GET /${companyId}/stores → ${assigned.length} stores`);
        res.json({ success: true, stores: assigned });
    } catch (err) {
        console.error('[CompanyStores] GET stores error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ================================================================
//  GET /api/company-stores/all-sellvia-stores
//  Get ALL sellvia stores (for the "Available" list in UI)
// ================================================================
router.get('/all-sellvia-stores', verifyToken, async (req, res) => {
    try {
        if (!isSuperAdmin(req))
            return res.status(403).json({ success: false, error: 'Forbidden' });

        const stores = await SellviaStore.find({})
            .sort({ store_name: 1 })
            .lean();

        console.log(`[CompanyStores] all-sellvia-stores → ${stores.length} stores`);
        res.json({ success: true, stores });
    } catch (err) {
        console.error('[CompanyStores] all-sellvia-stores error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ================================================================
//  POST /api/company-stores/:companyId/stores
//  Assign stores to a company (replaces existing assignment)
//  Body: { store_ids: ["373297", "397445"] }
// ================================================================
router.post('/:companyId/stores', verifyToken, async (req, res) => {
    try {
        if (!isSuperAdmin(req))
            return res.status(403).json({ success: false, error: 'Forbidden' });

        const { companyId } = req.params;
        const { store_ids } = req.body;

        if (!Array.isArray(store_ids))
            return res.status(400).json({ success: false, error: 'store_ids must be an array' });

        const companyObjId = toObjId(companyId);
        if (!companyObjId)
            return res.status(400).json({ success: false, error: 'Invalid companyId' });

        // Fetch store details from SellviaStore
        const sellviaStores = await SellviaStore.find({
            store_id: { $in: store_ids }
        }).lean();

        const storeMap = {};
        sellviaStores.forEach(s => { storeMap[s.store_id] = s; });

        // Remove all existing assignments for this company
        await CompanyStore.deleteMany({ companyId: companyObjId });

        // Insert new assignments
        const insertDocs = store_ids.map(sid => ({
            companyId:     companyObjId,
            store_id:      String(sid),
            store_name:    storeMap[sid]?.store_name    || storeMap[sid]?.site_title || `Store ${sid}`,
            store_domain:  storeMap[sid]?.store_domain  || '',
            thumbnail_url: storeMap[sid]?.thumbnail_url || '',
            isActive:      true,
            addedBy:       toObjId(req.user.id),
        }));

        let saved = [];
        if (insertDocs.length > 0) {
            saved = await CompanyStore.insertMany(insertDocs);
        }

        console.log(`[CompanyStores] POST /${companyId}/stores → saved ${saved.length} stores`);

        // Update JWT-cached allowedStoreIds for all users of this company
        // (handled on next login — no immediate action needed)

        res.json({
            success: true,
            message: `${saved.length} stores assigned to company`,
            stores:  saved,
        });
    } catch (err) {
        console.error('[CompanyStores] POST stores error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ================================================================
//  DELETE /api/company-stores/:companyId/stores/:storeId
//  Remove one store from a company
// ================================================================
router.delete('/:companyId/stores/:storeId', verifyToken, async (req, res) => {
    try {
        if (!isSuperAdmin(req))
            return res.status(403).json({ success: false, error: 'Forbidden' });

        const { companyId, storeId } = req.params;

        const result = await CompanyStore.deleteOne({
            companyId: toObjId(companyId),
            store_id:  String(storeId),
        });

        console.log(`[CompanyStores] DELETE /${companyId}/stores/${storeId} → deleted ${result.deletedCount}`);
        res.json({
            success: true,
            message: result.deletedCount > 0
                ? 'Store removed from company'
                : 'Store was not assigned to this company',
            deletedCount: result.deletedCount,
        });
    } catch (err) {
        console.error('[CompanyStores] DELETE store error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ================================================================
//  GET /api/company-stores/user-stores/:userId
//  Get stores for a specific user (based on their company)
//  Used internally + for user-facing store lists
// ================================================================
router.get('/user-stores/:userId', verifyToken, async (req, res) => {
    try {
        const { userId } = req.params;

        // Only super-admin OR the user themselves
        if (!isSuperAdmin(req) && req.user.id !== userId)
            return res.status(403).json({ success: false, error: 'Forbidden' });

        const userCompany = await UserCompany.findOne({
            userId: toObjId(userId),
            isActive: true,
        });

        if (!userCompany)
            return res.json({ success: true, stores: [], allowedStoreIds: [] });

        const companyStores = await CompanyStore.find({
            companyId: userCompany.companyId,
            isActive: true,
        }).lean();

        const allowedStoreIds = companyStores.map(s => s.store_id);

        console.log(`[CompanyStores] user-stores/${userId} → companyId=${userCompany.companyId} stores=${allowedStoreIds.length}`);
        res.json({
            success: true,
            companyId: userCompany.companyId,
            stores: companyStores,
            allowedStoreIds,
        });
    } catch (err) {
        console.error('[CompanyStores] user-stores error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ================================================================
//  POST /api/company-stores/assign-user
//  Assign a user to a company (super-admin only)
//  Body: { userId, companyId }
// ================================================================
router.post('/assign-user', verifyToken, async (req, res) => {
    try {
        if (!isSuperAdmin(req))
            return res.status(403).json({ success: false, error: 'Forbidden' });

        const { userId, companyId } = req.body;
        if (!userId || !companyId)
            return res.status(400).json({ success: false, error: 'userId and companyId required' });

        // Upsert — agar already hai toh update karo
        const userCompany = await UserCompany.findOneAndUpdate(
            { userId: toObjId(userId) },
            {
                $set: {
                    companyId:  toObjId(companyId),
                    isActive:   true,
                    assignedBy: toObjId(req.user.id),
                },
            },
            { upsert: true, new: true }
        );

        // Get stores for this company
        const companyStores = await CompanyStore.find({
            companyId: toObjId(companyId),
            isActive: true,
        }).lean();

        const allowedStoreIds = companyStores.map(s => s.store_id);

        console.log(`[CompanyStores] assign-user userId=${userId} companyId=${companyId} stores=${allowedStoreIds.length}`);
        res.json({
            success: true,
            message: 'User assigned to company',
            userCompany,
            allowedStoreIds,
        });
    } catch (err) {
        console.error('[CompanyStores] assign-user error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;