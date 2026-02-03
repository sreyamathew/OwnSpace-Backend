const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Property title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Property description is required'],
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [1, 'Price must be greater than 0'],
    max: [999999999, 'Price cannot exceed $999,999,999']
  },
  propertyType: {
    type: String,
    required: [true, 'Property type is required'],
    enum: ['House', 'Apartment', 'Condo', 'Townhouse', 'Villa', 'Bungalow', 'Commercial', 'Land', 'Other']
  },
  status: {
    type: String,
    enum: ['active', 'sold', 'pending', 'inactive'],
    default: 'active'
  },
  bedrooms: {
    type: Number,
    min: [0, 'Bedrooms cannot be negative'],
    max: [20, 'Bedrooms cannot exceed 20']
  },
  bathrooms: {
    type: Number,
    min: [0, 'Bathrooms cannot be negative'],
    max: [20, 'Bathrooms cannot exceed 20']
  },
  area: {
    type: Number,
    min: [1, 'Area must be greater than 0'],
    max: [100000, 'Area cannot exceed 100,000 sq ft']
  },
  address: {
    street: {
      type: String,
      required: [true, 'Street address is required'],
      trim: true
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true
    },
    zipCode: {
      type: String,
      trim: true
    },
    country: {
      type: String,
      default: 'India'
    }
  },
  features: [{
    type: String,
    trim: true
  }],
  images: [{
    url: String,
    alt: String,
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Agent is required']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator is required']
  },
  views: {
    type: Number,
    default: 0
  },
  inquiries: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  soldDate: {
    type: Date
  },
  soldPrice: {
    type: Number
  },
  predictedPrice: {
    type: Number
  },
  riskCategory: {
    type: String,
    enum: ['Low', 'Medium', 'High']
  },
  riskScore: {
    type: Number,
    min: 0,
    max: 100
  },
  riskExplanation: {
    type: String
  }
}, {
  timestamps: true
});

// Index for better query performance
propertySchema.index({ status: 1, isActive: 1 });
propertySchema.index({ agent: 1 });
propertySchema.index({ createdBy: 1 });
propertySchema.index({ 'address.city': 1, 'address.state': 1 });
propertySchema.index({ propertyType: 1 });
propertySchema.index({ price: 1 });

// Virtual for full address
propertySchema.virtual('fullAddress').get(function () {
  return `${this.address.street}, ${this.address.city}, ${this.address.state} ${this.address.zipCode}`.trim();
});

// Method to increment views
propertySchema.methods.incrementViews = function () {
  this.views += 1;
  return this.save();
};

// Method to increment inquiries
propertySchema.methods.incrementInquiries = function () {
  this.inquiries += 1;
  return this.save();
};

// Static method to get active properties
propertySchema.statics.getActiveProperties = function () {
  return this.find({ isActive: true, status: 'active' })
    .populate('agent', 'name email phone agentProfile')
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 });
};

// Static method to get properties by agent
propertySchema.statics.getPropertiesByAgent = function (agentId) {
  return this.find({ agent: agentId, isActive: true })
    .populate('agent', 'name email phone agentProfile')
    .sort({ createdAt: -1 });
};

module.exports = mongoose.model('Property', propertySchema);
