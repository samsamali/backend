const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema({
  path: {
    type: String,
    required: true,
    unique: true
  },
  method: {
    type: String,
    required: true,
    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] // allowed HTTP methods
  },
  description: {
    type: String
  }
}, { timestamps: true });

const Route = mongoose.model('Route', routeSchema);

module.exports = Route;
