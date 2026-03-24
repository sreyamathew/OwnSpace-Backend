const mongoose = require('mongoose');

const preferenceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  preferences: {
    locations: [String],
    minPrice: {
      type: Number,
      default: 0
    },
    maxPrice: {
      type: Number,
      default: 0
    },
    bhk: {
      type: Number,
      default: 1
    },
    minSize: {
      type: Number,
      default: 0
    },
    furnishing: {
      type: String,
      enum: ['furnished', 'semi', 'unfurnished', 'any'],
      default: 'any'
    }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Preference', preferenceSchema);
