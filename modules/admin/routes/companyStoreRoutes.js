const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../modules/auth/middlewares/authMiddleware');
const SellviaStore     = require('../models/SellviaStore');
const SellviaDashboard = require('../models/SellviaDashboard');

const isSuperAdmin = (req) =>
    req.user?.role === 'super-admin' || req.user?.role === 'superadmin';

// ================================================================
//  GET /api/company-stores
//  Each SellviaDashboard = one "company"
//  Returns all dashboards with their stores
// ================================================================
router.get('/', verifyToken, async (req, res) => {
    try {
        if (!isSuperAdmin(req))
            return res.status(403).json({ success: false, error: 'Forbidden' });

        const dashboards = await SellviaDashboard.find({}).lean();

        const companies = await Promise.all(dashboards.map(async (dash) => {
            const stores = await SellviaStore.find({
                sellvia_dashboard_id: dash._id,
            }).lean();

            return {
                _id:        dash._id,
                name:       dash.dashboard_name,
                email:      '',
                storeCount: stores.length,
                stores,
            };
        }));

        console.log(`[CompanyStores] GET / → ${companies.length} dashboards`);
        res.json({ success: true, companies });
    } catch (err) {
        console.error('[CompanyStores] GET / error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ================================================================
//  GET /api/company-stores/:dashboardId/stores
//  All stores for a specific dashboard
// ================================================================
router.get('/:dashboardId/stores', verifyToken, async (req, res) => {
    try {
        if (!isSuperAdmin(req))
            return res.status(403).json({ success: false, error: 'Forbidden' });

        const { dashboardId } = req.params;

        const stores = await SellviaStore.find({
            sellvia_dashboard_id: dashboardId,
        }).lean();

        console.log(`[CompanyStores] GET /${dashboardId}/stores → ${stores.length} stores`);
        res.json({ success: true, stores });
    } catch (err) {
        console.error('[CompanyStores] GET stores error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
