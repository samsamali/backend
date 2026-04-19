const User = require('../../auth/models/User');
const Subscription = require('../models/Subscription');
const UserSubscription = require('../models/UserSubscription');
const Group = require('../../admin/models/Group');
const GroupPlan = require('../../admin/models/GroupPlan');
const UserGroup = require('../../admin/models/user-groups');


// ========================
// CREATE SUBSCRIPTION PLAN
// ========================
exports.createSubscription = async (req, res) => {
  try {
    const { name, features, maxCompanies, price, durationMonths, isActive, groupId } = req.body;
    if (!name || !features || !price || !durationMonths || !groupId) {
      return res.status(400).json({ message: 'All required fields must be provided.' });
    }

    const newPlan = await Subscription.create({
      name,
      features,
      maxCompanies,
      price,
      durationMonths,
      isActive: isActive !== undefined ? isActive : true
    });

    // Save mapping plan -> group in GroupPlan collection
    await GroupPlan.create({
      planId: newPlan._id,
      planName: newPlan.name,
      groupId,
      groupName: (await Group.findById(groupId)).groupName
    });

    res.status(201).json(newPlan);
  } catch (err) {
    console.error('Error creating subscription:', err);
    res.status(500).json({ message: 'Error creating subscription', error: err.message });
  }
};

// ========================
// GET ALL SUBSCRIPTIONS WITH GROUP INFO
// ========================
exports.getAllSubscriptions = async (req, res) => {
  try {
    // Get all subscriptions
    const subscriptions = await Subscription.find();
    
    // Get all group plans
    const groupPlans = await GroupPlan.find({ 
      planId: { $in: subscriptions.map(s => s._id) } 
    });
    
    // Convert subscriptions to plain objects and add group info
    const subscriptionsWithGroup = subscriptions.map(subscription => {
      const subscriptionObj = subscription.toObject();
      const groupPlan = groupPlans.find(gp => 
        gp.planId.toString() === subscription._id.toString()
      );
      
      if (groupPlan) {
        subscriptionObj.groupId = groupPlan.groupId;
        subscriptionObj.groupName = groupPlan.groupName;
      } else {
        subscriptionObj.groupId = null;
        subscriptionObj.groupName = null;
      }
      
      return subscriptionObj;
    });

    res.status(200).json(subscriptionsWithGroup);
  } catch (err) {
    console.error('Error fetching subscriptions:', err);
    res.status(500).json({ 
      message: 'Error fetching subscriptions', 
      error: err.message 
    });
  }
};

// ========================
// UPDATE SUBSCRIPTION
// ========================
exports.updateSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!subscription) return res.status(404).json({ message: 'Subscription not found' });

    // Also update group mapping if groupId changed
    if (req.body.groupId) {
      const mapping = await GroupPlan.findOne({ planId: subscription._id });
      if (mapping) {
        mapping.groupId = req.body.groupId;
        mapping.groupName = (await Group.findById(req.body.groupId)).groupName;
        await mapping.save();
      }
    }

    res.status(200).json(subscription);
  } catch (err) {
    res.status(500).json({ message: 'Error updating subscription', error: err });
  }
};

// ========================
// DELETE SUBSCRIPTION
// ========================
exports.deleteSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findByIdAndDelete(req.params.id);
    if (!subscription) return res.status(404).json({ message: 'Subscription not found' });

    // Delete mapping in GroupPlan
    await GroupPlan.findOneAndDelete({ planId: subscription._id });

    res.status(200).json({ message: 'Subscription deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting subscription', error: err });
  }
};


