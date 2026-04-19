const mongoose = require("mongoose");

const moduleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    description: String,
    route_path: {
      type: String,
      required: true,
      unique: true,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    icon: { type: String },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    parent_id: {
      // optional, agar nested categories chahiye ho
      type: mongoose.Schema.Types.ObjectId,
      ref: "Module",
      default: null,
    },
    is_category: {
      // optional, agar category vs feature differentiate karna ho
      type: Boolean,
      default: false,
    },
    order: {
      type: Number,
      required: true,
      default: 0, // Default order if not specified
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    // yeh option automatically `created_at` aur `updated_at` fields bana dega
  }
);

const Module = mongoose.model("Module", moduleSchema);
module.exports = Module;
