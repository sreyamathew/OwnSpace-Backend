const express = require('express');
const router = express.Router();
const Property = require('../models/Property');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const { createNotification } = require('../utils/notificationService');

// @route   GET /api/properties/debug/user
// @desc    Debug current user
// @access  Private
router.get('/debug/user', protect, async (req, res) => {
  try {
    console.log('=== DEBUG USER INFO ===');
    console.log('User from token:', req.user);
    console.log('User profile:', req.userProfile);
    console.log('User type:', req.userProfile?.userType);

    res.json({
      success: true,
      data: {
        user: req.user,
        userProfile: req.userProfile,
        userType: req.userProfile?.userType
      }
    });
  } catch (error) {
    console.error('Debug user error:', error);
    res.status(500).json({
      success: false,
      message: 'Debug error',
      error: error.message
    });
  }
});

// @route   GET /api/properties/debug/auth
// @desc    Debug authorization
// @access  Private
router.get('/debug/auth', protect, authorize('admin', 'agent'), async (req, res) => {
  try {
    console.log('=== DEBUG AUTH SUCCESS ===');
    console.log('User from token:', req.user);
    console.log('User profile:', req.userProfile);
    console.log('User type:', req.userProfile?.userType);

    res.json({
      success: true,
      message: 'Authorization successful!',
      data: {
        user: req.user,
        userProfile: req.userProfile,
        userType: req.userProfile?.userType
      }
    });
  } catch (error) {
    console.error('Debug auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Debug auth error',
      error: error.message
    });
  }
});

// @route   GET /api/properties/test
// @desc    Test endpoint to check if routes are working
// @access  Public
router.get('/test', async (req, res) => {
  try {
    console.log('=== TEST ENDPOINT HIT ===');
    console.log('Headers:', req.headers);
    
    res.json({
      success: true,
      message: 'Property routes are working!',
      timestamp: new Date().toISOString(),
      headers: req.headers.authorization ? 'Auth header present' : 'No auth header'
    });
  } catch (error) {
    console.error('Test endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Test endpoint error',
      error: error.message
    });
  }
});

// @route   GET /api/properties
// @desc    Get all active properties (Public)
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      propertyType, 
      minPrice, 
      maxPrice, 
      city, 
      state,
      bedrooms,
      bathrooms,
      sortBy
    } = req.query;

    // Build filter object - include both active and sold properties for public viewing
    const filter = { isActive: true, status: { $in: ['active', 'sold'] } };
    
    if (propertyType) filter.propertyType = propertyType;
    if (city) filter['address.city'] = new RegExp(city, 'i');
    if (state) filter['address.state'] = new RegExp(state, 'i');
    if (bedrooms) filter.bedrooms = parseInt(bedrooms);
    if (bathrooms) filter.bathrooms = parseInt(bathrooms);
    
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseInt(minPrice);
      if (maxPrice) filter.price.$lte = parseInt(maxPrice);
    }

    // Build sort object
    let sort = { createdAt: -1 }; // Default sort
    
    if (sortBy) {
      switch (sortBy) {
        case 'price-low-high':
          sort = { price: 1 };
          break;
        case 'price-high-low':
          sort = { price: -1 };
          break;
        case 'newest':
          sort = { createdAt: -1 };
          break;
        case 'oldest':
          sort = { createdAt: 1 };
          break;
        default:
          sort = { createdAt: -1 };
      }
    }

    const properties = await Property.find(filter)
      .populate('agent', 'name email phone agentProfile')
      .populate('createdBy', 'name email')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Property.countDocuments(filter);

    res.json({
      success: true,
      data: {
        properties,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      },
      message: 'Properties retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching properties:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch properties',
      error: error.message
    });
  }
});

// @route   GET /api/properties/:id
// @desc    Get single property by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id)
      .populate('agent', 'name email phone agentProfile')
      .populate('createdBy', 'name email');

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Increment views
    await property.incrementViews();

    res.json({
      success: true,
      data: property,
      message: 'Property retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch property',
      error: error.message
    });
  }
});

// @route   POST /api/properties
// @desc    Create new property
// @access  Private (Admin or Agent)
router.post('/', protect, authorize('admin', 'agent'), async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      propertyType,
      status,
      bedrooms,
      bathrooms,
      area,
      address,
      features,
      images,
      agent
    } = req.body;

    // Validate required fields
    if (!title || !description || !price || !propertyType || !address) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    // If user is an agent, they can only create properties for themselves
    let assignedAgent = agent;
    if (req.userProfile.userType === 'agent') {
      assignedAgent = req.user.userId;
    } else if (req.userProfile.userType === 'admin' && agent) {
      // Admin can assign to any agent
      const agentExists = await User.findOne({ _id: agent, userType: 'agent' });
      if (!agentExists) {
        return res.status(400).json({
          success: false,
          message: 'Invalid agent ID'
        });
      }
    } else {
      // Admin creating without specifying agent - assign to themselves
      assignedAgent = req.user.userId;
    }

    const property = new Property({
      title,
      description,
      price,
      propertyType,
      status: status || 'active',
      bedrooms,
      bathrooms,
      area,
      address,
      features: features || [],
      images: images || [],
      agent: assignedAgent,
      createdBy: req.user.userId
    });

    await property.save();

    // Populate the response
    await property.populate('agent', 'name email phone agentProfile');
    await property.populate('createdBy', 'name email');

    try {
      await createNotification({
        userId: req.user.userId,
        type: 'status',
        title: 'Property Listed Successfully',
        message: `${title} has been published and is now live.`,
        metadata: { propertyId: property._id }
      });
    } catch (notifyErr) {
      console.warn('Failed to send property creation notification:', notifyErr?.message || notifyErr);
    }

    res.status(201).json({
      success: true,
      data: property,
      message: 'Property created successfully'
    });
  } catch (error) {
    console.error('Error creating property:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create property',
      error: error.message
    });
  }
});

// @route   PUT /api/properties/:id
// @desc    Update property
// @access  Private (Admin or Property Agent)
router.put('/:id', protect, authorize('admin', 'agent'), async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Check if user can update this property
    if (req.userProfile.userType === 'agent' && property.agent.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this property'
      });
    }

    const updatedProperty = await Property.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true, runValidators: true }
    )
    .populate('agent', 'name email phone agentProfile')
    .populate('createdBy', 'name email');

    res.json({
      success: true,
      data: updatedProperty,
      message: 'Property updated successfully'
    });
  } catch (error) {
    console.error('Error updating property:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update property',
      error: error.message
    });
  }
});

// @route   DELETE /api/properties/:id
// @desc    Delete property (soft delete)
// @access  Private (Admin or Property Agent)
router.delete('/:id', protect, authorize('admin', 'agent'), async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found'
      });
    }

    // Check if user can delete this property
    if (req.userProfile.userType === 'agent' && property.agent.toString() !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this property'
      });
    }

    // Soft delete
    property.isActive = false;
    property.status = 'inactive';
    await property.save();

    res.json({
      success: true,
      message: 'Property deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting property:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete property',
      error: error.message
    });
  }
});

// @route   GET /api/properties/agent/:agentId
// @desc    Get properties by agent
// @access  Public
router.get('/agent/:agentId', async (req, res) => {
  try {
    const properties = await Property.getPropertiesByAgent(req.params.agentId);

    res.json({
      success: true,
      data: properties,
      message: 'Agent properties retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching agent properties:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch agent properties',
      error: error.message
    });
  }
});

module.exports = router;
