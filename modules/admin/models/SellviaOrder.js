const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    id:              { type: String, default: '' },
    title:           { type: String, default: '' },
    quantity:        { type: Number, default: 1  },
    price:           { type: String, default: '' },
    price_clear:     { type: String, default: '' },
    imageUrl:        { type: String, default: '' },
    permalink:       { type: String, default: '' },
    tracking_number: { type: String, default: '' },
    sku:             { type: String, default: '' },
    weight:          { type: String, default: '' },
    variation_id:    { type: String, default: '' },
    product_id:      { type: String, default: '' },
    sellvia_post_id: { type: Number, default: 0  },
    available:       { type: Number, default: 0  },
}, { _id: false });

const activitySchema = new mongoose.Schema({
    type:         { type: String, default: '' },
    date_created: { type: Date,   default: null },
    message:      { type: String, default: '' },
}, { _id: false });

const serviceOrderSchema = new mongoose.Schema({
    id:              { type: String,           default: '' },
    status:          { type: String,           default: '' },
    fulfillment:     { type: String,           default: '' },
    amount_subtotal: { type: String,           default: '' },
    amount_shipping: { type: String,           default: '' },
    amount_fee:      { type: String,           default: '' },
    amount_total:    { type: String,           default: '' },
    tracking_number: { type: String,           default: '' },
    tracking_url:    { type: String,           default: '' },
    carrier:         { type: String,           default: '' },
    date_created:    { type: Date,             default: null },
    date_update:     { type: Date,             default: null },
    activities:      { type: [activitySchema], default: [] },
}, { _id: false });

const customerSchema = new mongoose.Schema({
    full_name:    { type: String, default: '' },
    email:        { type: String, default: '' },
    phone_number: { type: String, default: '' },
    country:      { type: String, default: '' },
    state:        { type: String, default: '' },
    city:         { type: String, default: '' },
    address:      { type: String, default: '' },
    address_2:    { type: String, default: '' },
    postal_code:  { type: String, default: '' },
    company:      { type: String, default: '' },
}, { _id: false });

const shippingInfoSchema = new mongoose.Schema({
    activities:    { type: mongoose.Schema.Types.Mixed, default: {} },
    tracking_code: { type: String, default: '' },
    carrier:       { type: String, default: '' },
    tracking_url:  { type: String, default: '' },
}, { _id: false });

// ── Action schema — saves full button details from Sellvia API ──────────────
const actionSchema = new mongoose.Schema({
    action:         { type: String, default: '' },  // "payOrder", "processAndPay", "processed", etc.
    label:          { type: String, default: '' },
    url:            { type: String, default: '' },  // redirect URL if any
    button_bg_color:{ type: String, default: '' },  // e.g. "#1A1E25"
    button_text:    { type: String, default: '' },  // e.g. "Process order"
    tooltip_title:  { type: String, default: '' },
    tooltip_text:   { type: String, default: '' },
}, { _id: false });

const sellviaOrderSchema = new mongoose.Schema(
  {
    sellvia_dashboard_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SellviaDashboard', required: true, index: true },
    store_id:             { type: String, required: true, index: true },
    store_domain:         { type: String, default: '' },

    order_id:   { type: String, required: true, unique: true, index: true },
    order_hash: { type: String, default: '', index: true },

    status:      { type: String, default: 'pending', index: true },
    fulfillment: { type: String, default: '',         index: true },

    amount:          { type: Number, default: 0 },
    amount_clean:    { type: Number, default: 0 },
    amount_subtotal: { type: Number, default: 0 },
    amount_shipping: { type: Number, default: 0 },
    cost:            { type: Number, default: 0 },
    profit:          { type: Number, default: 0 },
    fee:             { type: Number, default: 0 },
    currency:        { type: String, default: 'USD' },
    currency_code:   { type: String, default: 'USD' },
    exchange_rate:   { type: Number, default: 1 },

    customer_name:  { type: String, default: '', index: true },
    customer_email: { type: String, default: '', index: true },
    customer_phone: { type: String, default: '' },
    customer:       { type: customerSchema, default: () => ({}) },

    order_date:        { type: Date, required: true, index: true },
    updated_at_remote: { type: Date, default: null },
    date_pay:          { type: Date, default: null },

    products:      { type: [productSchema],    default: [] },
    service_order: { type: serviceOrderSchema, default: () => ({}) },
    shipping_info: { type: shippingInfoSchema, default: () => ({}) },

    // Full action object with button styling from Sellvia API
    action: { type: actionSchema, default: () => ({}) },

    is_viewed:   { type: Boolean, default: false },
    is_refunded: { type: Boolean, default: false },
    is_test:     { type: Boolean, default: false },
    source:      { type: String,  default: '' },
    note:        { type: String,  default: '' },
    coupon:      { type: String,  default: '' },
    referer:     { type: String,  default: '' },
    ip_address:  { type: String,  default: '' },

    raw: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

sellviaOrderSchema.index({ sellvia_dashboard_id: 1, store_id: 1, order_date: -1 });
sellviaOrderSchema.index({ sellvia_dashboard_id: 1, status: 1 });
sellviaOrderSchema.index({ sellvia_dashboard_id: 1, fulfillment: 1 });
sellviaOrderSchema.index({ store_id: 1, status: 1 });
sellviaOrderSchema.index({ order_date: -1 });
sellviaOrderSchema.index({ customer_email: 1 });

module.exports = mongoose.model('SellviaOrder', sellviaOrderSchema);