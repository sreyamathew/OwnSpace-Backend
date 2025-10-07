const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// Create a new offer
router.post('/', protect, async (req, res) => {
  try {
    const { propertyId, investorId, agentId, offerAmount, amount, message, preferredDate } = req.body;
    
    // Validate required fields
    if (!propertyId || !investorId || !agentId) {
      return res.status(400).json({ message: 'Property, investor, and agent IDs are required' });
    }

    const newOffer = new Offer({
      propertyId,
      investorId,
      agentId,
      offerAmount: typeof amount === 'number' ? amount : (offerAmount || 0),
      message: message || "I'm interested in buying this property.",
      preferredDate: preferredDate ? new Date(preferredDate) : undefined
    });

    const savedOffer = await newOffer.save();
    
    res.status(201).json({
      success: true,
      offer: savedOffer
    });
  } catch (err) {
    console.error('Error creating offer:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get offers created by the current user (investor)
router.get('/my', protect, async (req, res) => {
  try {
    // use authenticated profile id from middleware
    const offers = await Offer.find({ investorId: req.userProfile._id })
      .populate('propertyId', 'title address price images')
      .populate('investorId', 'name email')
      .populate('agentId', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: offers.length, offers });
  } catch (err) {
    console.error('Error fetching my offers:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
// Get offers by specific user id (admin/agent can view others; user can view own)
router.get('/:userId', protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const requester = req.userProfile;
    if (!requester) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Users can only view their own offers unless admin/agent
    if (String(requester._id) !== String(userId) && !['admin','agent'].includes(requester.userType)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const offers = await Offer.find({ investorId: userId })
      .populate('propertyId', 'title address price images')
      .populate('investorId', 'name email')
      .populate('agentId', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: offers.length, offers });
  } catch (err) {
    console.error('Error fetching offers by userId:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


// Get offers received for properties managed by the current agent (or all for admin)
router.get('/received', protect, async (req, res) => {
  try {
    // user profile is already loaded by protect middleware
    const user = req.userProfile;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    let filter = {};
    if (user.userType === 'admin') {
      // Admin can see all offers
      filter = {};
    } else if (user.userType === 'agent') {
      // Agent sees offers assigned to them
      filter = { agentId: user._id };
    } else {
      // Other roles not allowed
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const offers = await Offer.find(filter)
      .populate('propertyId', 'title address price images')
      .populate('investorId', 'name email')
      .populate('agentId', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: offers.length, offers });
  } catch (err) {
    console.error('Error fetching received offers:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Update offer status (Approve/Reject)
router.put('/:offerId', protect, async (req, res) => {
  try {
    const { offerId } = req.params;
    const { status } = req.body;
    
    // Normalize and validate status
    const normalized = typeof status === 'string' ? status.toLowerCase() : '';
    // Map UI terms to model enum
    const statusMap = {
      approved: 'accepted',
      rejected: 'rejected',
      pending: 'pending',
    };
    const mappedStatus = statusMap[normalized];

    if (!mappedStatus || !['pending', 'accepted', 'rejected'].includes(mappedStatus)) {
      return res.status(400).json({ 
        success: false,
        message: 'Valid status (approved, rejected, or pending) is required' 
      });
    }
    
    // Check if user is admin or agent
    const user = req.userProfile;
    if (!user || (user.userType !== 'admin' && user.userType !== 'agent')) {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. Only admins and agents can update offer status' 
      });
    }
    
    // Find and update the offer
    const offer = await Offer.findById(offerId);
    
    if (!offer) {
      return res.status(404).json({ 
        success: false,
        message: 'Offer not found' 
      });
    }
    
    // Check if the agent is authorized to update this offer
    if (user.userType === 'agent' && offer.agentId.toString() !== user._id.toString()) {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. You can only update offers assigned to you' 
      });
    }
    
    // Update the offer
    offer.status = mappedStatus;
    offer.updatedAt = Date.now();
    
    const updatedOffer = await offer.save();
    
    res.status(200).json({
      success: true,
      message: `Offer has been ${normalized}`,
      offer: updatedOffer
    });
    
  } catch (err) {
    console.error('Error updating offer:', err);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: err.message 
    });
  }
});

module.exports = router;