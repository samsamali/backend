const mongoose = require('mongoose');

const userSubscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    required: true,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
  },
  isTrial: {
    type: Boolean,
    default: false,
  },
  // ✅ ADDED: Track if subscription is active
  isActive: {
    type: Boolean,
    default: true,
  },
});

module.exports = mongoose.model('UserSubscription', userSubscriptionSchema);