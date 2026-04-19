const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  profilePicture: { type: String, default: "" },
  signupDate: { type: Date, default: Date.now },
  trialStartDate: { type: Date },
  date: { type: Date, default: Date.now },
  phone: { type: String, default: null },
  street: { type: String, default: null },
  zipcode: { type: String, default: null },
  city: { type: String, default: null },
  state: { type: String, default: null },
  country: { type: String, default: null },
  isActive: { type: Boolean, default: false }
});

module.exports = mongoose.model("User", userSchema);