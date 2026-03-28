const mongoose = require('mongoose');

const marketNewsSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please add a title'],
    trim: true,
    maxlength: [150, 'Title cannot be more than 150 characters']
  },
  content: {
    type: String,
    required: false
  },
  author: {
    type: String,
    required: [true, 'Please add an author']
  },
  status: {
    type: String,
    enum: ['pending', 'approved'],
    default: 'pending'
  },
  date: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('MarketNews', marketNewsSchema);
