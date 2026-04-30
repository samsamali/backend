const express    = require('express');
const router     = express.Router();
const axios      = require('axios');
const crypto     = require('crypto');
const mongoose   = require('mongoose');
const { verifyToken } = require('../../auth/middlewares/authMiddleware');
const WordpressStore   = require('../models/WordpressStore');
const WordpressProduct = require('../models/WordpressProduct');
const SellviaStore     = require('../../admin/models/SellviaStore');

// ── Generate a unique MarketSync store token ───────────────────────────────────
const generateStoreToken = () => `MS-${crypto.randomBytes(24).toString('hex')}`;

// ── Verify plugin request using X-Marketsync-Token header ────────────────────
const verifyPluginToken = async (req, res, next) => {
    try {
        const pluginToken = req.headers['x-marketsync-token'] || req.body?.token;
        if (!pluginToken) {
            return res.status(401).json({ success: false, message: 'X-Marketsync-Token header required' });
        }
        const store = await WordpressStore.findOne({ token: pluginToken, is_connected: true });
        if (!store) {
            return res.status(401).json({ success: false, message: 'Invalid or unconnected plugin token' });
        }
        req.wpStore = store;
        next();
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Auth error: ' + err.message });
    }
};

// ── Fetch all products from a connected WP site and save to MongoDB ────────────
const syncProductsFromStore = async (store) => {
    const baseUrl = store.site_url.replace(/\/$/, '');
    const tokenPreview = (store.token || '').substring(0, 20) + '...';
    console.log(`[WP Sync] Starting → site="${baseUrl}" token="${tokenPreview}" storeId="${store._id}"`);

    let allProducts = [];
    let page = 1;

    while (true) {
        try {
            const res = await axios.get(`${baseUrl}/wp-json/marketsync/v1/products`, {
                headers: { 'X-Marketsync-Token': store.token },
                params:  { per_page: 50, page },
                timeout: 30000,
            });

            const data = res.data;
            console.log(`[WP Sync] Page ${page} → success=${data.success} count=${data.data?.length ?? 0} total=${data.total ?? '?'}`);

            if (!data.success || !Array.isArray(data.data) || data.data.length === 0) break;

            allProducts = [...allProducts, ...data.data];
            if (page >= (data.total_pages || 1)) break;
            page++;
            await new Promise(r => setTimeout(r, 150));
        } catch (pageErr) {
            const status = pageErr.response?.status;
            const body   = pageErr.response?.data;
            console.error(`[WP Sync] Page ${page} fetch error: status=${status} msg="${pageErr.message}" body=${JSON.stringify(body)}`);
            throw pageErr;
        }
    }

    console.log(`[WP Sync] Fetched ${allProducts.length} products — saving to MongoDB...`);

    if (allProducts.length > 0) {
        const sample = allProducts[0];
        console.log(`[WP Sync] First product sample — id=${sample.id} price="${sample.price}" images=${sample.images?.length ?? 0} categories=${sample.categories?.length ?? 0}`);
    }

    let saved = 0;
    for (const product of allProducts) {
        await upsertProduct(store, product);
        saved++;
    }

    await WordpressStore.updateOne(
        { _id: store._id },
        { $set: { last_synced_at: new Date(), total_products_cached: saved } }
    );

    console.log(`[WP Sync] ✓ store="${store.store_name}" synced=${saved}`);
    return { total: allProducts.length, saved };
};

// ── Shared upsert helper (used by bulk sync AND single product sync) ──────────
const upsertProduct = async (store, product) => {
    return WordpressProduct.findOneAndUpdate(
        { wp_store_id: store._id, wp_product_id: Number(product.id ?? product.wp_product_id) },
        {
            $set: {
                wp_store_id:       store._id,
                site_url:          store.site_url,
                store_name:        store.store_name,
                wp_product_id:     Number(product.id ?? product.wp_product_id),
                name:              product.name              || '',
                slug:              product.slug              || '',
                description:       product.description       || '',
                short_description: product.short_description || '',
                sku:               product.sku               || '',
                price:             String(product.price      ?? '0'),
                regular_price:     String(product.regular_price ?? '0'),
                sale_price:        String(product.sale_price ?? ''),
                stock_status:      product.stock_status      || 'instock',
                stock_quantity:    product.stock_quantity != null ? Number(product.stock_quantity) : 0,
                images:            Array.isArray(product.images)     ? product.images     : [],
                categories:        Array.isArray(product.categories) ? product.categories : [],
                tags:              Array.isArray(product.tags)       ? product.tags       : [],
                status:            product.status            || 'publish',
                date_created:      product.date_created      || '',
                currency:          product.currency          || 'USD',
                synced_at:         new Date(),
            },
        },
        { upsert: true, new: true }
    );
};

