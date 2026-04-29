const express    = require('express');
const router     = express.Router();
const axios      = require('axios');
const crypto     = require('crypto');
const { verifyToken } = require('../../auth/middlewares/authMiddleware');
const WordpressStore   = require('../models/WordpressStore');
const WordpressProduct = require('../models/WordpressProduct');
const SellviaStore     = require('../../admin/models/SellviaStore');

// ── Generate a unique MarketSync store token ───────────────────────────────────
const generateStoreToken = () => `MS-${crypto.randomBytes(24).toString('hex')}`;

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

    // Log raw structure of first product so we can verify what fields the plugin returns
    if (allProducts.length > 0) {
        const sample = allProducts[0];
        console.log(`[WP Sync] First product keys: ${Object.keys(sample).join(', ')}`);
        console.log(`[WP Sync] First product sample — id=${sample.id} name="${sample.name}" price="${sample.price}" regular_price="${sample.regular_price}" images=${JSON.stringify(sample.images)} categories=${JSON.stringify(sample.categories)} sku="${sample.sku}"`);
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
        const { token, siteUrl, storeName, platform, pluginSecret, pluginVersion } = req.body;

        if (!token || !siteUrl) {
            return res.status(400).json({ success: false, message: 'token and siteUrl are required' });
        }

        // ── Step 1: Look up token in WordpressStore ───────────────
        let store = await WordpressStore.findOne({ token });

        if (store) {
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
        } else {
            // ── Step 2: Look up token in SellviaStore.store_token ─
            const sellviaStore = await SellviaStore.findOne({ store_token: token });

            if (!sellviaStore) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid token. Generate a token from MarketSync dashboard first.',
                });
            }

            // ── Step 3: Validate domain — token must match the connecting store ──
            const connectingHost = normalizeHost(siteUrl);
            const storedHost     = normalizeHost(sellviaStore.store_domain || sellviaStore.store_name);

            if (storedHost && connectingHost !== storedHost) {
                return res.status(403).json({
                    success: false,
                    message: `This token belongs to "${storedHost}", not "${connectingHost}". Use the correct store's token.`,
                });
            }

            // ── Step 4: Update SellviaStore with WP connection info ──
            sellviaStore.wp_is_connected   = true;
            sellviaStore.wp_site_url       = siteUrl;
            sellviaStore.wp_connected_at   = new Date();
            sellviaStore.wp_plugin_version = pluginVersion || '';
            await sellviaStore.save();

            // ── Step 5: Create/update a WordpressStore record so products ──
            //           appear in the WordPress products page
            store = await WordpressStore.findOneAndUpdate(
                { token },
                {
                    $set: {
                        store_name:     storeName || sellviaStore.store_name || storedHost,
                        site_url:       siteUrl,
                        platform:       platform || 'sellvia',
                        plugin_version: pluginVersion || '',
                        is_connected:   true,
                        connected_at:   new Date(),
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            console.log(`[plugin-connect] SellviaStore token matched → store="${storedHost}" site="${siteUrl}"`);
        }

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
//  PROTECTED — Debug: test plugin connectivity for a store
// ================================================================
router.get('/stores/:id/debug', verifyToken, async (req, res) => {
    try {
        const store = await WordpressStore.findById(req.params.id);
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const baseUrl = (store.site_url || '').replace(/\/$/, '');
        const result  = { store_id: store._id, site_url: baseUrl, is_connected: store.is_connected, token_preview: (store.token || '').substring(0, 20) + '...' };

        // Test 1: /info (public, no auth needed)
        try {
            const infoRes = await axios.get(`${baseUrl}/wp-json/marketsync/v1/info`, { timeout: 15000 });
            result.plugin_info = infoRes.data;
        } catch (e) {
            result.plugin_info_error = `${e.response?.status || 'network'}: ${e.message}`;
        }

        // Test 2: /products (requires token auth) — return full first product for diagnosis
        try {
            const prodRes = await axios.get(`${baseUrl}/wp-json/marketsync/v1/products`, {
                headers: { 'X-Marketsync-Token': store.token },
                params:  { per_page: 1, page: 1 },
                timeout: 15000,
            });
            const firstProduct = prodRes.data.data?.[0] || null;
            result.products_test = {
                success:           prodRes.data.success,
                total:             prodRes.data.total,
                first_product_raw: firstProduct,          // full object for diagnosis
                fields_present:    firstProduct ? Object.keys(firstProduct) : [],
            };
        } catch (e) {
            result.products_test_error = `${e.response?.status || 'network'}: ${e.message} body=${JSON.stringify(e.response?.data)}`;
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
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
