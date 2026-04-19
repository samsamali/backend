const mongoose = require("mongoose");

const ebayUserSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true },
  ebay_username: { type: String },
  ebay_email: { type: String },
  login_method: { type: String, enum: ["username", "email"] },
  connected_at: { type: Date, default: Date.now },
  is_active: { type: Boolean, default: true },
  session_id: { type: String } 
});

ebayUserSchema.index({ user_id: 1, is_active: 1 }, { unique: true });

module.exports = mongoose.model("EbayUser", ebayUserSchema);
