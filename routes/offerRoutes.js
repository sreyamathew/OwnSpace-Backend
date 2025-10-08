const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const User = require('../models/User');
const Property = require('../models/Property');
const { protect } = require('../middleware/auth');
const transporter = require('../utils/mailer');

// Create a new offer
router.post('/', protect, async (req, res) => {
  try {
    const { propertyId, investorId, agentId, offerAmount, amount, message, preferredDate } = req.body;
    
    // Validate required fields
    if (!propertyId) {
      return res.status(400).json({ message: 'Property ID is required' });
    }

    // Resolve investorId from auth if not provided
    const resolvedInvestorId = investorId || req.userProfile?._id;

    // Resolve agentId from property if not provided
    let resolvedAgentId = agentId;
    if (!resolvedAgentId) {
      const prop = await Property.findById(propertyId).select('agent');
      if (!prop || !prop.agent) {
        return res.status(400).json({ message: 'Unable to resolve agent for this property' });
      }
      resolvedAgentId = prop.agent;
    }

    const newOffer = new Offer({
      propertyId,
      investorId: resolvedInvestorId,
      agentId: resolvedAgentId,
      offerAmount: typeof amount === 'number' ? amount : (offerAmount || 0),
      message: message || "I'm interested in buying this property.",
      preferredDate: preferredDate ? new Date(preferredDate) : undefined
    });

    const savedOffer = await newOffer.save();
    // Best-effort email notification to agent about new purchase request
    try {
      const [agentUser, investorUser, property] = await Promise.all([
        User.findById(resolvedAgentId).select('name email'),
        User.findById(resolvedInvestorId).select('name email'),
        Property.findById(propertyId).select('title address price')
      ]);

      if (agentUser?.email) {
        const buyerName = investorUser?.name || 'A buyer';
        const propTitle = property?.title || 'a property';
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: agentUser.email,
          subject: 'New Purchase Request Received',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="margin:0 0 12px 0;">New Purchase Request</h2>
              <p>${buyerName} has sent a purchase request for <strong>${propTitle}</strong>.</p>
              <p>Offer amount: <strong>₹${(typeof amount === 'number' ? amount : offerAmount || 0).toLocaleString('en-IN')}</strong></p>
              <p>Please review the request in your dashboard.</p>
            </div>
          `
        });
      }
    } catch (mailErr) {
      console.warn('Failed to send new offer email:', mailErr?.message || mailErr);
    }
    
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
// IMPORTANT: Keep specific routes before generic "/:userId" to avoid shadowing
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

    if (!offers || offers.length === 0) {
      return res.status(200).json({ success: true, message: 'No offer requests found', offers: [] });
    }
    res.status(200).json({ success: true, count: offers.length, offers });
  } catch (err) {
    console.error('Error fetching received offers:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get offers by specific agent id (agent themselves or admin)
router.get('/agent/:agentId', protect, async (req, res) => {
  try {
    const { agentId } = req.params;
    const requester = req.userProfile;
    if (!requester) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Agents can only view their own; admins can view any agent
    if (requester.userType === 'agent' && String(requester._id) !== String(agentId)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const offers = await Offer.find({ agentId })
      .populate('propertyId', 'title address price images')
      .populate('investorId', 'name email')
      .populate('agentId', 'name email')
      .sort({ createdAt: -1 });

    if (!offers || offers.length === 0) {
      return res.status(200).json({ success: true, message: 'No offer requests found', offers: [] });
    }
    res.status(200).json({ success: true, count: offers.length, offers });
  } catch (err) {
    console.error('Error fetching offers by agent:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// Get offers by specific user id (admin/agent can view others; user can view own)
// NOTE: This generic route must come AFTER '/received' and '/agent/:agentId'
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

// Mark advance payment as paid and store transaction
router.post('/:offerId/advance', protect, async (req, res) => {
  try {
    const { offerId } = req.params;
    const { amount, orderId, paymentId, signature, method } = req.body || {};

    const offer = await Offer.findById(offerId);
    if (!offer) return res.status(404).json({ success: false, message: 'Offer not found' });

    // Ensure requester is the investor
    if (String(offer.investorId) !== String(req.userProfile._id)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    offer.advancePaid = true;
    offer.advanceAmount = Number(amount || 0);
    offer.advancePaidAt = new Date();
    offer.paymentRef = { orderId, paymentId, signature, method };
    await offer.save();

    // Notify agent/admin that advance was paid
    try {
      const [agentUser, investorUser, property] = await Promise.all([
        User.findById(offer.agentId).select('name email'),
        User.findById(offer.investorId).select('name email'),
        Property.findById(offer.propertyId).select('title')
      ]);
      if (agentUser?.email) {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: agentUser.email,
          subject: 'Advance Payment Received',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="margin:0 0 12px 0;">Advance Payment Received</h2>
              <p>The buyer ${investorUser?.name || ''} has paid an advance for <strong>${property?.title || 'the property'}</strong>.</p>
              <p>Amount: <strong>₹${Number(amount || offer.advanceAmount || 0).toLocaleString('en-IN')}</strong></p>
              <p>Payment ID: ${paymentId || ''}</p>
            </div>
          `
        });
      }
    } catch (mailErr) {
      console.warn('Failed to send advance payment email:', mailErr?.message || mailErr);
    }

    res.json({ success: true, offer });
  } catch (err) {
    console.error('Error marking advance paid:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
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

    // Notify buyer about status change (accepted/rejected/pending)
    try {
      const [buyer, property] = await Promise.all([
        User.findById(offer.investorId).select('name email'),
        Property.findById(offer.propertyId).select('title')
      ]);
      if (buyer?.email) {
        const humanStatus = normalized.charAt(0).toUpperCase() + normalized.slice(1);
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: buyer.email,
          subject: `Your Purchase Request ${humanStatus}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="margin:0 0 12px 0;">Purchase Request ${humanStatus}</h2>
              <p>Hello ${buyer.name || ''},</p>
              <p>Your purchase request for <strong>${property?.title || 'the property'}</strong> has been <strong>${normalized}</strong>.</p>
              <p>Please check your dashboard for details.</p>
            </div>
          `
        });
      }
    } catch (mailErr) {
      console.warn('Failed to send offer status email:', mailErr?.message || mailErr);
    }
    
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