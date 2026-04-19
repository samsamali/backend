const mongoose = require('mongoose');

const userModuleStatusSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  moduleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Module',
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'inactive'
  }
}, { timestamps: true });

const UserModuleStatus = mongoose.model('UserModuleStatus', userModuleStatusSchema);

module.exports = UserModuleStatus;
