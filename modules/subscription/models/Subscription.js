const mongoose = require("mongoose");

const SubscriptionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  features: { type: [String], required: true },
  maxCompanies: { type: Number, default: 1 },
  trialPeriodDays: { type: Number, default: 0 },
  price: { type: Number, required: true },
  durationMonths: { type: Number, required: true },
  isActive: { type: Boolean, default: true },
});

const Subscription = mongoose.model("Subscription", SubscriptionSchema);

module.exports = Subscription;
