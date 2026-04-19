const mongoose = require("mongoose");

const ebayTokenSchema = new mongoose.Schema({
  access_token: String,
  expires_in: Number,
  refresh_token: String,
  refresh_token_expires_in: Number,
  token_type: String,
  user_id: String,
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model("EbayToken", ebayTokenSchema);