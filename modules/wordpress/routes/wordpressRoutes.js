const express    = require('express');
const router     = express.Router();
const axios      = require('axios');
const crypto     = require('crypto');
const mongoose   = require('mongoose');
const { verifyToken } = require('../../auth/middlewares/authMiddleware');
const WordpressStore   = require('../models/WordpressStore');
const WordpressProduct = require('../models/WordpressProduct');
const SellviaStore     = require('../../admin/models/SellviaStore');

const generateStoreToken = () => `MS-${crypto.randomBytes(24).toString('hex')}`;

// ── Plugin token auth — X-Marketsync-Token header ─────────────────────────────
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

// ── Shared upsert helper ───────────────────────────────────────────────────────
const upsertProduct = async (store, product) => {
    const productId = Number(product.id ?? product.wp_product_id ?? product.ID ?? 0);
    if (!productId) return null;

    return WordpressProduct.findOneAndUpdate(
        { wp_store_id: store._id, wp_product_id: productId },
        {
            $set: {
                wp_store_id:       store._id,
                site_url:          store.site_url,
                store_name:        store.store_name,
                wp_product_id:     productId,
                sellvia_id:        product.sellvia_id || '',
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

// ── Fetch all products from WP site ───────────────────────────────────────────
const syncProductsFromStore = async (store) => {
    const baseUrl = store.site_url.replace(/\/$/, '');
    let allProducts = [], page = 1;

    while (true) {
        try {
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
            await new Promise(r => setTimeout(r, 150));
        } catch (err) {
            console.error(`[WP Sync] Page ${page} error:`, err.message);
            throw err;
        }
    }

    let saved = 0;
    for (const product of allProducts) {
        const result = await upsertProduct(store, product);
        if (result) saved++;
    }

    await WordpressStore.updateOne(
        { _id: store._id },
        { $set: { last_synced_at: new Date(), total_products_cached: saved } }
    );

    console.log(`[WP Sync] store="${store.store_name}" synced=${saved}/${allProducts.length}`);
    return { total: allProducts.length, saved };
};

const normalizeHost = (urlOrDomain) => {
    if (!urlOrDomain) return '';
    try { return new URL(urlOrDomain).hostname.replace(/^www\./i, '').toLowerCase(); }
    catch (_) { return urlOrDomain.replace(/^https?:\/\//i, '').replace(/\/$/, '').replace(/^www\./i, '').split('/')[0].toLowerCase(); }
};

// ================================================================
//  PUBLIC — WordPress plugin connect
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
                return res.status(403).json({ success: false, message: 'Token already used by another store.' });
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
                return res.status(401).json({ success: false, message: 'Invalid token. Generate from MarketSync dashboard.' });
            }

            const connectingHost = normalizeHost(siteUrl);
            const storedHost     = normalizeHost(sellviaStore.store_domain || sellviaStore.store_name);

            if (storedHost && connectingHost !== storedHost) {
                return res.status(403).json({ success: false, message: `Token belongs to "${storedHost}", not "${connectingHost}".` });
            }

            const existingLink = await WordpressStore.findOne({ sellvia_store_id: sellviaStore._id, is_connected: true });
            if (existingLink && existingLink.token !== token) {
                return res.status(401).json({ success: false, message: 'Token was regenerated. Use the new token.' });
            }

            sellviaStore.wp_is_connected   = true;
            sellviaStore.wp_site_url       = siteUrl;
            sellviaStore.wp_connected_at   = new Date();
            sellviaStore.wp_plugin_version = pluginVersion || '';
            await sellviaStore.save();

            let existingWPStore = await WordpressStore.findOne({ sellvia_store_id: sellviaStore._id })
                               || await WordpressStore.findOne({ token });

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
                site_url: siteUrl, _id: { $ne: store._id },
                is_connected: false, total_products_cached: 0,
            });
        }

        syncProductsFromStore(store).catch(err =>
            console.error(`[WP Sync] Auto-sync failed:`, err.message)
        );

        return res.json({ success: true, storeName: store.store_name, message: 'Store connected successfully' });
    } catch (error) {
        console.error('[plugin-connect] error:', error.message);
        return res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

// ================================================================
//  PUBLIC (plugin auth) — Single product upsert
// ================================================================
router.post('/sync-product', verifyPluginToken, async (req, res) => {
    try {
        const store   = req.wpStore;
        const product = req.body.product || req.body;

        console.log('[sync-product] store=', store.store_name, 'id=', product?.id, 'sellvia_id=', product?.sellvia_id, 'price=', product?.price);

        if (!product || (product.id == null && product.wp_product_id == null)) {
            return res.status(400).json({ error: 'product.id is required' });
        }

        const saved = await upsertProduct(store, product);
        if (!saved) return res.status(400).json({ error: 'Could not determine product ID' });

        const count = await WordpressProduct.countDocuments({ wp_store_id: store._id });
        await WordpressStore.updateOne(
            { _id: store._id },
            { $set: { total_products_cached: count, last_synced_at: new Date() } }
        );

        res.json({ success: true, product: saved });
    } catch (error) {
        console.error('[sync-product] error:', error.message);
        res.status(500).json({ error: 'Failed to upsert product: ' + error.message });
    }
});

// ================================================================
//  PROTECTED — Store CRUD
// ================================================================
router.post('/stores', verifyToken, async (req, res) => {
    try {
        const { store_name } = req.body;
        if (!store_name?.trim()) return res.status(400).json({ error: 'store_name is required' });
        const token = generateStoreToken();
        const store = await WordpressStore.create({ store_name: store_name.trim(), token, created_by: req.user.id });
        res.json({ success: true, store });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create store: ' + error.message });
    }
});

router.get('/stores', verifyToken, async (req, res) => {
    try {
        const stores = await WordpressStore.find({}).sort({ created_at: -1 });
        res.json({ success: true, stores });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stores' });
    }
});

router.delete('/stores/:id', verifyToken, async (req, res) => {
    try {
        await WordpressStore.findByIdAndDelete(req.params.id);
        await WordpressProduct.deleteMany({ wp_store_id: req.params.id });
        res.json({ success: true, message: 'Store and products deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete store' });
    }
});

router.post('/stores/:id/regenerate-token', verifyToken, async (req, res) => {
    try {
        const store = await WordpressStore.findById(req.params.id);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        store.token = generateStoreToken();
        store.is_connected = false;
        store.site_url = '';
        store.connected_at = null;
        await store.save();
        res.json({ success: true, token: store.token, store });
    } catch (error) {
        res.status(500).json({ error: 'Failed to regenerate token' });
    }
});

router.post('/stores/:id/sync', verifyToken, async (req, res) => {
    try {
        const store = await WordpressStore.findById(req.params.id);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        if (!store.is_connected || !store.site_url) return res.status(400).json({ error: 'Store not connected' });
        const result = await syncProductsFromStore(store);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ error: 'Sync failed: ' + error.message });
    }
});

