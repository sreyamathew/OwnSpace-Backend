const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const User = require('../models/User');
const Property = require('../models/Property');
const { protect } = require('../middleware/auth');
const transporter = require('../utils/mailer');
const { createNotification, notifyAdmins } = require('../utils/notificationService');

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
    try {
      const [agentUser, investorUser, property] = await Promise.all([
        User.findById(resolvedAgentId).select('name email'),
        User.findById(resolvedInvestorId).select('name email'),
        Property.findById(propertyId).select('title address price')
      ]);

      const buyerName = investorUser?.name || 'A buyer';
      const propTitle = property?.title || 'a property';
      await createNotification({
        userId: resolvedAgentId,
        type: 'purchase',
        title: 'New Purchase Request',
        message: `${buyerName} submitted a purchase request for ${propTitle}.`,
        metadata: { offerId: savedOffer._id, propertyId }
      });
      await notifyAdmins(
        'purchase',
        'New Purchase Request',
        `${buyerName} submitted a purchase request for ${propTitle}.`,
        { offerId: savedOffer._id, propertyId }
      );

      if (agentUser?.email) {
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
    } catch (notifyErr) {
      console.warn('Failed to deliver purchase request notifications:', notifyErr?.message || notifyErr);
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
      .populate('propertyId', 'title address price images status propertyType')
      .populate('investorId', 'name email phone address')
      .populate('agentId', 'name email phone')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: offers.length, offers });
  } catch (err) {
    console.error('Error fetching my offers:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Get advance-paid offers (Admin only)
router.get('/advance-paid', protect, async (req, res) => {
  try {
    const requester = req.userProfile;
    if (!requester || requester.userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const offers = await Offer.find({ advancePaid: true })
      .populate({
        path: 'propertyId',
        select: 'title address price status propertyType images agent createdBy isActive updatedAt',
        populate: [
          { path: 'agent', select: 'name email phone agentProfile' },
          { path: 'createdBy', select: 'name email' }
        ]
      })
      .populate({
        path: 'investorId',
        select: 'name email phone address'
      })
      .sort({ updatedAt: -1 });

    res.status(200).json({ success: true, data: { offers } });
  } catch (err) {
    console.error('Error fetching advance-paid offers:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
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

    // Find the offer by ID
    const offer = await Offer.findById(offerId);
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }

    // Ensure requester is the investor
    if (String(offer.investorId) !== String(req.userProfile._id)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    // Check if advance is already paid
    if (offer.advancePaid) {
      return res.json({ success: true, message: 'Advance already paid.' });
    }

    // Allow payment only if status === "accepted"
    if (offer.status !== 'accepted') {
      return res.status(400).json({ 
        success: false, 
        message: 'Purchase request must be accepted before advance payment' 
      });
    }

    // Set advance payment details
    offer.advancePaid = true;
    offer.advanceAmount = Number(amount || 0);
    offer.advancePaidAt = new Date();
    offer.paymentDetails = {
      amount: Number(amount || 0),
      orderId,
      paymentId,
      signature,
      method,
      date: new Date()
    };

    // Save the offer
    await offer.save();

    try {
      const [agentUser, investorUser, property] = await Promise.all([
        User.findById(offer.agentId).select('name email'),
        User.findById(offer.investorId).select('name email'),
        Property.findById(offer.propertyId).select('title')
      ]);
      
      await createNotification({
        userId: offer.agentId,
        type: 'payment',
        title: 'Advance Payment Received',
        message: `${investorUser?.name || 'Buyer'} paid advance for ${property?.title || 'the property'}.`,
        metadata: { offerId: offer._id, amount }
      });
      await notifyAdmins(
        'payment',
        'Advance Payment Received',
        `${investorUser?.name || 'Buyer'} paid advance for ${property?.title || 'the property'}.`,
        { offerId: offer._id, amount }
      );
      
      if (agentUser?.email) {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: agentUser.email,
          subject: 'Advance Payment Received',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="margin:0 0 12px 0;">Advance Payment Received</h2>
              <p>The buyer ${investorUser?.name || ''} has paid an advance for <strong>${property?.title || 'the property'}</strong>.</p>
              <p>Amount: <strong>₹${Number(amount || 0).toLocaleString('en-IN')}</strong></p>
              <p>Payment ID: ${paymentId || ''}</p>
              <p>Order ID: ${orderId || ''}</p>
            </div>
          `
        });
      }
    } catch (notifyErr) {
      console.warn('Failed to send advance payment notifications:', notifyErr?.message || notifyErr);
    }

    res.json({ success: true, message: 'Advance payment successful.' });
  } catch (err) {
    console.error('Error marking advance paid:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// Mark advance-paid property as sold (Admin only)
router.post('/:offerId/sell', protect, async (req, res) => {
  try {
    const { offerId } = req.params;
    const requester = req.userProfile;
    if (!requester || requester.userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const offer = await Offer.findById(offerId).populate('propertyId').populate('investorId', 'name email');
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }
    if (!offer.advancePaid) {
      return res.status(400).json({ success: false, message: 'Advance payment is required before finalizing sale' });
    }

    const property = await Property.findById(offer.propertyId?._id || offer.propertyId);
    if (!property) {
      return res.status(404).json({ success: false, message: 'Associated property not found' });
    }

    property.status = 'sold';
    // Keep property active in database, just change status to 'sold'
    await property.save();

    offer.status = 'advance_paid';
    offer.updatedAt = new Date();
    await offer.save();

    try {
      await createNotification({
        userId: offer.investorId?._id,
        type: 'purchase',
        title: 'Property Marked as Sold',
        message: `Your property purchase (${property.title}) has been finalized as sold.`,
        metadata: { offerId: offer._id, propertyId: property._id }
      });

      if (offer.investorId?.email) {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: offer.investorId.email,
          subject: 'Property Sale Finalized',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2 style="margin:0 0 12px 0;">Congratulations!</h2>
              <p>Your property purchase for <strong>${property.title}</strong> has been marked as sold.</p>
              <p>Our team will contact you soon with the next steps.</p>
            </div>
          `
        });
      }
    } catch (notifyErr) {
      console.warn('Failed to send sold property notification:', notifyErr?.message || notifyErr);
    }

    res.status(200).json({ success: true, message: 'Property marked as sold successfully', data: { offer, property } });
  } catch (err) {
    console.error('Error marking property as sold:', err);
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

    try {
      const [buyer, property] = await Promise.all([
        User.findById(offer.investorId).select('name email'),
        Property.findById(offer.propertyId).select('title')
      ]);
      const humanStatus = normalized.charAt(0).toUpperCase() + normalized.slice(1);
      await createNotification({
        userId: offer.investorId,
        type: 'purchase',
        title: `Purchase Request ${humanStatus}`,
        message: `Your purchase request for ${property?.title || 'the property'} was ${normalized}.`,
        metadata: { offerId: offer._id, status: normalized }
      });
      await notifyAdmins(
        'purchase',
        'Purchase Request Updated',
        `${req.userProfile?.name || 'Admin/Agent'} marked a purchase request as ${normalized} for ${property?.title || 'the property'}.`,
        { offerId: offer._id, status: normalized }
      );
      if (buyer?.email) {
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
    } catch (notifyErr) {
      console.warn('Failed to send offer status notifications:', notifyErr?.message || notifyErr);
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