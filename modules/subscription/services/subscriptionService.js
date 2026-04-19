const mongoose = require('mongoose');
const User = require('../../auth/models/User');
const Subscription = require('../models/Subscription');
const UserSubscription = require('../models/UserSubscription');

// ✅ CORRECT: Purchase subscription - Business logic only (no HTTP calls)
exports.purchaseSubscription = async (userId, subscriptionId) => {
  try {
    // Validate user exists
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    
    // Validate subscription exists
    const subscription = await Subscription.findById(subscriptionId);
    if (!subscription) throw new Error('Subscription not found');
    
    // Create subscription period
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + subscription.durationMonths);

    // Create user subscription record
    const userSubscription = new UserSubscription({
      userId,
      subscriptionId,
      startDate,
      endDate,
      isTrial: false,
      isActive: true
    });

    await userSubscription.save();
    
    // Update user model with subscription info
    user.isSubscribed = true;
    user.subscriptionEndDate = endDate;
    await user.save();

    return { 
      success: true, 
      message: 'Subscription purchased successfully',
      subscription: userSubscription 
    };
  } catch (error) {
    throw new Error(error.message);
  }
};

// ✅ CORRECT: Check user subscription - Returns null for free users
exports.checkUserSubscription = async (userId) => {
  try {
    // Only return active, non-expired subscriptions
    const subscription = await UserSubscription.findOne({ 
      userId, 
      isActive: true,
      endDate: { $gte: new Date() } // Not expired
    }).populate('subscriptionId');

    return subscription; // Returns null if no active subscription
  } catch (error) {
    console.error('Error checking user subscription:', error);
    throw new Error('Error checking subscription status.');
  }
};