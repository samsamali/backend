const express = require('express');
const router = express.Router();
const axios = require('axios');
const { verifyToken } = require('../../../modules/auth/middlewares/authMiddleware');
const SellviaDashboard = require('../models/SellviaDashboard');
const SellviaStore     = require('../models/SellviaStore');
const SellviaOrder     = require('../models/SellviaOrder');
const SellviaHome      = require('../models/SellviaHome');
const CompanyStore     = require('../models/CompanyStore');
const mongoose         = require('mongoose');

// ================================================================
//  STORE DOMAIN MAP — emergency fallback only
// ================================================================
const STORE_DOMAIN_MAP = {
    '373297': 'nurseryclub.shop',
    '373298': 'enchantvibe.shop',
    '373299': 'primetreasureselection.shop',
    '397445': 'blissfulmistletoe.shop',
    '397456': 'cattreasury.shop',
    '397458': 'grandtechnology.shop',
    '397467': 'rougeoasis.shop',
    '399379': 'primechef.shop',
    '419373': 'happycollectionsvault.shop',
    '429022': 'ultimateofferstreasury.shop',
};

// ================================================================
//  HELPER: safely convert any id to ObjectId
// ================================================================
const toObjId = (id) => {
    try { return new mongoose.Types.ObjectId(String(id)); }
    catch (_) { console.error('[toObjId] Invalid id:', id); return null; }
};

// ================================================================
//  HELPER: Company Store Filter
//  "Company" in this app = SellviaDashboard (_id used as company id)
//  - super-admin + selectedCompanyIds    → filter by sellvia_dashboard_id IN those ids
//  - super-admin + no filter             → return {} (see all)
//  - normal user + allowedStoreIds       → filter by store_id
//  - normal user + no filter             → return {} (backward compat)
// ================================================================
const getCompanyStoreFilter = (req, selectedCompanyIds = []) => {
    const isSuperAdmin = req.user.role === 'super-admin' || req.user.role === 'superadmin';

    if (isSuperAdmin) {
        if (selectedCompanyIds && selectedCompanyIds.length > 0) {
            // IDs are SellviaDashboard ObjectIds — filter orders directly by sellvia_dashboard_id
            const dashObjIds = selectedCompanyIds
                .map(id => { try { return toObjId(id); } catch (_) { return null; } })
                .filter(Boolean);
            if (dashObjIds.length > 0) {
                console.log(`[CompanyFilter] SuperAdmin → filter by ${dashObjIds.length} dashboards`);
                return { sellvia_dashboard_id: { $in: dashObjIds } };
            }
            // All IDs were invalid — return nothing
            return { sellvia_dashboard_id: { $in: [] } };
        }
        console.log('[CompanyFilter] SuperAdmin no filter → all orders');
        return {};
    }

    const allowedStoreIds = req.user.allowedStoreIds || [];
    if (allowedStoreIds.length > 0) {
        console.log(`[CompanyFilter] Normal user → ${allowedStoreIds.length} allowed stores`);
        return { store_id: { $in: allowedStoreIds } };
    }

    console.log('[CompanyFilter] No company filter applied');
    return {};
};

// ================================================================
//  HELPER: Get status + fulfillment from raw Sellvia order
// ================================================================
const getOrderStatusAndFulfillment = (order) => {
    const fulfillment = order.service_order?.fulfillment || '';
    const svcStatus   = order.service_order?.status      || '';
    const action      = order.action?.action             || '';

    let status;
    if      (fulfillment === 'shipped')       { status = 'shipped';    }
    else if (fulfillment === 'not_processed') {
        if      (svcStatus === 'abandoned')   status = 'abandoned';
        else if (svcStatus === 'paid')        status = 'processing';
        else                                  status = 'pending';
    }
    else if (fulfillment === 'processing')    { status = 'processing'; }
    else if (fulfillment === 'delivered')     { status = 'delivered';  }
    else if (action === 'processed')          { status = 'shipped';    }
    else if (action === 'payOrder')           { status = 'pending';    }
    else                                      { status = order.status || 'paid'; }

    return { status, fulfillment };
};

// ================================================================
//  HELPER: Parse Sellvia API response
// ================================================================
const parseSellviaResponse = (rawData) => {
    if (typeof rawData === 'object' && rawData !== null) return rawData;
    if (typeof rawData !== 'string') return null;
    const preview = rawData.substring(0, 300).trim();
    if (preview.startsWith('<') || preview.includes('<pre>') || preview.includes('<!DOCTYPE')) {
        console.error('[PARSE] HTML error from Sellvia — bad request or server crash');
        return null;
    }
    const jsonStart = rawData.indexOf('{');
    if (jsonStart === -1) return null;
    try { return JSON.parse(rawData.substring(jsonStart)); }
    catch (e) { console.error('[PARSE] JSON parse error:', e.message); return null; }
};

// ================================================================
//  HELPER: Get domain from DB (primary) or fallback map
// ================================================================
const getStoreDomain = async (store) => {
    if (store.store_domain && store.store_domain.trim() !== '') return store.store_domain.trim();
    const storeIdStr = String(store.store_id);
    if (STORE_DOMAIN_MAP[storeIdStr]) {
        const domain = STORE_DOMAIN_MAP[storeIdStr].trim();
        await SellviaStore.updateOne({ _id: store._id }, { $set: { store_domain: domain } });
        return domain;
    }
    return '';
};

// ================================================================
//  HELPER: Get correct dashboard for a store
// ================================================================
const getDashboardForStore = async (store) => {
    try {
        const dashboardId = store.sellvia_dashboard_id;
        if (!dashboardId) { console.error(`[DASHBOARD] Store ${store.store_id} has no dashboard_id`); return null; }
        const dashboard = await SellviaDashboard.findById(dashboardId);
        if (!dashboard) { console.error(`[DASHBOARD] Dashboard ${dashboardId} not found for store ${store.store_id}`); return null; }
        return dashboard;
    } catch (error) {
        console.error(`[DASHBOARD] Error fetching dashboard for store ${store.store_id}:`, error.message);
        return null;
    }
};

