const mongoose = require('mongoose');

const unavailableDateSchema = new mongoose.Schema({
  property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  date: { type: String, required: true, index: true }, // YYYY-MM-DD
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

unavailableDateSchema.index({ property: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('UnavailableDate', unavailableDateSchema);


