const express    = require('express');
const router     = express.Router();
const axios      = require('axios');
const crypto     = require('crypto');
const { verifyToken } = require('../../auth/middlewares/authMiddleware');
const WordpressStore   = require('../models/WordpressStore');
const WordpressProduct = require('../models/WordpressProduct');

// ── Generate a unique MarketSync store token ───────────────────────────────────
const generateStoreToken = () => `MS-${crypto.randomBytes(24).toString('hex')}`;

// ── Fetch all products from a connected WP site and save to MongoDB ────────────
const syncProductsFromStore = async (store) => {
    const baseUrl = store.site_url.replace(/\/$/, '');
    let allProducts = [];
    let page = 1;

    while (true) {
        const res = await axios.get(`${baseUrl}/wp-json/marketsync/v1/products`, {
            headers: { 'X-Marketsync-Token': store.token },
            params:  { per_page: 50, page },
            timeout: 30000,
        });

        const data = res.data;
        if (!data.success || !Array.isArray(data.data) || data.data.length === 0) break;

        allProducts = [...allProducts, ...data.data];
        if (page >= (data.total_pages || 1)) break;
        page++;
        await new Promise(r => setTimeout(r, 150)); // be nice to the WP server
    }

    let saved = 0;
    for (const product of allProducts) {
        await WordpressProduct.findOneAndUpdate(
            { wp_store_id: store._id, wp_product_id: product.id },
            {
                $set: {
                    wp_store_id:       store._id,
                    site_url:          store.site_url,
                    store_name:        store.store_name,
                    wp_product_id:     product.id,
                    name:              product.name              || '',
                    slug:              product.slug              || '',
                    description:       product.description       || '',
                    short_description: product.short_description || '',
                    sku:               product.sku               || '',
                    price:             product.price             || '0',
                    regular_price:     product.regular_price     || '0',
                    sale_price:        product.sale_price        || '',
                    stock_status:      product.stock_status      || 'instock',
                    stock_quantity:    product.stock_quantity    || 0,
                    images:            product.images            || [],
                    categories:        product.categories        || [],
                    tags:              product.tags              || [],
                    status:            product.status            || 'publish',
                    date_created:      product.date_created      || '',
                    currency:          product.currency          || 'USD',
                    synced_at:         new Date(),
                },
            },
            { upsert: true, new: true }
        );
        saved++;
    }

    await WordpressStore.updateOne(
        { _id: store._id },
        { $set: { last_synced_at: new Date(), total_products_cached: saved } }
    );

    console.log(`[WP Sync] ✓ store="${store.store_name}" synced=${saved} total_fetched=${allProducts.length}`);
    return { total: allProducts.length, saved };
};

// ================================================================
//  PUBLIC — WordPress plugin calls this to connect
// ================================================================
router.post('/plugin-connect', async (req, res) => {
    try {
        const { token, siteUrl, storeName, platform, pluginSecret, pluginVersion } = req.body;

        if (!token || !siteUrl) {
            return res.status(400).json({ success: false, message: 'token and siteUrl are required' });
        }

        const store = await WordpressStore.findOne({ token });
        if (!store) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token. Generate a token from MarketSync dashboard first.',
            });
        }

        // Token already in use by a DIFFERENT site → reject
        if (store.is_connected && store.site_url && store.site_url !== siteUrl) {
            return res.status(403).json({
                success: false,
                message: 'This token is already used by another store. Each store needs its own token.',
            });
        }

        store.site_url       = siteUrl;
        store.store_name     = storeName   || store.store_name;
        store.platform       = platform    || 'wordpress';
        store.plugin_secret  = pluginSecret  || '';
        store.plugin_version = pluginVersion || '';
        store.is_connected   = true;
        store.connected_at   = new Date();
        await store.save();

        // Auto-sync products in background (don't block the plugin's HTTP response)
        syncProductsFromStore(store).catch(err => {
            console.error(`[WP Sync] Auto-sync failed for ${siteUrl}:`, err.message);
        });

        return res.json({ success: true, storeName: store.store_name, message: 'Store connected successfully' });
    } catch (error) {
        console.error('[plugin-connect] error:', error.message);
        return res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

// ================================================================
//  PROTECTED — Create new WordPress store entry + generate token
// ================================================================
router.post('/stores', verifyToken, async (req, res) => {
    try {
        const { store_name } = req.body;
        if (!store_name || !store_name.trim()) {
            return res.status(400).json({ error: 'store_name is required' });
        }

        const token = generateStoreToken();
        const store = await WordpressStore.create({
            store_name: store_name.trim(),
            token,
            created_by: req.user.id,
        });

        res.json({ success: true, store });
    } catch (error) {
        console.error('[WP create store] error:', error.message);
        res.status(500).json({ error: 'Failed to create store: ' + error.message });
    }
});

// ================================================================
//  PROTECTED — List all WordPress stores
// ================================================================
router.get('/stores', verifyToken, async (req, res) => {
    try {
        const stores = await WordpressStore.find({}).sort({ created_at: -1 });
        res.json({ success: true, stores });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stores' });
    }
});

// ================================================================
//  PROTECTED — Delete a WordPress store and its products
// ================================================================
router.delete('/stores/:id', verifyToken, async (req, res) => {
    try {
        await WordpressStore.findByIdAndDelete(req.params.id);
        await WordpressProduct.deleteMany({ wp_store_id: req.params.id });
        res.json({ success: true, message: 'Store and its products deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete store' });
    }
});

// ================================================================
//  PROTECTED — Regenerate token for a store (resets connection)
// ================================================================
router.post('/stores/:id/regenerate-token', verifyToken, async (req, res) => {
    try {
        const store = await WordpressStore.findById(req.params.id);
        if (!store) return res.status(404).json({ error: 'Store not found' });

        store.token        = generateStoreToken();
        store.is_connected = false;
        store.site_url     = '';
        store.connected_at = null;
        await store.save();

        res.json({ success: true, token: store.token, store });
    } catch (error) {
        res.status(500).json({ error: 'Failed to regenerate token' });
    }
});

// ================================================================
//  PROTECTED — Manually sync products from a connected store
// ================================================================
router.post('/stores/:id/sync', verifyToken, async (req, res) => {
    try {
        const store = await WordpressStore.findById(req.params.id);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (!store.is_connected || !store.site_url) {
            return res.status(400).json({ error: 'Store is not connected yet' });
        }

        const result = await syncProductsFromStore(store);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[WP manual sync] error:', error.message);
        res.status(500).json({ error: 'Sync failed: ' + error.message });
    }
});

// ================================================================
//  PROTECTED — Get all synced WordPress products
// ================================================================
router.get('/products', verifyToken, async (req, res) => {
    try {
        const { store_id, page = 1, per_page = 20, search } = req.query;

        const filter = {};
        if (store_id && store_id !== 'all') filter.wp_store_id = store_id;
        if (search && search.trim()) filter.name = { $regex: search.trim(), $options: 'i' };

        const parsedPage  = Math.max(1, parseInt(page));
        const parsedLimit = Math.min(100, Math.max(1, parseInt(per_page)));
        const skip        = (parsedPage - 1) * parsedLimit;

        const [products, total] = await Promise.all([
            WordpressProduct.find(filter).sort({ synced_at: -1 }).skip(skip).limit(parsedLimit),
            WordpressProduct.countDocuments(filter),
        ]);

        res.json({
            success:     true,
            data:        products,
            total,
            total_pages: Math.ceil(total / parsedLimit),
            page:        parsedPage,
            per_page:    parsedLimit,
        });
    } catch (error) {
        console.error('[WP products] error:', error.message);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

module.exports = router;