// ================================================================
//  HELPER: Fetch ONE page from Sellvia API
// ================================================================
const fetchOrdersPage = async (store, pageNo, pageSize) => {
    try {
        const dashboard = await getDashboardForStore(store);
        if (!dashboard) {
            console.error(`[FETCH] No dashboard found for store ${store.store_id}`);
            return { orders: [], total: 0, numOfPages: 0, success: false, error: 'Dashboard not found' };
        }

        const domain  = await getStoreDomain(store);
        const storeId = parseInt(store.store_id);
        const body    = { pageNo, pageSize, storeId };
        if (domain) body.domain = domain;

        console.log(`[FETCH] Store ${storeId} (${store.store_name}) - Dashboard: ${dashboard.dashboard_name}, Domain: ${domain || 'none'}`);

        const response = await axios.post(
            `${dashboard.base_url}/rest/v1/account/orders/list`, body,
            {
                headers: {
                    'Authorization':    dashboard.jwt_token,
                    'Accept':           'application/json, text/plain, */*',
                    'Content-Type':     'application/json',
                    'Origin':           dashboard.base_url,
                    'Referer':          `${dashboard.base_url}/me/account`,
                    'Cookie':           `sell_account_token=${dashboard.jwt_token}`,
                    'X-Requested-With': 'XMLHttpRequest',
                    'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                },
                timeout: 60000, transformResponse: [(d) => d],
            }
        );

        const parsed = parseSellviaResponse(response.data);
        if (parsed?.status === 'success' && parsed?.data) {
            return { orders: parsed.data.items || [], total: parsed.data.total || 0, numOfPages: parsed.data.num_of_pages || 1, success: true, dashboardId: dashboard._id };
        }
        return { orders: [], total: 0, numOfPages: 0, success: true, dashboardId: dashboard._id };
    } catch (error) {
        console.error(`[FETCH] Store ${store.store_id} page ${pageNo} error:`, error.message);
        return { orders: [], total: 0, numOfPages: 0, success: false, error: error.message };
    }
};

// ================================================================
//  HELPER: Fetch ALL pages for a store
// ================================================================
const fetchAllOrders = async (store) => {
    const PAGE_SIZE = 100;
    const firstPage = await fetchOrdersPage(store, 1, PAGE_SIZE);
    if (!firstPage.success) return { orders: [], success: false, dashboardId: null };
    let allOrders = [...firstPage.orders];
    const totalPages  = firstPage.numOfPages;
    const dashboardId = firstPage.dashboardId;
    console.log(`[SYNC] Store ${store.store_id}: total=${firstPage.total}, pages=${totalPages}`);
    for (let page = 2; page <= totalPages; page++) {
        const result = await fetchOrdersPage(store, page, PAGE_SIZE);
        if (result.success && result.orders.length > 0) allOrders = [...allOrders, ...result.orders];
        await new Promise(r => setTimeout(r, 200));
    }
    console.log(`[SYNC] ✓ Store ${store.store_id}: fetched ${allOrders.length}/${firstPage.total}`);
    return { orders: allOrders, success: true, total: firstPage.total, dashboardId };
};

// ================================================================
//  HELPER: Save orders to MongoDB
// ================================================================
const saveOrdersToDatabase = async (dashboardId, store, orders) => {
    let newCount = 0, updatedCount = 0, errors = 0;
    const dashObjId = toObjId(dashboardId);

    for (const order of orders) {
        if (!order.id) { errors++; continue; }
        const orderId = String(order.id);

        try {
            const { status, fulfillment } = getOrderStatusAndFulfillment(order);
            const amount          = parseFloat(order.amount_clean || order.amount) || 0;
            const amount_clean    = parseFloat(order.amount_clean) || 0;
            const amount_subtotal = parseFloat(order.service_order?.amount_subtotal) || 0;
            const amount_shipping = parseFloat(order.service_order?.amount_shipping) || 0;
            const cost            = amount_subtotal;
            const profit          = parseFloat(order.profit) || 0;
            const fee             = parseFloat(order.service_order?.amount_fee) || 0;
            const exchange_rate   = parseFloat(order.exchange_rate) || 1;

            const cust = order.customer || {};
            const customerObj = {
                full_name: cust.full_name || '', email: cust.email || '',
                phone_number: cust.phone_number || '', country: cust.country || '',
                state: cust.state || '', city: cust.city || '',
                address: cust.address || '', address_2: cust.address_2 || '',
                postal_code: cust.postal_code || '', company: cust.company || '',
            };

            const svc = order.service_order || {};
            const serviceOrderObj = {
                id: String(svc.id || ''), status: svc.status || '', fulfillment: svc.fulfillment || '',
                amount_subtotal: String(svc.amount_subtotal || ''), amount_shipping: String(svc.amount_shipping || ''),
                amount_fee: String(svc.amount_fee || ''), amount_total: String(svc.amount_total || ''),
                tracking_number: svc.tracking_number || '', tracking_url: svc.tracking_url || '',
                carrier: svc.carrier || '',
                date_created: svc.date_created ? new Date(svc.date_created) : null,
                date_update:  (svc.date_updated || svc.date_update) ? new Date(svc.date_updated || svc.date_update) : null,
                activities: Array.isArray(svc.activities)
                    ? svc.activities.map(a => ({ type: a.type || '', date_created: a.date_created ? new Date(a.date_created) : null, message: a.message || '' }))
                    : [],
            };

            const shi = (order.shipping_info && !Array.isArray(order.shipping_info)) ? order.shipping_info : {};
            const shippingInfoObj = { activities: shi.activities || {}, tracking_code: shi.tracking_code || '', carrier: shi.carrier || '', tracking_url: shi.tracking_url || '' };

            const act = order.action || {};
            const actionObj = {
                action: act.action || '', label: act.label || act.button_text || '', url: act.url || '',
                button_bg_color: act.button_bg_color || '', button_text: act.button_text || '',
                tooltip_title: act.tooltip_title || '', tooltip_text: act.tooltip_text || '',
            };

            const products = Array.isArray(order.products)
                ? order.products.map(p => ({
                    id: String(p.id || ''), title: p.title || '',
                    quantity: parseInt(p.quantity) || 1, price: String(p.price || ''),
                    price_clear: String(p.price_clear || ''), imageUrl: p.imageUrl || '',
                    permalink: p.permalink || '',
                    tracking_number: p.tracking_number || '', sku: p.sku || '',
                    weight: String(p.weight || ''), variation_id: String(p.variation_id || ''),
                    product_id: String(p.product_id || ''),
                    sellvia_post_id: p.sellvia_post_id || 0,
                    available: parseInt(p.available) || 0,
                }))
                : [];

            const upsertResult = await SellviaOrder.findOneAndUpdate(
                { order_id: orderId },
                { $set: {
                    sellvia_dashboard_id: dashObjId, store_id: String(store.store_id),
                    store_domain: store.store_domain || '', order_id: orderId,
                    order_hash: order.hash || '', status, fulfillment,
                    amount, amount_clean, amount_subtotal, amount_shipping,
                    cost, profit, fee, currency: order.currency || 'USD',
                    currency_code: order.currency_code || 'USD', exchange_rate,
                    customer_name: cust.full_name || cust.email || '',
                    customer_email: cust.email || '', customer_phone: cust.phone_number || '',
                    customer: customerObj,
                    order_date:        order.date        ? new Date(order.date)        : new Date(),
                    updated_at_remote: order.date_update ? new Date(order.date_update) : null,
                    date_pay:          order.date_pay    ? new Date(order.date_pay)    : null,
                    products, service_order: serviceOrderObj, shipping_info: shippingInfoObj,
                    action: actionObj,
                    is_viewed: Boolean(order.is_viewed), is_refunded: Boolean(order.is_refunded),
                    is_test: Boolean(order.is_test), source: order.source || '',
                    note: order.note || '', coupon: order.coupon || '',
                    referer: order.referer || '', ip_address: order.ip_address || '',
                    raw: order,
                }},
                { upsert: true, new: false, rawResult: true }
            );
            if (upsertResult.lastErrorObject?.upserted) {
                newCount++;
                console.log(`[SYNC] ✦ NEW    order=${orderId} store=${store.store_id} amount=${amount} status=${status} fulfillment=${fulfillment}`);
            } else {
                updatedCount++;
                const old = upsertResult.value;
                if (old) {
                    const ch = [];
                    if ((old.status||'')                              !== status)                              ch.push(`status: "${old.status}"→"${status}"`);
                    if ((old.fulfillment||'')                         !== fulfillment)                         ch.push(`fulfillment: "${old.fulfillment}"→"${fulfillment}"`);
                    if (Number(old.amount)                            !== amount)                              ch.push(`amount: ${old.amount}→${amount}`);
                    if (Number(old.profit)                            !== profit)                              ch.push(`profit: ${old.profit}→${profit}`);
                    if (Number(old.fee)                               !== fee)                                 ch.push(`fee: ${old.fee}→${fee}`);
                    if ((old.action?.action||'')                      !== actionObj.action)                    ch.push(`action: "${old.action?.action}"→"${actionObj.action}"`);
                    if ((old.service_order?.fulfillment||'')          !== serviceOrderObj.fulfillment)         ch.push(`svc_fulfillment: "${old.service_order?.fulfillment}"→"${serviceOrderObj.fulfillment}"`);
                    if ((old.service_order?.status||'')               !== serviceOrderObj.status)              ch.push(`svc_status: "${old.service_order?.status}"→"${serviceOrderObj.status}"`);
                    if ((old.service_order?.tracking_number||'')      !== serviceOrderObj.tracking_number)     ch.push(`tracking: "${old.service_order?.tracking_number}"→"${serviceOrderObj.tracking_number}"`);
                    if (ch.length > 0) console.log(`[SYNC] ✎ UPDATED order=${orderId} store=${store.store_id}: ${ch.join(' | ')}`);
                }
            }
        } catch (err) {
            console.error(`[SYNC] Error saving order ${orderId}:`, err.message);
            errors++;
        }
    }

    console.log(`[SYNC] ✓ store=${store.store_id} new=${newCount} updated=${updatedCount} errors=${errors}`);

    const AUTO_SYNC_MS_LOCAL = 30 * 60 * 1000;
    const now = new Date();
    try {
        await SellviaStore.updateOne(
            { _id: store._id },
            { $set: { last_synced_at: now, next_sync_at: new Date(now.getTime() + AUTO_SYNC_MS_LOCAL), total_orders_cached: newCount + updatedCount } }
        );
    } catch (e) { console.warn('[SYNC] Could not update store timestamps:', e.message); }

    return { newCount, updatedCount };
};

// ================================================================
//  HELPER: Build aggregation summary
// ================================================================
const buildSummaryAgg = async (dashboardId, extraFilter = {}) => {
    const dashObjId = toObjId(dashboardId);
    if (!dashObjId) {
        console.error('[buildSummaryAgg] Invalid dashboardId:', dashboardId);
        return { totalRevenue: 0, totalCost: 0, totalProfit: 0, totalFee: 0, netProfit: 0, avgOrderValue: 0, statusCounts: {} };
    }
    const baseMatch = { sellvia_dashboard_id: dashObjId, ...extraFilter };
    const [summaryResult, statusResult, totalCount] = await Promise.all([
        SellviaOrder.aggregate([{ $match: baseMatch }, { $group: { _id: null, totalRevenue: { $sum: '$amount' }, totalCost: { $sum: '$cost' }, totalProfit: { $sum: '$profit' }, totalFee: { $sum: '$fee' } } }]),
        SellviaOrder.aggregate([{ $match: baseMatch }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
        SellviaOrder.countDocuments(baseMatch),
    ]);
    const agg = summaryResult[0] || { totalRevenue: 0, totalCost: 0, totalProfit: 0, totalFee: 0 };
    const statusCounts = {};
    statusResult.forEach(s => { statusCounts[s._id] = s.count; });
    return {
        totalRevenue: agg.totalRevenue, totalCost: agg.totalCost,
        totalProfit: agg.totalProfit, totalFee: agg.totalFee,
        netProfit: agg.totalProfit - agg.totalFee,
        avgOrderValue: totalCount > 0 ? agg.totalRevenue / totalCount : 0,
        statusCounts,
    };
};

// ================================================================
//  HELPER: Serialize order for frontend response
// ================================================================
const serializeOrder = (o) => ({
    order_id: o.order_id, store_id: o.store_id, store_domain: o.store_domain,
    order_hash: o.order_hash, status: o.status, fulfillment: o.fulfillment || '',
    amount: o.amount || 0, profit: o.profit || 0, cost: o.cost || 0,
    fee: o.fee || 0, currency: o.currency || 'USD',
    order_date: o.order_date, updated_at_remote: o.updated_at_remote,
    customer_name: o.customer_name, customer_email: o.customer_email, customer_phone: o.customer_phone,
    customer: o.customer || {}, products: o.products || [],
    service_order: o.service_order || {}, shipping_info: o.shipping_info || {},
    action: {
        action: o.action?.action || '', label: o.action?.label || '',
        url: o.action?.url || '', button_bg_color: o.action?.button_bg_color || '',
        button_text: o.action?.button_text || '', tooltip_title: o.action?.tooltip_title || '',
        tooltip_text: o.action?.tooltip_text || '',
    },
    raw: o.raw || {},
});

// ================================================================
//  HELPER: Sync store info from API
// ================================================================
const syncStoreInfoFromAPI = async (dashboard, dashboard_id) => {
    const headers = {
        'Authorization': dashboard.jwt_token, 'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `sell_account_token=${dashboard.jwt_token}`, 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0',
    };

    let storeList = [];
    try {
        const infoRes = await axios.post(`${dashboard.base_url}/rest/v1/account/stores/getInfo`, {}, { headers, transformResponse: [(d) => d], timeout: 30000 });
        const parsed = parseSellviaResponse(infoRes.data);
        storeList = parsed?.data?.stores || [];
        console.log(`[STORES] getInfo returned ${storeList.length} stores`);
    } catch (e) { console.warn(`[STORES] getInfo failed (${e.message}), falling back to getSitesListInfo`); }

    if (!storeList.length) {
        try {
            const listRes = await axios.post(`${dashboard.base_url}/rest/v1/account/stores/getSitesListInfo`, {}, { headers, transformResponse: [(d) => d], timeout: 30000 });
            const parsed2 = parseSellviaResponse(listRes.data);
            storeList = parsed2?.data?.sites_list_info || [];
            console.log(`[STORES] getSitesListInfo returned ${storeList.length} stores`);
        } catch (e2) { console.error(`[STORES] Both APIs failed: ${e2.message}`); }
    }

    for (const site of storeList) {
        const storeIdStr = String(site.id || site.store_id || '');
        if (!storeIdStr) continue;
        const domain    = site.title || STORE_DOMAIN_MAP[storeIdStr] || '';
        const siteName  = site.site_title || `Store ${storeIdStr}`;
        const apiStatus = typeof site.status === 'number' ? site.status : parseInt(site.status || '0');
        const isActive  = apiStatus === 1;

        // Store ID unique — preserve existing dashboard assignment
        const existingStore   = await SellviaStore.findOne({ store_id: storeIdStr });
        const dashboardToUse  = existingStore ? existingStore.sellvia_dashboard_id : toObjId(dashboard_id);

        await SellviaStore.findOneAndUpdate(
            { store_id: storeIdStr },
            {
                $set: {
                    store_name: siteName, site_title: siteName, store_domain: domain,
                    thumbnail_url: site.thumbnail || '',
                    value: typeof site.value === 'number' ? site.value : 0,
                    api_status: apiStatus, is_active: isActive,
                    service: site.service || 'sellvia.com', bill_id: site.bill_id || 0,
                    type_id: site.type_id || 0, sub_end_at: site.sub_end_at || 0,
                    created_at_remote: site.created || 0,
                },
                $setOnInsert: {
                    sellvia_dashboard_id: dashboardToUse, store_id: storeIdStr,
                    last_synced_at: null, next_sync_at: null, total_orders_cached: 0,
                },
            },
            { upsert: true, new: true }
        );
        console.log(`[STORES] ✓ store=${storeIdStr} name="${siteName}" domain="${domain}" active=${isActive}`);
    }
    return storeList.length;
};

// ================================================================
//  ROUTES
// ================================================================

router.post('/save-dashboard', verifyToken, async (req, res) => {
    try {
        const { dashboard_name, jwt_token, base_url } = req.body;
        const user_id = req.user.id;
        const existing = await SellviaDashboard.findOne({ dashboard_name, user_id });
        if (existing) return res.status(400).json({ error: 'Dashboard with this name already exists' });
        const dashboard = new SellviaDashboard({ dashboard_name, jwt_token, base_url: base_url || 'https://account.sellvia.com', user_id });
        await dashboard.save();
        res.json({ success: true, dashboard_id: dashboard._id });
    } catch (error) { res.status(500).json({ error: 'Failed to save dashboard' }); }
});

router.post('/save-stores', verifyToken, async (req, res) => {
    try {
        const { dashboard_id, stores } = req.body;
        for (const store of stores) {
            const storeIdStr = String(store.store_id);
            const domain = store.store_domain || STORE_DOMAIN_MAP[storeIdStr] || '';
            await SellviaStore.findOneAndUpdate(
                { store_id: storeIdStr },
                { sellvia_dashboard_id: toObjId(dashboard_id), store_name: store.store_name || `Store ${storeIdStr}`, store_id: storeIdStr, store_domain: domain, thumbnail_url: store.thumbnail || '', is_active: store.is_active || false },
                { upsert: true, new: true }
            );
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Failed to save stores' }); }
});

router.put('/update-jwt/:dashboard_id', verifyToken, async (req, res) => {
    try {
        const dashboard = await SellviaDashboard.findOne({ _id: req.params.dashboard_id, user_id: toObjId(req.user.id) });
        if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' });
        dashboard.jwt_token = req.body.jwt_token;
        await dashboard.save();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Failed to update JWT' }); }
});

router.get('/dashboards', verifyToken, async (req, res) => {
    try {
        const isSuperAdmin = req.user.role === 'super-admin' || req.user.role === 'superadmin';
        const matchFilter  = isSuperAdmin ? {} : { user_id: toObjId(req.user.id) };
        console.log(`[dashboards] user=${req.user.id} role=${req.user.role} superAdmin=${isSuperAdmin}`);
        const dashboards = await SellviaDashboard.aggregate([
            { $match: matchFilter },
            { $lookup: { from: 'sellviastores', localField: '_id', foreignField: 'sellvia_dashboard_id', as: 'stores' } },
            { $addFields: { total_stores: { $size: '$stores' } } },
            { $sort: { created_at: -1 } },
        ]);
        res.json({ success: true, dashboards });
    } catch (error) { res.status(500).json({ error: 'Failed to fetch dashboards' }); }
});

router.get('/stores/:dashboard_id', verifyToken, async (req, res) => {
    try {
        const stores = await SellviaStore.find({ sellvia_dashboard_id: req.params.dashboard_id }).sort({ store_name: 1 });
        res.json({ success: true, stores });
    } catch (error) { res.status(500).json({ error: 'Failed to fetch stores' }); }
});

router.post('/fetch-stores', verifyToken, async (req, res) => {
    try {
        const { base_url, token } = req.body;
        const response = await axios.post(
            `${base_url || 'https://account.sellvia.com'}/rest/v1/account/stores/getSitesListInfo`, {},
            { headers: { 'Authorization': token, 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': `sell_account_token=${token}`, 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0' }, transformResponse: [(d) => d] }
        );
        res.json(parseSellviaResponse(response.data) || {});
    } catch (error) { res.status(500).json({ error: 'Failed to fetch stores from Sellvia' }); }
});

router.post('/sync-stores/:dashboard_id', verifyToken, async (req, res) => {
    try {
        const { dashboard_id } = req.params;
        const isSuperAdmin = req.user.role === 'super-admin' || req.user.role === 'superadmin';
        const query    = isSuperAdmin ? { _id: dashboard_id } : { _id: dashboard_id, user_id: toObjId(req.user.id) };
        const dashboard = await SellviaDashboard.findOne(query);
        if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' });
        const syncedCount = await syncStoreInfoFromAPI(dashboard, dashboard_id);
        const allStores   = await SellviaStore.find({ sellvia_dashboard_id: dashboard_id }).sort({ store_name: 1 });
        res.json({ success: true, stores: allStores, synced_count: syncedCount });
    } catch (error) {
        console.error('[sync-stores] error:', error.message);
        res.status(500).json({ error: 'Failed to sync stores: ' + error.message });
    }
});

router.get('/store-sync-status/:dashboard_id', verifyToken, async (req, res) => {
    try {
        const stores = await SellviaStore.find(
            { sellvia_dashboard_id: req.params.dashboard_id },
            { store_id: 1, store_name: 1, last_synced_at: 1, next_sync_at: 1 }
        );
        let earliestNext = null, latestSynced = null;
        stores.forEach(s => {
            if (s.next_sync_at   && (!earliestNext || s.next_sync_at   < earliestNext)) earliestNext = s.next_sync_at;
            if (s.last_synced_at && (!latestSynced || s.last_synced_at > latestSynced)) latestSynced = s.last_synced_at;
        });
        res.json({ success: true, next_sync_at: earliestNext, last_synced_at: latestSynced, stores: stores.map(s => ({ store_id: s.store_id, store_name: s.store_name, last_synced_at: s.last_synced_at, next_sync_at: s.next_sync_at })) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  POST /sync-store-orders — sync ONE store
// ================================================================
router.post('/sync-store-orders', verifyToken, async (req, res) => {
    try {
        const { store_id, page = 1, limit = 50 } = req.body;
        if (!store_id) return res.status(400).json({ error: 'store_id is required' });

        const store = await SellviaStore.findOne({ store_id: String(store_id) });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const isSA1 = req.user.role === 'super-admin' || req.user.role === 'superadmin';
        const dashboard = await SellviaDashboard.findOne(
            isSA1 ? { _id: store.sellvia_dashboard_id } : { _id: store.sellvia_dashboard_id, user_id: toObjId(req.user.id) }
        );
        if (!dashboard) return res.status(403).json({ error: 'You do not have access to this store\'s dashboard' });

        // Verify company access for non-super-admin
        if (!isSA1) {
            const allowedIds = req.user?.allowedStoreIds || [];
            if (allowedIds.length > 0 && !allowedIds.includes(String(store_id))) {
                return res.status(403).json({ error: 'Access denied: store not in your company' });
            }
        }

        const dashboard_id = String(dashboard._id);
        const domain = await getStoreDomain(store);
        store.store_domain = domain;

        const result = await fetchAllOrders(store);
        let syncRes = { newCount: 0, updatedCount: 0 };
        if (result.orders?.length > 0) syncRes = await saveOrdersToDatabase(result.dashboardId || dashboard_id, store, result.orders);

        const dashObjId   = toObjId(dashboard_id);
        const storeFilter = { sellvia_dashboard_id: dashObjId, store_id: String(store_id) };
        const skip        = (parseInt(page) - 1) * parseInt(limit);
        const dbTotal     = await SellviaOrder.countDocuments(storeFilter);
        const dbOrders    = await SellviaOrder.find(storeFilter).sort({ order_date: -1 }).skip(skip).limit(parseInt(limit));
        const summary     = await buildSummaryAgg(dashboard_id, { store_id: String(store_id) });

        console.log(`[sync-store-orders] store=${store_id} new=${syncRes.newCount} updated=${syncRes.updatedCount} dbTotal=${dbTotal}`);
        res.json({ success: true, orders: dbOrders.map(serializeOrder), totalOrders: dbTotal, currentPage: parseInt(page), totalPages: Math.ceil(dbTotal / parseInt(limit)), newOrdersSynced: syncRes.newCount, updatedOrders: syncRes.updatedCount, storeDomain: domain, summary });
    } catch (error) {
        console.error('[sync-store-orders] error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
//  POST /sync-all-stores-orders — sync ALL stores
// ================================================================
router.post('/sync-all-stores-orders', verifyToken, async (req, res) => {
    try {
        const { dashboard_id } = req.body;
        if (!dashboard_id) return res.status(400).json({ error: 'dashboard_id is required' });

        const isSA2 = req.user.role === 'super-admin' || req.user.role === 'superadmin';
        const dashboard = await SellviaDashboard.findOne(isSA2 ? { _id: dashboard_id } : { _id: dashboard_id, user_id: toObjId(req.user.id) });
        if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' });

        const stores = await SellviaStore.find({ sellvia_dashboard_id: dashboard_id }).sort({ store_name: 1 });
        if (stores.length === 0) return res.status(404).json({ error: 'No stores found' });

        let totalSynced = 0;
        const results   = [];

        for (const store of stores) {
            try {
                const domain = await getStoreDomain(store);
                store.store_domain = domain;
                const result = await fetchAllOrders(store);
                let storeNew = 0, storeUpdated = 0;
                if (result.orders?.length > 0) {
                    const syncRes = await saveOrdersToDatabase(dashboard_id, store, result.orders);
                    storeNew = syncRes.newCount; storeUpdated = syncRes.updatedCount;
                }
                totalSynced += storeNew + storeUpdated;
                results.push({ store_id: store.store_id, store_name: store.store_name || store.store_domain || store.store_id, newOrders: storeNew, updatedOrders: storeUpdated, totalFetched: result.total || 0 });
                console.log(`[sync-all] ✓ store=${store.store_id} new=${storeNew} updated=${storeUpdated}`);
            } catch (storeErr) {
                console.error(`[sync-all] store=${store.store_id} error:`, storeErr.message);
                results.push({ store_id: store.store_id, store_name: store.store_name || store.store_id, newOrders: 0, updatedOrders: 0, error: storeErr.message });
            }
        }

        const summary     = await buildSummaryAgg(dashboard_id);
        const totalOrders = await SellviaOrder.countDocuments({ sellvia_dashboard_id: toObjId(dashboard_id) });
        console.log(`[sync-all] DONE totalSynced=${totalSynced} totalInDB=${totalOrders}`);
        res.json({ success: true, totalSynced, totalOrders, storeResults: results, summary });
    } catch (error) {
        console.error('[sync-all-stores-orders] error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
//  GET /store-orders-db/:dashboard_id/:store_id
// ================================================================
router.get('/store-orders-db/:dashboard_id/:store_id', verifyToken, async (req, res) => {
    try {
        const { dashboard_id, store_id } = req.params;
        const { page = 1, limit = 50, status = 'all', date_from, date_to } = req.query;

        const parsedLimit = parseInt(limit) || 50;
        const parsedPage  = parseInt(page)  || 1;

        // Company access check
        const isSA = req.user?.role === 'super-admin' || req.user?.role === 'superadmin';
        if (!isSA) {
            const allowedIds = req.user?.allowedStoreIds || [];
            if (allowedIds.length > 0 && !allowedIds.includes(String(store_id))) {
                return res.status(403).json({ error: 'Access denied: store not in your company' });
            }
        }

        const dashObjId = toObjId(dashboard_id);
        const filter    = { sellvia_dashboard_id: dashObjId, store_id: String(store_id) };

        if (status && status !== 'all') {
            if      (status === 'cancelled') filter.status = { $in: ['cancelled'] };
            else if (status === 'process')   filter.$or    = [{ fulfillment: 'delivered' }, { fulfillment: 'processing' }, { status: 'processing' }];
            else if (status === 'pending')   filter.$or    = [{ fulfillment: 'not_processed' }, { status: 'pending' }];
            else filter.status = status;
        }
        if (date_from || date_to) {
            filter.order_date = {};
            if (date_from) filter.order_date.$gte = new Date(date_from);
            if (date_to)   filter.order_date.$lte = new Date(date_to);
        }

        const skip     = (parsedPage - 1) * parsedLimit;
        const dbTotal  = await SellviaOrder.countDocuments(filter);
        const dbOrders = await SellviaOrder.find(filter).sort({ order_date: -1 }).skip(skip).limit(parsedLimit);

        const summaryFilter = { sellvia_dashboard_id: toObjId(dashboard_id), store_id: String(store_id) };
        if (status && status !== 'all') {
            if      (status === 'cancelled') summaryFilter.status = { $in: ['cancelled'] };
            else if (status === 'process')   summaryFilter.$or    = [{ fulfillment: 'delivered' }, { fulfillment: 'processing' }, { status: 'processing' }];
            else if (status === 'pending')   summaryFilter.$or    = [{ fulfillment: 'not_processed' }, { status: 'pending' }];
            else summaryFilter.status = status;
        }
        if (date_from || date_to) {
            summaryFilter.order_date = {};
            if (date_from) summaryFilter.order_date.$gte = new Date(date_from);
            if (date_to)   summaryFilter.order_date.$lte = new Date(date_to);
        }
        const [sumAgg, statAgg, totalBase] = await Promise.all([
            SellviaOrder.aggregate([{ $match: summaryFilter }, { $group: { _id: null, totalRevenue: { $sum: '$amount' }, totalCost: { $sum: '$cost' }, totalProfit: { $sum: '$profit' }, totalFee: { $sum: '$fee' } } }]),
            SellviaOrder.aggregate([{ $match: summaryFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
            SellviaOrder.countDocuments(summaryFilter),
        ]);
        const sa = sumAgg[0] || { totalRevenue: 0, totalCost: 0, totalProfit: 0, totalFee: 0 };
        const statusCounts = {};
        statAgg.forEach(s => { statusCounts[s._id] = s.count; });
        const summary = { totalRevenue: sa.totalRevenue, totalCost: sa.totalCost, totalProfit: sa.totalProfit, totalFee: sa.totalFee, netProfit: sa.totalProfit - sa.totalFee, avgOrderValue: totalBase > 0 ? sa.totalRevenue / totalBase : 0, statusCounts };

        console.log(`[store-orders-db] dash=${dashboard_id} store=${store_id} filtered=${dbTotal} returning=${dbOrders.length}`);
        res.json({ success: true, orders: dbOrders.map(serializeOrder), totalOrders: dbTotal, currentPage: parsedPage, totalPages: Math.ceil(dbTotal / parsedLimit), summary });
    } catch (error) {
        console.error('[store-orders-db] error:', error);
        res.status(500).json({ error: 'Failed to get orders: ' + error.message });
    }
});

// ================================================================
//  GET /dashboard-all-orders/:dashboard_id — ALL stores combined
// ================================================================
router.get('/dashboard-all-orders/:dashboard_id', verifyToken, async (req, res) => {
    try {
        const { dashboard_id } = req.params;
        const { page = 1, limit = 50, status = 'all', store_id = 'all', date_from, date_to, company_ids } = req.query;

        const parsedLimit = parseInt(limit) || 50;
        const parsedPage  = parseInt(page)  || 1;

        const dashObjId = toObjId(dashboard_id);
        const filter    = { sellvia_dashboard_id: dashObjId };

        // Company filter
        const selectedCompanyIds = company_ids ? (Array.isArray(company_ids) ? company_ids : company_ids.split(',').filter(Boolean)) : [];
        const companyFilter = await getCompanyStoreFilter(req, selectedCompanyIds);
        Object.assign(filter, companyFilter);

        if (status && status !== 'all') {
            if      (status === 'cancelled') filter.status = { $in: ['cancelled'] };
            else if (status === 'process')   filter.$or    = [{ fulfillment: 'delivered' }, { fulfillment: 'processing' }, { status: 'processing' }];
            else if (status === 'pending')   filter.$or    = [{ fulfillment: 'not_processed' }, { status: 'pending' }];
            else filter.status = status;
        }
        if (store_id && store_id !== 'all') filter.store_id = String(store_id);
        if (date_from || date_to) {
            filter.order_date = {};
            if (date_from) filter.order_date.$gte = new Date(date_from);
            if (date_to)   filter.order_date.$lte = new Date(date_to);
        }

        const skip     = (parsedPage - 1) * parsedLimit;
        const dbTotal  = await SellviaOrder.countDocuments(filter);
        const dbOrders = await SellviaOrder.find(filter).sort({ order_date: -1 }).skip(skip).limit(parsedLimit);

        const summaryFilter = { ...filter };
        delete summaryFilter.$or;
        delete summaryFilter.status;
        if (store_id && store_id !== 'all') summaryFilter.store_id = String(store_id);
        if (status && status !== 'all') {
            if      (status === 'cancelled') summaryFilter.status = { $in: ['cancelled'] };
            else if (status === 'process')   summaryFilter.$or    = [{ fulfillment: 'delivered' }, { fulfillment: 'processing' }, { status: 'processing' }];
            else if (status === 'pending')   summaryFilter.$or    = [{ fulfillment: 'not_processed' }, { status: 'pending' }];
            else summaryFilter.status = status;
        }
        if (date_from || date_to) {
            summaryFilter.order_date = {};
            if (date_from) summaryFilter.order_date.$gte = new Date(date_from);
            if (date_to)   summaryFilter.order_date.$lte = new Date(date_to);
        }
        const [sumAgg2, statAgg2, totalBase2] = await Promise.all([
            SellviaOrder.aggregate([{ $match: summaryFilter }, { $group: { _id: null, totalRevenue: { $sum: '$amount' }, totalCost: { $sum: '$cost' }, totalProfit: { $sum: '$profit' }, totalFee: { $sum: '$fee' } } }]),
            SellviaOrder.aggregate([{ $match: summaryFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
            SellviaOrder.countDocuments(summaryFilter),
        ]);
        const sa2 = sumAgg2[0] || { totalRevenue: 0, totalCost: 0, totalProfit: 0, totalFee: 0 };
        const statusCounts2 = {};
        statAgg2.forEach(s => { statusCounts2[s._id] = s.count; });
        const summary = { totalRevenue: sa2.totalRevenue, totalCost: sa2.totalCost, totalProfit: sa2.totalProfit, totalFee: sa2.totalFee, netProfit: sa2.totalProfit - sa2.totalFee, avgOrderValue: totalBase2 > 0 ? sa2.totalRevenue / totalBase2 : 0, statusCounts: statusCounts2 };

        console.log(`[dashboard-all-orders] dash=${dashboard_id} companyFilter=${JSON.stringify(companyFilter)} filtered=${dbTotal} returning=${dbOrders.length}`);
        res.json({ success: true, orders: dbOrders.map(serializeOrder), totalOrders: dbTotal, currentPage: parsedPage, totalPages: Math.ceil(dbTotal / parsedLimit), summary });
    } catch (error) {
        console.error('[dashboard-all-orders] error:', error);
        res.status(500).json({ error: 'Failed to get orders: ' + error.message });
    }
});

// ================================================================
//  GET /all-orders-superadmin — ALL dashboards combined
// ================================================================
router.get('/all-orders-superadmin', verifyToken, async (req, res) => {
    try {
        const isSuperAdmin = req.user.role === 'super-admin' || req.user.role === 'superadmin';
        if (!isSuperAdmin) return res.status(403).json({ error: 'Forbidden: super-admin only' });

        const { page = 1, limit = 50, status = 'all', store_id = 'all', date_from, date_to, company_ids } = req.query;
        const parsedLimit = parseInt(limit) || 50;
        const parsedPage  = parseInt(page)  || 1;

        const selectedCompanyIds = company_ids ? (Array.isArray(company_ids) ? company_ids : company_ids.split(',').filter(Boolean)) : [];
        const companyFilter = await getCompanyStoreFilter(req, selectedCompanyIds);
        const filter        = { ...companyFilter };

        if (status && status !== 'all') {
            if      (status === 'cancelled') filter.status = { $in: ['cancelled'] };
            else if (status === 'process')   filter.status = 'delivered';
            else if (status === 'pending')   filter.$or    = [{ status: { $in: ['abandoned', 'pending', 'paid'] } }, { fulfillment: 'not_processed' }, { fulfillment: '' }];
            else filter.status = status;
        }
        if (store_id && store_id !== 'all') filter.store_id = String(store_id);
        if (date_from || date_to) {
            filter.order_date = {};
            if (date_from) filter.order_date.$gte = new Date(date_from);
            if (date_to)   filter.order_date.$lte = new Date(date_to);
        }

        const skip     = (parsedPage - 1) * parsedLimit;
        const dbTotal  = await SellviaOrder.countDocuments(filter);
        const dbOrders = await SellviaOrder.find(filter).sort({ order_date: -1 }).skip(skip).limit(parsedLimit);

        const [sumAgg, statAgg, totalBase] = await Promise.all([
            SellviaOrder.aggregate([{ $match: filter }, { $group: { _id: null, totalRevenue: { $sum: '$amount' }, totalCost: { $sum: '$cost' }, totalProfit: { $sum: '$profit' }, totalFee: { $sum: '$fee' } } }]),
            SellviaOrder.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
            SellviaOrder.countDocuments(filter),
        ]);
        const sa = sumAgg[0] || { totalRevenue: 0, totalCost: 0, totalProfit: 0, totalFee: 0 };
        const statusCounts = {};
        statAgg.forEach(s => { statusCounts[s._id] = s.count; });
        const summary = { totalRevenue: sa.totalRevenue, totalCost: sa.totalCost, totalProfit: sa.totalProfit, totalFee: sa.totalFee, netProfit: sa.totalProfit - sa.totalFee, avgOrderValue: totalBase > 0 ? sa.totalRevenue / totalBase : 0, statusCounts };

        console.log(`[all-orders-superadmin] companies=${selectedCompanyIds.length} status=${status} filtered=${dbTotal} returning=${dbOrders.length}`);
        res.json({ success: true, orders: dbOrders.map(serializeOrder), totalOrders: dbTotal, currentPage: parsedPage, totalPages: Math.ceil(dbTotal / parsedLimit), summary });
    } catch (error) {
        console.error('[all-orders-superadmin] error:', error);
        res.status(500).json({ error: 'Failed to get orders: ' + error.message });
    }
});

// ================================================================
//  GET /all-stores-superadmin — ALL stores from ALL dashboards
// ================================================================
router.get('/all-stores-superadmin', verifyToken, async (req, res) => {
    try {
        const isSuperAdmin = req.user.role === 'super-admin' || req.user.role === 'superadmin';
        if (!isSuperAdmin) return res.status(403).json({ error: 'Forbidden: super-admin only' });

        const { selectedCompanyIds } = req.query;
        let stores;

        if (selectedCompanyIds) {
            try {
                const companyIdList = selectedCompanyIds.split(',').filter(Boolean);
                if (companyIdList.length > 0) {
                    // IDs are dashboard _ids (company-stores API returns dashboards as companies)
                    const dashObjIds = companyIdList.map(id => { try { return toObjId(id); } catch (_) { return null; } }).filter(Boolean);
                    stores = await SellviaStore.find({ sellvia_dashboard_id: { $in: dashObjIds } }).sort({ store_name: 1 });
                    console.log(`[all-stores-superadmin] dashboard filter: ${companyIdList.length} dashboards → ${stores.length} stores`);
                } else {
                    stores = await SellviaStore.find({}).sort({ store_name: 1 });
                }
            } catch (_) { stores = await SellviaStore.find({}).sort({ store_name: 1 }); }
        } else {
            stores = await SellviaStore.find({}).sort({ store_name: 1 });
        }

        console.log(`[all-stores-superadmin] returning ${stores.length} stores`);
        res.json({ success: true, stores });
    } catch (error) {
        console.error('[all-stores-superadmin] error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
//  GET /check-and-resync/:dashboard_id
// ================================================================
router.get('/check-and-resync/:dashboard_id', verifyToken, async (req, res) => {
    try {
        const { dashboard_id } = req.params;
        const dashObjId = toObjId(dashboard_id);
        const total   = await SellviaOrder.countDocuments({ sellvia_dashboard_id: dashObjId });
        const summary = await buildSummaryAgg(dashboard_id);

        if (total > 0 && summary.totalRevenue === 0) {
            console.log('[check-and-resync] Revenue=0 but orders exist! Auto-fixing amounts from raw...');
            const orders = await SellviaOrder.find({ sellvia_dashboard_id: dashObjId, $or: [{ amount: 0 }, { amount: null }] });
            let fixed = 0;
            for (const order of orders) {
                if (!order.raw || Object.keys(order.raw).length === 0) continue;
                const raw    = order.raw;
                const amount = parseFloat(raw.amount_clean || raw.amount) || 0;
                const profit = parseFloat(raw.profit) || 0;
                const cost   = parseFloat(raw.service_order?.amount_subtotal) || 0;
                const fee    = parseFloat(raw.service_order?.amount_fee) || 0;
                const { status, fulfillment } = getOrderStatusAndFulfillment(raw);
                if (amount > 0) {
                    await SellviaOrder.updateOne({ _id: order._id }, { $set: { amount, profit, cost, fee, status, fulfillment } });
                    fixed++;
                }
            }
            console.log(`[check-and-resync] Fixed ${fixed} orders`);
            const summaryFixed = await buildSummaryAgg(dashboard_id);
            return res.json({ success: true, autoFixed: fixed, summary: summaryFixed, totalOrders: total });
        }
        res.json({ success: true, autoFixed: 0, summary, totalOrders: total });
    } catch (error) {
        console.error('[check-and-resync] error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
//  POST /fetch-account-financials
// ================================================================
router.post('/fetch-account-financials', verifyToken, async (req, res) => {
    try {
        const dashboard = await SellviaDashboard.findById(req.body.dashboard_id);
        if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' });
        const response = await axios.post(
            `${dashboard.base_url}/rest/v1/account/MyAccount/getMyAccountData`, {},
            { headers: { 'Authorization': dashboard.jwt_token, 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': `sell_account_token=${dashboard.jwt_token}`, 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0' }, timeout: 30000, transformResponse: [(d) => d] }
        );
        const parsed = parseSellviaResponse(response.data);
        const data   = parsed?.data || {};
        res.json({ success: true, total_earnings: parseFloat(data.total_earnings) || 0, wallet_balance: parseFloat(data.amount_wallet) || 0 });
    } catch (error) {
        console.error('[fetch-account-financials] error:', error.message);
        res.json({ success: true, total_earnings: 0, wallet_balance: 0 });
    }
});

// ================================================================
//  POST /resync-amounts
// ================================================================
router.post('/resync-amounts', verifyToken, async (req, res) => {
    try {
        const dashboards = await SellviaDashboard.find({ user_id: toObjId(req.user.id) });
        const dashIds    = dashboards.map(d => d._id);
        const orders     = await SellviaOrder.find({ sellvia_dashboard_id: { $in: dashIds } });
        let updated = 0;
        for (const order of orders) {
            if (!order.raw || Object.keys(order.raw).length === 0) continue;
            const raw    = order.raw;
            const amount = parseFloat(raw.amount_clean || raw.amount) || 0;
            const profit = parseFloat(raw.profit) || 0;
            const cost   = parseFloat(raw.service_order?.amount_subtotal) || 0;
            const fee    = parseFloat(raw.service_order?.amount_fee) || 0;
            const { status, fulfillment } = getOrderStatusAndFulfillment(raw);
            if (amount !== order.amount || profit !== order.profit || status !== order.status) {
                await SellviaOrder.updateOne({ _id: order._id }, { $set: { amount, profit, cost, fee, status, fulfillment } });
                updated++;
            }
        }
        console.log(`[resync-amounts] Updated ${updated}/${orders.length} orders`);
        res.json({ success: true, message: `Updated ${updated} orders out of ${orders.length}`, total: orders.length });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================================================================
//  POST /set-store-domain
// ================================================================
router.post('/set-store-domain', verifyToken, async (req, res) => {
    try {
        const { store_id, domain } = req.body;
        if (!store_id || !domain) return res.status(400).json({ error: 'store_id and domain required' });
        const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '').trim();
        const result = await SellviaStore.updateMany({ store_id: String(store_id) }, { $set: { store_domain: cleanDomain } });
        res.json({ success: true, updated: result.modifiedCount });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ================================================================
//  GET /debug-store/:store_id
// ================================================================
router.get('/debug-store/:store_id', verifyToken, async (req, res) => {
    try {
        const { store_id } = req.params;
        const store     = await SellviaStore.findOne({ store_id: String(store_id) });
        if (!store) return res.json({ error: 'Store not found' });
        const dashboard = await SellviaDashboard.findById(store.sellvia_dashboard_id);
        const domain    = await getStoreDomain(store);
        res.json({ store_id: store.store_id, store_name: store.store_name, store_domain: store.store_domain, resolved_domain: domain, dashboard_id: store.sellvia_dashboard_id, dashboard_name: dashboard?.dashboard_name || 'Unknown', dashboard_token_preview: dashboard?.jwt_token?.substring(0, 30) + '...' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  GET /debug-order/:dashboard_id
// ================================================================
router.get('/debug-order/:dashboard_id', verifyToken, async (req, res) => {
    try {
        const dashObjId = toObjId(req.params.dashboard_id);
        const order = await SellviaOrder.findOne({ sellvia_dashboard_id: dashObjId });
        if (!order) return res.json({ error: 'No orders found', tip: 'Check dashboard_id is valid ObjectId' });
        const raw = order.raw || {};
        res.json({
            db_fields:  { order_id: order.order_id, amount: order.amount, profit: order.profit, cost: order.cost, fee: order.fee, status: order.status, fulfillment: order.fulfillment },
            raw_fields: { amount: raw.amount, amount_clean: raw.amount_clean, profit: raw.profit, svc_subtotal: raw.service_order?.amount_subtotal, svc_fee: raw.service_order?.amount_fee },
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
//  POST /sync-home-data/:dashboard_id
// ================================================================
router.post('/sync-home-data/:dashboard_id', verifyToken, async (req, res) => {
    try {
        const { dashboard_id } = req.params;
        const { store_id }     = req.body;
        const isSuperAdmin     = req.user.role === 'super-admin' || req.user.role === 'superadmin';
        const query            = isSuperAdmin ? { _id: dashboard_id } : { _id: dashboard_id, user_id: toObjId(req.user.id) };
        const dashboard        = await SellviaDashboard.findOne(query);
        if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' });

        // ── Try Sellvia API ─────────────────────────────────────
        let parsed = null;
        try {
            const response = await axios.post(
                `${dashboard.base_url}/rest/v1/account/MyAccount/getMyAccountData`, {},
                {
                    headers: {
                        'Authorization':    dashboard.jwt_token,
                        'Content-Type':     'application/x-www-form-urlencoded',
                        'Cookie':           `sell_account_token=${dashboard.jwt_token}`,
                        'X-Requested-With': 'XMLHttpRequest',
                        'User-Agent':       'Mozilla/5.0',
                    },
                    timeout: 30000,
                    transformResponse: [(d) => d],
                }
            );
            parsed = parseSellviaResponse(response.data);
        } catch (apiErr) {
            console.warn(`[sync-home-data] Sellvia API failed for dashboard ${dashboard_id}: ${apiErr.message}`);
            // ── Return zeros gracefully (don't 500) ───────────────
            return res.json({
                success: true,
                data: {
                    sellvia_dashboard_id: toObjId(dashboard_id),
                    total_earnings: 0, amount_payout: 0, balance_summary: 0,
                    progress: {
                        available_display: '0.00', available_pr: 0,
                        incoming_display: '0.00', incoming_pr: 0,
                        amount_pending_display: '0.00', amount_pending_pr: 0,
                        reserves_display: '0.00', reserves_pr: 100,
                    },
                    show_withdraw: false,
                    _api_error: apiErr.message,
                },
                message: 'API unavailable — showing cached or zero data',
            });
        }

        if (parsed?.status === 'success' && parsed?.data) {
            const data     = parsed.data;
            const homeData = {
                sellvia_dashboard_id: toObjId(dashboard_id), user_id: toObjId(req.user.id),
                total_earnings:           parseFloat(data.total_earnings)    || 0,
                total_earnings_display:   data.total_earnings_display        || '0.00',
                amount_wallet:            parseFloat(data.amount_wallet)     || 0,
                amount_payout:            parseFloat(data.amount_payout)     || 0,
                amount_payout_display:    data.amount_payout_display         || '0.00',
                balance_summary:          parseFloat(data.balance_summary)   || 0,
                balance_summary_display:  data.balance_summary_display       || '0.00',
                balance:                  parseFloat(data.balance)           || 0,
                balance_all_display:      data.balance_all_display           || '0.00',
                fastsource_balance:       data.$FastSource_balance           || {},
                progress:                 data.progress                      || {},
                show_withdraw:            data.show_withdraw                 || false,
                store_id:                 store_id                           || null,
                raw_response:             data,
                last_synced_at:           new Date(),
            };
            const filter = {
                sellvia_dashboard_id: toObjId(dashboard_id),
                ...(store_id ? { store_id: String(store_id) } : { store_id: null }),
            };
            const home = await SellviaHome.findOneAndUpdate(filter, { $set: homeData }, { upsert: true, new: true });
            res.json({ success: true, data: home, message: 'Home data synced successfully' });
        } else {
            // Sellvia returned non-success (e.g. JWT expired) — return zeros
            console.warn(`[sync-home-data] Sellvia returned non-success for dashboard ${dashboard_id}`);
            res.json({
                success: true,
                data: {
                    sellvia_dashboard_id: toObjId(dashboard_id),
                    total_earnings: 0, amount_payout: 0, balance_summary: 0,
                    progress: {
                        available_display: '0.00', available_pr: 0,
                        incoming_display: '0.00', incoming_pr: 0,
                        amount_pending_display: '0.00', amount_pending_pr: 0,
                        reserves_display: '0.00', reserves_pr: 100,
                    },
                    show_withdraw: false,
                },
                message: 'JWT may be expired — showing zero data',
            });
        }
    } catch (error) {
        console.error('[sync-home-data] error:', error.message);
        res.status(500).json({ error: 'Failed to sync home data: ' + error.message });
    }
});

// ================================================================
//  GET /home-data/:dashboard_id
// ================================================================
router.get('/home-data/:dashboard_id', verifyToken, async (req, res) => {
    try {
        const { dashboard_id } = req.params;
        const { store_id }     = req.query;
        const isSuperAdmin     = req.user.role === 'super-admin' || req.user.role === 'superadmin';
        const dashQuery        = isSuperAdmin ? { _id: dashboard_id } : { _id: dashboard_id, user_id: toObjId(req.user.id) };
        const dashboard        = await SellviaDashboard.findOne(dashQuery);
        if (!dashboard) return res.status(404).json({ error: 'Dashboard not found' });

        const filter = { sellvia_dashboard_id: toObjId(dashboard_id), store_id: (store_id && store_id !== 'all') ? String(store_id) : null };
        let homeData = await SellviaHome.findOne(filter);

        if (!homeData) {
            homeData = {
                total_earnings: 0, total_earnings_display: '0.00', amount_payout: 0,
                amount_payout_display: '0.00', balance_summary: 0, balance_summary_display: '0.00',
                fastsource_balance: { amount_pending: 0, amount_risk: 0, amount_wallet: 0 },
                progress: { available_display: '0.00', available_pr: 0, incoming_display: '0.00', incoming_pr: 0, amount_pending_display: '0.00', amount_pending_pr: 0, reserves_display: '0.00', reserves_pr: 100 },
                show_withdraw: false,
            };
        }
        res.json({ success: true, data: homeData });
    } catch (error) {
        console.error('[home-data] error:', error.message);
        res.status(500).json({ error: 'Failed to get home data: ' + error.message });
    }
});

// ================================================================
//  GET /home-stores/:dashboard_id
// ================================================================
router.get('/home-stores/:dashboard_id', verifyToken, async (req, res) => {
    try {
        const { dashboard_id } = req.params;
        const isSuperAdmin     = req.user.role === 'super-admin' || req.user.role === 'superadmin';
        const stores           = isSuperAdmin
            ? await SellviaStore.find({}).sort({ store_name: 1 })
            : await SellviaStore.find({ sellvia_dashboard_id: toObjId(dashboard_id) }).sort({ store_name: 1 });
        const allStores = [{ _id: 'all-stores', store_id: 'all', store_name: 'All Stores', is_all: true }, ...stores];
        res.json({ success: true, stores: allStores });
    } catch (error) {
        console.error('[home-stores] error:', error.message);
        res.status(500).json({ error: 'Failed to get stores: ' + error.message });
    }
});

// ================================================================
//  POST /sync-all-dashboards-superadmin
//  Super-admin "Sync Now" — syncs every dashboard + store, returns
//  per-company / per-store breakdown of new vs updated orders
// ================================================================
router.post('/sync-all-dashboards-superadmin', verifyToken, async (req, res) => {
    try {
        const isSA = req.user.role === 'super-admin' || req.user.role === 'superadmin';
        if (!isSA) return res.status(403).json({ error: 'Forbidden: super-admin only' });

        const dashboards = await SellviaDashboard.find({});
        if (!dashboards.length) return res.json({ success: true, companies: [], grandTotal: { newOrders: 0, updatedOrders: 0 } });

        let grandNew = 0, grandUpdated = 0;
        const companies = [];

        for (const dashboard of dashboards) {
            const stores = await SellviaStore.find({ sellvia_dashboard_id: dashboard._id }).sort({ store_name: 1 });
            let companyNew = 0, companyUpdated = 0;
            const storeResults = [];

            for (const store of stores) {
                try {
                    const domain = await getStoreDomain(store);
                    store.store_domain = domain;
                    const fetchResult = await fetchAllOrders(store);
                    let sNew = 0, sUpd = 0;
                    if (fetchResult.success && fetchResult.orders?.length > 0) {
                        const syncRes = await saveOrdersToDatabase(String(dashboard._id), store, fetchResult.orders);
                        sNew = syncRes.newCount; sUpd = syncRes.updatedCount;
                    }
                    companyNew += sNew; companyUpdated += sUpd;
                    storeResults.push({ store_id: store.store_id, store_name: store.store_name || store.store_domain || store.store_id, newOrders: sNew, updatedOrders: sUpd, totalFetched: fetchResult.total || 0 });
                    console.log(`[SyncNow] ✓ company="${dashboard.dashboard_name}" store=${store.store_id}(${store.store_name||store.store_domain}) new=${sNew} updated=${sUpd}`);
                } catch (storeErr) {
                    console.error(`[SyncNow] store=${store.store_id} error:`, storeErr.message);
                    storeResults.push({ store_id: store.store_id, store_name: store.store_name || store.store_id, newOrders: 0, updatedOrders: 0, error: storeErr.message });
                }
            }

            grandNew += companyNew; grandUpdated += companyUpdated;
            companies.push({ company_id: String(dashboard._id), company_name: dashboard.dashboard_name, newOrders: companyNew, updatedOrders: companyUpdated, stores: storeResults });
            console.log(`[SyncNow] Company "${dashboard.dashboard_name}" — new=${companyNew} updated=${companyUpdated}`);
        }

        console.log(`[SyncNow] DONE grandNew=${grandNew} grandUpdated=${grandUpdated}`);
        res.json({ success: true, grandTotal: { newOrders: grandNew, updatedOrders: grandUpdated }, companies });
    } catch (error) {
        console.error('[sync-all-dashboards-superadmin] error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
//  AUTO-SCHEDULER: sync all stores every 30 minutes
// ================================================================
const AUTO_SYNC_MS = 30 * 60 * 1000;

const autoSyncAllDashboards = async () => {
    try {
        console.log('[AutoSync] Starting scheduled sync for all dashboards...');
        const dashboards = await SellviaDashboard.find({});
        if (!dashboards.length) { console.log('[AutoSync] No dashboards found, skipping.'); return; }

        for (const dashboard of dashboards) {
            try {
                // ── Step 1: Update store info fields from Sellvia API ──────────
                try {
                    const updatedCount = await syncStoreInfoFromAPI(dashboard, String(dashboard._id));
                    console.log(`[AutoSync] Store info updated for dash=${dashboard._id}, stores=${updatedCount}`);
                } catch (infoErr) {
                    console.error(`[AutoSync] Store info sync failed for dash=${dashboard._id}:`, infoErr.message);
                }

                // ── Step 2: Sync orders for each store ─────────────────────────
                const stores = await SellviaStore.find({ sellvia_dashboard_id: dashboard._id }).sort({ store_name: 1 });
                if (!stores.length) continue;
                let totalSynced = 0;
                for (const store of stores) {
                    try {
                        const domain = await getStoreDomain(store);
                        store.store_domain = domain;
                        const result = await fetchAllOrders(store);
                        if (!result.success || !result.orders?.length) { console.log(`[AutoSync] No orders for store=${store.store_id}`); continue; }
                        const syncRes = await saveOrdersToDatabase(String(dashboard._id), store, result.orders);
                        totalSynced += syncRes.newCount + syncRes.updatedCount;
                        await SellviaStore.findByIdAndUpdate(store._id, {
                            $set: { last_synced_at: new Date(), total_orders_cached: syncRes.newCount + syncRes.updatedCount },
                        });
                        console.log(`[AutoSync] ✓ dash=${dashboard._id} store=${store.store_id} new=${syncRes.newCount} updated=${syncRes.updatedCount}`);
                    } catch (storeErr) { console.error(`[AutoSync] store=${store.store_id} error:`, storeErr.message); }
                }
                console.log(`[AutoSync] Dashboard ${dashboard._id} done. totalSynced=${totalSynced}`);
            } catch (dashErr) { console.error(`[AutoSync] Dashboard ${dashboard._id} error:`, dashErr.message); }
        }
        console.log('[AutoSync] Scheduled sync complete.');
    } catch (err) { console.error('[AutoSync] Fatal error:', err.message); }
};

setTimeout(() => {
    console.log(`[AutoSync] Scheduler started — will sync every ${AUTO_SYNC_MS / 60000} minutes`);
    autoSyncAllDashboards();
    setInterval(autoSyncAllDashboards, AUTO_SYNC_MS);
}, 2 * 60 * 1000);

// ================================================================
//  TOKEN: Generate / regenerate store token
// ================================================================
router.post('/generate-store-token/:store_id', verifyToken, async (req, res) => {
    try {
        const { store_id } = req.params;
        const store = await SellviaStore.findOne({ store_id: String(store_id) });
        if (!store) return res.status(404).json({ error: 'Store not found' });

        const domain = (store.store_domain || store.store_id || 'store').replace(/^https?:\/\//i, '').replace(/\/$/, '');
        const rand = require('crypto').randomBytes(20).toString('hex');
        const token = `${domain}-${rand}`;

        store.store_token = token;
        await store.save();

        res.json({ success: true, token });
    } catch (error) {
        console.error('[generate-store-token] error:', error.message);
        res.status(500).json({ error: 'Failed to generate token: ' + error.message });
    }
});

module.exports = router;