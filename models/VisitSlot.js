const mongoose = require('mongoose');

const visitSlotSchema = new mongoose.Schema({
  property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  date: { type: String, required: true, index: true }, // YYYY-MM-DD in property timezone (assume local)
  startTime: { type: String, required: true }, // HH:mm
  endTime: { type: String, required: true },   // HH:mm
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isBooked: { type: Boolean, default: false, index: true },
  bookedByVisitId: { type: mongoose.Schema.Types.ObjectId, ref: 'VisitRequest' },
  isExpired: { type: Boolean, default: false, index: true },
}, { timestamps: true });

visitSlotSchema.index({ property: 1, date: 1, startTime: 1 }, { unique: true });

module.exports = mongoose.model('VisitSlot', visitSlotSchema);