// ── Helper: normalize a URL/domain to plain hostname ─────────────────────────
const normalizeHost = (urlOrDomain) => {
    if (!urlOrDomain) return '';
    try { return new URL(urlOrDomain).hostname.replace(/^www\./i, '').toLowerCase(); }
    catch (_) { return urlOrDomain.replace(/^https?:\/\//i, '').replace(/\/$/, '').replace(/^www\./i, '').split('/')[0].toLowerCase(); }
};

// ================================================================
//  PUBLIC — WordPress plugin calls this to connect
// ================================================================
router.post('/plugin-connect', async (req, res) => {
    try {
        const { token, siteUrl, storeName, platform, pluginVersion } = req.body;

        if (!token || !siteUrl) {
            return res.status(400).json({ success: false, message: 'token and siteUrl are required' });
        }

        let store = await WordpressStore.findOne({ token });

        if (store) {
            if (store.is_connected && store.site_url && store.site_url !== siteUrl) {
                return res.status(403).json({
                    success: false,
                    message: 'This token is already used by another store.',
                });
            }
            store.site_url       = siteUrl;
            store.store_name     = storeName   || store.store_name;
            store.platform       = platform    || 'wordpress';
            store.plugin_version = pluginVersion || '';
            store.is_connected   = true;
            store.connected_at   = new Date();
            await store.save();
        } else {
            const sellviaStore = await SellviaStore.findOne({ store_token: token });
            if (!sellviaStore) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid token. Generate a token from MarketSync dashboard first.',
                });
            }

            const connectingHost = normalizeHost(siteUrl);
            const storedHost     = normalizeHost(sellviaStore.store_domain || sellviaStore.store_name);

            if (storedHost && connectingHost !== storedHost) {
                return res.status(403).json({
                    success: false,
                    message: `This token belongs to "${storedHost}", not "${connectingHost}".`,
                });
            }

            const existingLink = await WordpressStore.findOne({
                sellvia_store_id: sellviaStore._id,
                is_connected:     true,
            });
            if (existingLink && existingLink.token !== token) {
                return res.status(401).json({
                    success: false,
                    message: 'Your MarketSync token was regenerated. Please copy the new token.',
                });
            }

            sellviaStore.wp_is_connected   = true;
            sellviaStore.wp_site_url       = siteUrl;
            sellviaStore.wp_connected_at   = new Date();
            sellviaStore.wp_plugin_version = pluginVersion || '';
            await sellviaStore.save();

            let existingWPStore = await WordpressStore.findOne({ sellvia_store_id: sellviaStore._id });
            if (!existingWPStore) {
                existingWPStore = await WordpressStore.findOne({ token });
            }

            const storeData = {
                token,
                sellvia_store_id: sellviaStore._id,
                store_name:       storeName || sellviaStore.store_name || storedHost,
                site_url:         siteUrl,
                platform:         platform || 'sellvia',
                plugin_version:   pluginVersion || '',
                is_connected:     true,
                connected_at:     new Date(),
            };

            if (existingWPStore) {
                Object.assign(existingWPStore, storeData);
                store = await existingWPStore.save();
            } else {
                store = await WordpressStore.create(storeData);
            }

            await WordpressStore.deleteMany({
                site_url:   siteUrl,
                _id:        { $ne: store._id },
                is_connected: false,
                total_products_cached: 0,
            });

            console.log(`[plugin-connect] SellviaStore token matched → store="${storedHost}" site="${siteUrl}"`);
        }

        // Auto-sync products in background
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
//  PUBLIC — Plugin pushes a single product (Force Re-Sync)
//  Uses X-Marketsync-Token header instead of JWT
// ================================================================
router.post('/sync-product', verifyPluginToken, async (req, res) => {
    try {
        const store   = req.wpStore;
        const product = req.body.product || req.body;

        const productId = product?.id ?? product?.wp_product_id ?? product?.ID;
        if (!product || productId == null) {
            console.error('[sync-product] missing product id — body:', JSON.stringify(req.body).substring(0, 300));
            return res.status(400).json({ error: 'product id is required (id, wp_product_id, or ID)' });
        }

        // Normalize to .id so upsertProduct works
        if (product.id == null) product.id = productId;

        const saved = await upsertProduct(store, product);

        const count = await WordpressProduct.countDocuments({ wp_store_id: store._id });
        await WordpressStore.updateOne(
            { _id: store._id },
            { $set: { total_products_cached: count, last_synced_at: new Date() } }
        );

        res.json({ success: true, product: saved });
    } catch (error) {
        console.error('[sync-product] error:', error.message, '— body:', JSON.stringify(req.body).substring(0, 200));
        res.status(500).json({ error: 'Failed to upsert product: ' + error.message });
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
//  PROTECTED — Manually sync all products from a connected store
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
        res.status(500).json({ error: 'Sync failed: ' + error.message });
    }
});

// ================================================================
//  PROTECTED — Debug: test plugin connectivity for a store
// ================================================================
router.get('/stores/:id/debug', verifyToken, async (req, res) => {
    try {
        const store = await WordpressStore.findById(req.params.id);
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const baseUrl = (store.site_url || '').replace(/\/$/, '');
        const result  = { store_id: store._id, site_url: baseUrl, is_connected: store.is_connected, token_preview: (store.token || '').substring(0, 20) + '...' };

        try {
            const infoRes = await axios.get(`${baseUrl}/wp-json/marketsync/v1/info`, { timeout: 15000 });
            result.plugin_info = infoRes.data;
        } catch (e) {
            result.plugin_info_error = `${e.response?.status || 'network'}: ${e.message}`;
        }

        try {
            const prodRes = await axios.get(`${baseUrl}/wp-json/marketsync/v1/products`, {
                headers: { 'X-Marketsync-Token': store.token },
                params:  { per_page: 1, page: 1 },
                timeout: 15000,
            });
            const firstProduct = prodRes.data.data?.[0] || null;
            result.products_test = {
                success:        prodRes.data.success,
                total:          prodRes.data.total,
                first_product:  firstProduct,
                price:          firstProduct?.price,
                images_count:   firstProduct?.images?.length ?? 0,
                categories:     firstProduct?.categories,
            };
        } catch (e) {
            result.products_test_error = `${e.response?.status || 'network'}: ${e.message}`;
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
//  PROTECTED — All unique category names (for filter dropdown)
// ================================================================
router.get('/products/categories', verifyToken, async (req, res) => {
    try {
        const { store_id } = req.query;
        const match = store_id && store_id !== 'all'
            ? { wp_store_id: new mongoose.Types.ObjectId(store_id) }
            : {};
        const cats = await WordpressProduct.distinct('categories.name', match);
        res.json({ success: true, categories: cats.filter(Boolean).sort() });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// ================================================================
//  PROTECTED — Get all synced WordPress products
// ================================================================
router.get('/products', verifyToken, async (req, res) => {
    try {
        const { store_id, page = 1, per_page = 20, search, category } = req.query;

        const filter = {};
        if (store_id && store_id !== 'all') {
            try { filter.wp_store_id = new mongoose.Types.ObjectId(store_id); }
            catch (_) { filter.wp_store_id = store_id; }
        }

        if (search && search.trim()) {
            const regex = { $regex: search.trim(), $options: 'i' };
            filter.$or = [{ name: regex }, { 'categories.name': regex }];
        }

        if (category && category !== 'all') {
            filter['categories.name'] = { $regex: `^${category.trim()}$`, $options: 'i' };
        }

        const parsedPage  = Math.max(1, parseInt(page));
        const parsedLimit = Math.min(100, Math.max(1, parseInt(per_page)));
        const skip        = (parsedPage - 1) * parsedLimit;

        const pipeline = [
            { $match: filter },
            { $addFields: { _rank: { $cond: [{ $gt: [{ $size: { $ifNull: ['$images', []] } }, 0] }, 1, 0] } } },
            { $sort: { _rank: -1, synced_at: -1 } },
            { $skip: skip },
            { $limit: parsedLimit },
            { $project: { _rank: 0 } },
        ];

        const [products, total] = await Promise.all([
            WordpressProduct.aggregate(pipeline),
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
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

module.exports = router;