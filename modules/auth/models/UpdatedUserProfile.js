const mongoose = require("mongoose");

const UpdatedUserProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  phone: String,
  country: String,
  street: String,
  city: String,
  state: String,
  zipcode: String,
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("UpdatedUserProfile", UpdatedUserProfileSchema);