// ========================
// PURCHASE SUBSCRIPTION (UPDATED VERSION)
// ========================
exports.purchaseSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    
    // Get userId from decoded JWT token (use req.user.userId instead of req.user.id)
    const userId = req.user.userId || req.user.id;
    
    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: "User ID not found in token" 
      });
    }

    if (!subscriptionId) {
      return res.status(400).json({ 
        success: false, 
        message: "subscriptionId is required" 
      });
    }

    // 1. Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    // 2. Find subscription plan
    const plan = await Subscription.findById(subscriptionId);
    if (!plan) {
      return res.status(404).json({ 
        success: false, 
        message: "Subscription plan not found" 
      });
    }

    // Check if plan is active
    if (!plan.isActive) {
      return res.status(400).json({ 
        success: false, 
        message: "This subscription plan is not active" 
      });
    }

    // 3. Find GroupPlan mapping
    const mapping = await GroupPlan.findOne({ planId: subscriptionId });
    if (!mapping) {
      return res.status(404).json({ 
        success: false, 
        message: "No group mapped to this subscription plan" 
      });
    }

    // 4. Calculate remaining trial days (if any)
    let extraDays = 0;
    if (user.trialStartDate) {
      const trialEnd = new Date(user.trialStartDate);
      trialEnd.setDate(trialEnd.getDate() + 14); // 14 days trial
      const today = new Date();

      if (trialEnd > today) {
        extraDays = Math.ceil((trialEnd - today) / (1000 * 60 * 60 * 24));
      }

      // Mark trial as used
      user.trialStartDate = null;
    }

    // 5. Calculate dates
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + plan.durationMonths);
    
    // Add extra trial days if any
    if (extraDays > 0) {
      endDate.setDate(endDate.getDate() + extraDays);
    }

    // 6. Find existing user subscription
    let userSubscription = await UserSubscription.findOne({ userId: userId });

    if (userSubscription) {
      // If user already has a subscription, update it
      userSubscription.subscriptionId = subscriptionId;
      userSubscription.planName = plan.name;
      userSubscription.startDate = startDate;
      userSubscription.endDate = endDate;
      userSubscription.isTrial = false;
      userSubscription.isActive = true;
      await userSubscription.save();
    } else {
      // Create new subscription record
      userSubscription = await UserSubscription.create({
        userId: userId,
        subscriptionId: subscriptionId,
        planName: plan.name,
        startDate: startDate,
        endDate: endDate,
        isTrial: false,
        isActive: true,
        features: plan.features || [],
        maxCompanies: plan.maxCompanies || 0,
        price: plan.price || 0,
        durationMonths: plan.durationMonths || 0
      });
    }

    // 7. Update user's group based on subscription
    // First, update the User model
    user.groupId = mapping.groupId;
    user.groupName = mapping.groupName;
    user.isActive = true; // Ensure user is active
    
    // Save user updates
    await user.save();

    // 8. Update UserGroup collection
    let userGroup = await UserGroup.findOne({ userId: userId });
    
    if (userGroup) {
      // Update existing user-group mapping
      userGroup.groupId = mapping.groupId;
      userGroup.groupName = mapping.groupName;
      await userGroup.save();
    } else {
      // Create new user-group mapping
      await UserGroup.create({
        userId: userId,
        groupId: mapping.groupId,
        groupName: mapping.groupName
      });
    }

    // 9. Populate response data
    const populatedUserSubscription = await UserSubscription.findById(userSubscription._id)
      .populate('subscriptionId', 'name price durationMonths features maxCompanies')
      .lean();

    // 10. Return success response
    res.status(200).json({
      success: true,
      message: "Subscription purchased successfully",
      data: {
        subscription: populatedUserSubscription,
        user: {
          userId: user._id,
          name: user.name,
          email: user.email,
          groupId: user.groupId,
          groupName: user.groupName,
          isActive: user.isActive
        },
        plan: {
          _id: plan._id,
          name: plan.name,
          price: plan.price,
          durationMonths: plan.durationMonths,
          features: plan.features
        },
        group: {
          groupId: mapping.groupId,
          groupName: mapping.groupName
        },
        dates: {
          startDate: startDate,
          endDate: endDate,
          totalDays: Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))
        }
      }
    });

  } catch (err) {
    console.error("Error in purchaseSubscription:", err);
    res.status(500).json({ 
      success: false,
      message: "Error processing subscription purchase", 
      error: err.message 
    });
  }
};