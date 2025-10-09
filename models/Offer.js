const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true
  },
  investorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  preferredDate: {
    type: Date,
    required: false
  },
  offerAmount: {
    type: Number,
    required: true
  },
  message: {
    type: String,
    default: "I'm interested in buying this property."
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'withdrawn', 'advance_paid'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  // Advance payment tracking (optional)
  advancePaid: {
    type: Boolean,
    default: false
  },
  advanceAmount: {
    type: Number,
    required: false
  },
  advancePaidAt: {
    type: Date,
    required: false
  },
  paymentRef: {
    orderId: { type: String },
    paymentId: { type: String },
    signature: { type: String },
    method: { type: String }
  },
  paymentDetails: {
    amount: { type: Number },
    orderId: { type: String },
    paymentId: { type: String },
    signature: { type: String },
    method: { type: String },
    date: { type: Date }
  }
});

// Update the updatedAt field on save
offerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Offer', offerSchema);