router.get('/stores/:id/debug', verifyToken, async (req, res) => {
    try {
        const store = await WordpressStore.findById(req.params.id);
        if (!store) return res.status(404).json({ error: 'Store not found' });
        const baseUrl = (store.site_url || '').replace(/\/$/, '');
        const result = { store_id: store._id, site_url: baseUrl, is_connected: store.is_connected };
        try {
            const r = await axios.get(`${baseUrl}/wp-json/marketsync/v1/products`, {
                headers: { 'X-Marketsync-Token': store.token }, params: { per_page: 1 }, timeout: 15000,
            });
            const p = r.data.data?.[0];
            result.first_product = { id: p?.id, price: p?.price, sellvia_id: p?.sellvia_id, images: p?.images?.length, categories: p?.categories };
        } catch (e) { result.products_error = e.message; }
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
//  PROTECTED — Products list + categories (Grouped by sellvia_id!)
// ================================================================
router.get('/products/categories', verifyToken, async (req, res) => {
    try {
        const { store_id } = req.query;
        const match = store_id && store_id !== 'all'
            ? { wp_store_id: new mongoose.Types.ObjectId(store_id) } : {};
        const cats = await WordpressProduct.distinct('categories.name', match);
        res.json({ success: true, categories: cats.filter(Boolean).sort() });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

// ── Group products by sellvia_id ──────────────────────────────────────────────
router.get('/products', verifyToken, async (req, res) => {
    try {
        const { store_id, page = 1, per_page = 20, search, category } = req.query;
        const filter = {};

        const storeFilter = {};
        if (store_id && store_id !== 'all') {
            try { storeFilter.wp_store_id = new mongoose.Types.ObjectId(store_id); }
            catch (_) { storeFilter.wp_store_id = store_id; }
        }

        if (search?.trim()) {
            const regex = { $regex: search.trim(), $options: 'i' };
            filter.$or = [{ name: regex }, { 'categories.name': regex }];
        }
        if (category && category !== 'all') {
            filter['categories.name'] = { $regex: `^${category.trim()}$`, $options: 'i' };
        }

        const parsedPage  = Math.max(1, parseInt(page));
        const parsedLimit = Math.min(100, Math.max(1, parseInt(per_page)));
        const skip = (parsedPage - 1) * parsedLimit;

        const groupId = store_id && store_id !== 'all' ? '$_id' : { $cond: [{ $ne: ['$sellvia_id', ''] }, '$sellvia_id', '$_id'] };

        const pipeline = [
            { $match: { ...filter, ...storeFilter } },
            {
                $group: {
                    _id: groupId,
                    sellvia_id:    { $first: '$sellvia_id' },
                    wp_product_id: { $first: '$wp_product_id' },
                    doc_id:        { $first: '$_id' },
                    name:              { $first: '$name' },
                    description:       { $first: '$description' },
                    short_description: { $first: '$short_description' },
                    sku:               { $first: '$sku' },
                    price:             { $first: '$price' },
                    regular_price:     { $first: '$regular_price' },
                    sale_price:        { $first: '$sale_price' },
                    stock_status:      { $first: '$stock_status' },
                    stock_quantity:    { $first: '$stock_quantity' },
                    images:            { $first: '$images' },
                    categories:        { $first: '$categories' },
                    tags:              { $first: '$tags' },
                    status:            { $first: '$status' },
                    currency:          { $first: '$currency' },
                    synced_at:         { $first: '$synced_at' },
                    store_name:        { $first: '$store_name' },
                    site_url:          { $first: '$site_url' },
                    wp_store_id:       { $first: '$wp_store_id' },
                    store_count: { $sum: 1 },
                    stores: { $push: { store_id: '$wp_store_id', store_name: '$store_name', wp_product_id: '$wp_product_id' } },
                }
            },
            { $addFields: {
                _id:   '$doc_id',
                _rank: { $cond: [{ $gt: [{ $size: { $ifNull: ['$images', []] } }, 0] }, 1, 0] },
            }},
            { $sort: { _rank: -1, synced_at: -1 } },
            { $skip: skip },
            { $limit: parsedLimit },
            { $project: { _rank: 0, doc_id: 0 } },
        ];

        const countPipeline = [
            { $match: { ...filter, ...storeFilter } },
            { $group: { _id: groupId } },
            { $count: 'total' },
        ];

        const [products, countResult] = await Promise.all([
            WordpressProduct.aggregate(pipeline),
            WordpressProduct.aggregate(countPipeline),
        ]);
        const total = countResult[0]?.total ?? 0;

        res.json({ success: true, data: products, total, total_pages: Math.ceil(total / parsedLimit), page: parsedPage, per_page: parsedLimit });
    } catch (error) {
        console.error('[products] error:', error);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// ================================================================
//  PROTECTED — Store distribution by sellvia_id
// ================================================================
router.get('/products/:productId/store-status', verifyToken, async (req, res) => {
    try {
        const product = await WordpressProduct.findById(req.params.productId);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        const groupKey = product.sellvia_id ? product.sellvia_id : String(product._id);

        const [stores, productsWithKey] = await Promise.all([
            WordpressStore.find({}).sort({ store_name: 1 }),
            WordpressProduct.find({
                $or: [
                    ...(product.sellvia_id ? [{ sellvia_id: product.sellvia_id }] : []),
                    { _id: product._id },
                    { source_product_id: product._id },
                ],
            }).select('wp_store_id sellvia_id _id wp_product_id'),
        ]);

        const assignedMap = {};
        for (const p of productsWithKey) {
            assignedMap[String(p.wp_store_id)] = String(p._id);
        }

        const storeStatus = stores.map(s => ({
            _id:            s._id,
            store_name:     s.store_name,
            site_url:       s.site_url,
            is_connected:   s.is_connected,
            has_product:    !!assignedMap[String(s._id)],
            product_doc_id: assignedMap[String(s._id)] || null,
        }));

        res.json({ success: true, stores: storeStatus, group_key: groupKey, wp_product_id: product.wp_product_id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
//  PROTECTED — Assign (copy) a product to another store
//  ⭐ NEW: Uses Sellvia native import when sellvia_id exists
// ================================================================
router.post('/products/:productId/assign/:storeId', verifyToken, async (req, res) => {
    try {
        const [product, targetStore] = await Promise.all([
            WordpressProduct.findById(req.params.productId),
            WordpressStore.findById(req.params.storeId),
        ]);
        if (!product)     return res.status(404).json({ error: 'Product not found' });
        if (!targetStore) return res.status(404).json({ error: 'Store not found' });

        if (!targetStore.site_url || !targetStore.token || !targetStore.is_connected) {
            return res.status(400).json({ error: 'Target store is not connected' });
        }

        let wpProductId = null;
        let importMethod = 'manual';

        // ════════════════════════════════════════════════════════════
        //  PRIORITY 1: Sellvia Native Import — ROBUST 3-STEP FLOW
        //  Sellvia's connect handler calls exit/die, so we use:
        //   1. prepare  → get a clean post_id
        //   2. connect  → trigger Sellvia (it may die, doesn't matter)
        //   3. verify   → confirm the product is connected
        //  → Public URL works ✅  wp_slv_products entry ✅  feedback/qty ✅
        // ════════════════════════════════════════════════════════════
        if (product.sellvia_id) {
            try {
                const base = targetStore.site_url.replace(/\/$/, '');
                const headers = {
                    'X-Marketsync-Token': targetStore.token,
                    'Content-Type':       'application/json',
                };

                console.log(`[assign] 🎯 Sellvia import (3-step) → sellvia_id=${product.sellvia_id}`);

                // STEP 1: Prepare — get a clean post_id (no Sellvia call, safe)
                let preparedPostId = null;
                try {
                    const prepRes = await axios.post(
                        `${base}/wp-json/marketsync/v1/sellvia-import-prepare`,
                        { sellvia_id: product.sellvia_id, name: product.name },
                        { headers, timeout: 30000 }
                    );
                    preparedPostId = prepRes.data?.post_id || null;
                    console.log(`[assign]   step1 prepare → post_id=${preparedPostId}`);
                } catch (prepErr) {
                    console.warn('[assign]   step1 prepare failed:',
                        prepErr.response?.data || prepErr.message);
                }

                if (preparedPostId) {
                    // STEP 2: Connect — loopback to admin-ajax.php (synchronous).
                    // Connect now does the real work + finalize itself.
                    let connectSaysConnected = false;
                    try {
                        const connectRes = await axios.post(
                            `${base}/wp-json/marketsync/v1/sellvia-import-connect`,
                            { post_id: preparedPostId, sellvia_id: product.sellvia_id },
                            { headers, timeout: 90000 }
                        );
                        const cd = connectRes.data || {};
                        connectSaysConnected = !!cd.connected;
                        console.log(`[assign]   step2 connect → connected=${cd.connected} slv_entry=${cd.slv_entry || 'none'}`);
                        console.log(`[assign]   step2 diagnostics: ${JSON.stringify(cd.diagnostics || {}).slice(0, 400)}`);
                    } catch (connectErr) {
                        console.log(`[assign]   step2 connect → error: ${JSON.stringify(connectErr.response?.data || connectErr.message).slice(0, 250)}`);
                    }

                    // Brief pause, then verify as the final word
                    await new Promise(r => setTimeout(r, 1500));

                    // STEP 3: Verify — confirm connection (deletes draft if failed)
                    try {
                        const verifyRes = await axios.get(
                            `${base}/wp-json/marketsync/v1/sellvia-import-verify/${preparedPostId}`,
                            { headers, timeout: 30000 }
                        );
                        const vd = verifyRes.data || {};
                        if (vd.connected && vd.wp_product_id) {
                            wpProductId = vd.wp_product_id;
                            importMethod = 'sellvia';
                            console.log(`[assign] ✅ Sellvia import SUCCESS! wp_product_id=${wpProductId} (real slv entry confirmed)`);
                        } else {
                            console.warn(`[assign] ⚠️ Sellvia verify: NOT connected → reason=${vd.reason || 'unknown'} status=${vd.post_status || '?'} — will fall back to manual`);
                        }
                    } catch (verifyErr) {
                        console.warn('[assign]   step3 verify failed:',
                            verifyErr.response?.data || verifyErr.message);
                    }
                }
            } catch (sellviaErr) {
                console.warn('[assign] ⚠️ Sellvia import error, falling back to manual:',
                    sellviaErr.response?.data || sellviaErr.message);
            }
        }

        // ════════════════════════════════════════════════════════════
        //  PRIORITY 2: Manual Import (fallback)
        //  Used when no sellvia_id, or Sellvia import failed
        // ════════════════════════════════════════════════════════════
        if (!wpProductId) {
            let src = product;

            // Refresh data if stale
            if (parseFloat(product.price) <= 0) {
                try {
                    const sourceStore = await WordpressStore.findById(product.wp_store_id);
                    if (sourceStore?.site_url && sourceStore?.token && product.wp_product_id) {
                        const freshUrl = `${sourceStore.site_url.replace(/\/$/, '')}/wp-json/marketsync/v1/products/${product.wp_product_id}`;
                        const freshRes = await axios.get(freshUrl, {
                            headers: { 'X-Marketsync-Token': sourceStore.token },
                            timeout: 15000,
                        });
                        const fp = freshRes.data?.data;
                        if (fp && parseFloat(fp.price) > 0) src = fp;
                    }
                } catch (freshErr) {
                    console.warn('[assign] Fresh fetch failed:', freshErr.message);
                }
            }

            const isSellvia        = src.platform === 'sellvia' || product.platform === 'sellvia';
            const effectivePrice   = parseFloat(src.price)         > 0 ? String(src.price)         : '0';
            const effectiveRegular = parseFloat(src.regular_price) > 0 ? String(src.regular_price) : effectivePrice;
            const effectiveSale    = parseFloat(src.sale_price)    > 0 ? String(src.sale_price)    : '';
            const effectiveQty     = parseInt(src.stock_quantity)  > 0
                ? Number(src.stock_quantity)
                : (isSellvia ? 1000000 : null);

            const payload = {
                name:              src.name              || '',
                description:       src.description       || '',
                short_description: src.short_description || '',
                sku:               src.sku               || '',
                price:             effectivePrice,
                regular_price:     effectiveRegular,
                sale_price:        effectiveSale,
                stock_status:      src.stock_status      || 'instock',
                stock_quantity:    effectiveQty,
                categories:        Array.isArray(src.categories)
                                      ? src.categories.map(c => (typeof c === 'object' ? (c.name || '') : c)).filter(Boolean)
                                      : [],
                image_url:         (Array.isArray(src.images) && src.images[0]?.src) ? src.images[0].src : '',
                sellvia_id:        src.sellvia_id        || '',
            };

            const wpUrl = `${targetStore.site_url.replace(/\/$/, '')}/wp-json/marketsync/v1/products`;
            console.log(`[assign] 📝 Manual import → ${wpUrl} | name="${payload.name}"`);

            try {
                const wpRes = await axios.post(wpUrl, payload, {
                    headers: {
                        'X-Marketsync-Token': targetStore.token,
                        'Content-Type':       'application/json',
                    },
                    timeout: 30000,
                });
                wpProductId = wpRes.data?.data?.id || null;
                importMethod = 'manual';
                console.log(`[assign] ✅ Manual import success! wp_product_id=${wpProductId}`);
            } catch (wpErr) {
                const errBody = wpErr.response?.data || wpErr.message;
                console.error(`[assign] ❌ Manual import failed:`, errBody);
                return res.status(502).json({
                    error: 'Failed to create product on WordPress site',
                    wp_error: errBody,
                });
            }
        }

        if (!wpProductId) {
            return res.status(502).json({ error: 'Could not create product on target store' });
        }

        // Save to MongoDB
        const data = product.toObject();
        delete data._id; delete data.__v; delete data.created_at; delete data.updated_at;

        const sourceProductId = product.source_product_id
            ? String(product.source_product_id)
            : String(product._id);

        const saved = await WordpressProduct.findOneAndUpdate(
            { wp_store_id: targetStore._id, wp_product_id: wpProductId },
            {
                $set: {
                    ...data,
                    source_product_id: sourceProductId,
                    wp_store_id:       targetStore._id,
                    wp_product_id:     wpProductId,
                    store_name:        targetStore.store_name,
                    site_url:          targetStore.site_url,
                    sellvia_id:        product.sellvia_id || '',
                    synced_at:         new Date(),
                },
            },
            { upsert: true, new: true }
        );

        const count = await WordpressProduct.countDocuments({ wp_store_id: targetStore._id });
        await WordpressStore.updateOne({ _id: targetStore._id }, { $set: { total_products_cached: count } });

        res.json({
            success:        true,
            product:        saved,
            wp_product_id:  wpProductId,
            import_method:  importMethod,   // 'sellvia' or 'manual'
        });
    } catch (error) {
        console.error('[assign] error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
//  PROTECTED — Remove a product assignment from a store
// ================================================================
router.delete('/products/:productId/remove/:storeId', verifyToken, async (req, res) => {
    try {
        const [product, store] = await Promise.all([
            WordpressProduct.findById(req.params.productId),
            WordpressStore.findById(req.params.storeId),
        ]);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        if (!store)   return res.status(404).json({ error: 'Store not found' });

        let docToRemove = product;
        if (String(product.wp_store_id) !== String(store._id)) {
            const sourceId = product.source_product_id
                ? String(product.source_product_id)
                : String(product._id);

            const copy = await WordpressProduct.findOne({
                wp_store_id: store._id,
                $or: [
                    { source_product_id: sourceId },
                    { source_product_id: String(product._id) },
                    ...(product.sellvia_id ? [{ sellvia_id: product.sellvia_id }] : []),
                ],
            });

            if (!copy) {
                const count = await WordpressProduct.countDocuments({ wp_store_id: store._id });
                await WordpressStore.updateOne({ _id: store._id }, { $set: { total_products_cached: count } });
                return res.json({ success: true, wp_deleted: false, note: 'No copy found in store' });
            }
            docToRemove = copy;
        }

        let wpDeleted = false;
        let wpError   = null;
        if (store.site_url && store.token) {
            const wpUrl = `${store.site_url.replace(/\/$/, '')}/wp-json/marketsync/v1/products/${docToRemove.wp_product_id}`;
            console.log(`[remove] WP DELETE → ${wpUrl}`);
            try {
                await axios.delete(wpUrl, {
                    headers: { 'X-Marketsync-Token': store.token },
                    timeout: 15000,
                });
                wpDeleted = true;
            } catch (wpErr) {
                const status = wpErr.response?.status;
                wpError = wpErr.response?.data || wpErr.message;
                console.error(`[remove] WP DELETE failed status=${status}`, wpError);
                if (status === 404) wpDeleted = true;
            }
        } else {
            wpDeleted = true;
        }

        if (!wpDeleted) {
            return res.status(502).json({
                error: `WordPress delete failed: ${typeof wpError === 'object' ? JSON.stringify(wpError) : wpError}`,
                wp_error: wpError,
            });
        }

        await WordpressProduct.findByIdAndDelete(docToRemove._id);

        const count = await WordpressProduct.countDocuments({ wp_store_id: store._id });
        await WordpressStore.updateOne({ _id: store._id }, { $set: { total_products_cached: count } });

        res.json({ success: true, wp_deleted: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
//  PROTECTED — Update product (frontend → WordPress → MongoDB)
// ================================================================
router.put('/products/:productId', verifyToken, async (req, res) => {
    try {
        const product = await WordpressProduct.findById(req.params.productId);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        const store = await WordpressStore.findById(product.wp_store_id);
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const { name, description, short_description, price, sale_price, stock_quantity, sku, stock_status } = req.body;

        const updateData = {};
        if (name              !== undefined) updateData.name              = name;
        if (description       !== undefined) updateData.description       = description;
        if (short_description !== undefined) updateData.short_description = short_description;
        if (sku               !== undefined) updateData.sku               = sku;
        if (stock_status      !== undefined) updateData.stock_status      = stock_status;
        if (price             !== undefined) {
            updateData.price         = String(price);
            updateData.regular_price = String(price);
        }
        if (sale_price        !== undefined) updateData.sale_price     = String(sale_price);
        if (stock_quantity    !== undefined) updateData.stock_quantity = Number(stock_quantity);

        if (store.site_url && store.token && store.is_connected) {
            const wpUrl = `${store.site_url.replace(/\/$/, '')}/wp-json/marketsync/v1/products/${product.wp_product_id}`;
            console.log(`[update] WP PUT → ${wpUrl}`);
            try {
                const wpRes = await axios.put(wpUrl, updateData, {
                    headers: { 'X-Marketsync-Token': store.token, 'Content-Type': 'application/json' },
                    timeout: 30000,
                });
                console.log(`[update] WP response:`, JSON.stringify(wpRes.data).slice(0, 200));
            } catch (wpErr) {
                console.error(`[update] WP PUT failed:`, wpErr.response?.data || wpErr.message);
                return res.status(502).json({
                    error: 'WordPress update failed',
                    wp_error: wpErr.response?.data || wpErr.message,
                });
            }
        }

        Object.assign(product, updateData);
        product.synced_at = new Date();
        await product.save();

        res.json({ success: true, product });
    } catch (error) {
        console.error('[update] error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;