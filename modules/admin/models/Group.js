const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
    groupName: { type: String, required: true, unique: true },
    description: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Group', groupSchema);