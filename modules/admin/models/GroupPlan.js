const mongoose = require('mongoose');

const groupPlanSchema = new mongoose.Schema({
    planId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Subscription",
        required: true
    },
    planName: { type: String, required: true },

    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Group",
        required: true
    },
    groupName: { type: String, required: true }

}, { timestamps: true });

module.exports = mongoose.model("GroupPlan", groupPlanSchema, "groupplan");
