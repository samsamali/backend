const cron = require('node-cron');
const axios = require('axios');
const SellviaDashboard = require('../models/SellviaDashboard');
const SellviaStore = require('../models/SellviaStore');
const SellviaOrder = require('../models/SellviaOrder');

// Helper function to fetch orders (same as in routes)
const fetchOrdersFromAPI = async (dashboard, store, pageNo = 1, pageSize = 100) => {
  try {
    const requestBody = {
      pageNo: parseInt(pageNo),
      pageSize: parseInt(pageSize),
      order: 'desc',
      orderBy: 'date',
      domain: store?.store_domain || '',
      storeId: parseInt(store.store_id),
    };

    const response = await axios.post(
      `${dashboard.base_url}/rest/v1/account/orders/list`,
      requestBody,
      {
        headers: {
          'Authorization': dashboard.jwt_token,
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'Origin': dashboard.base_url,
          'Referer': `${dashboard.base_url}/me/account`,
          'Cookie': `sell_account_token=${dashboard.jwt_token}`,
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 60000
      }
    );

    if (response.data && response.data.status === 'success' && response.data.data) {
      return response.data.data.items || [];
    }
    return [];
  } catch (error) {
    console.error(`[CRON] Error fetching orders:`, error.message);
    return [];
  }
};

// Helper to save orders
const saveOrdersToDatabase = async (dashboardId, storeId, orders) => {
  let savedCount = 0;

  for (const order of orders) {
    if (!order.id) continue;

    try {
      const orderData = {
        sellvia_dashboard_id: dashboardId,
        store_id: String(storeId),
        order_id: String(order.id),
        order_hash: order.hash || '',
        status: order.status || 'pending',
        amount: parseFloat(order.amount) || 0,
        cost: parseFloat(order.service_order?.amount_subtotal) || 0,
        profit: parseFloat(order.profit) || 0,
        fee: parseFloat(order.service_order?.amount_fee) || 0,
        currency: order.currency_code || 'USD',
        customer_name: order.customer?.full_name || order.customer?.email || '',
        customer_email: order.customer?.email || '',
        customer_phone: order.customer?.phone_number || '',
        order_date: order.date ? new Date(order.date) : new Date(),
        updated_at_remote: order.date_update ? new Date(order.date_update) : new Date(),
        products: order.products || [],
        raw: order
      };

      await SellviaOrder.findOneAndUpdate(
        { order_id: orderData.order_id },
        orderData,
        { upsert: true }
      );
      savedCount++;
    } catch (err) {
      console.error(`[CRON] Error saving order ${order.id}:`, err.message);
    }
  }

  return savedCount;
};

async function syncOrdersForStore(dashboard, store) {
  try {
    console.log(`[CRON] Syncing orders for store ${store.store_id}...`);
    const orders = await fetchOrdersFromAPI(dashboard, store, 1, 100);
    const saved = await saveOrdersToDatabase(dashboard._id, store.store_id, orders);
    console.log(`[CRON] Synced ${saved} orders for store ${store.store_id}`);
    return saved;
  } catch (err) {
    console.error(`[CRON] Failed syncing orders for store ${store.store_id}:`, err.message);
    return 0;
  }
}

function scheduleSellviaOrderSyncJob() {
  console.log('[CRON] Scheduling order sync job to run every 30 minutes');

  cron.schedule('*/30 * * * *', async () => {
    console.log(`[CRON] Starting scheduled sync at ${new Date().toISOString()}`);

    try {
      const dashboards = await SellviaDashboard.find({});

      for (const dashboard of dashboards) {
        const stores = await SellviaStore.find({ sellvia_dashboard_id: dashboard._id });

        for (const store of stores) {
          await syncOrdersForStore(dashboard, store);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      console.log(`[CRON] Sync completed at ${new Date().toISOString()}`);
    } catch (err) {
      console.error('[CRON] Top-level error:', err.message);
    }
  });
}

module.exports = { scheduleSellviaOrderSyncJob };