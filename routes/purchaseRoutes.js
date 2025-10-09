const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const Property = require('../models/Property');
const User = require('../models/User');
const transporter = require('../utils/mailer');
const { protect } = require('../middleware/auth');

// POST /api/purchase/advance-payment
router.post('/advance-payment', protect, async (req, res) => {
  try {
    const { userId, propertyId, amount } = req.body || {};
    const requesterId = req.userProfile?._id;

    if (!propertyId) {
      return res.status(400).json({ success: false, message: 'propertyId is required' });
    }
    if (Number(amount) !== 50000) {
      return res.status(400).json({ success: false, message: 'Amount must be ₹50,000 fixed' });
    }

    // Find accepted offer for this user and property
    const offer = await Offer.findOne({ propertyId, investorId: requesterId });
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Purchase request not found' });
    }

    console.log('Offer status:', offer.status);
    const normalizedStatus = (offer.status || '').trim().toLowerCase();
    if (!['accepted', 'approved'].includes(normalizedStatus)) {
      return res.status(400).json({ success: false, message: 'Purchase request must be accepted before advance payment' });
    }
    if (offer.advancePaid) {
      return res.status(400).json({ success: false, message: 'Advance already paid' });
    }

    offer.advancePaid = true;
    offer.advanceAmount = 50000;
    offer.advancePaidAt = new Date();
    // Keep the offer in accepted state so it continues to appear under the 'Accepted' filter
    await offer.save();

    // Notify agent/admin that advance was paid (best-effort)
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
              <p>Amount: <strong>₹${Number(offer.advanceAmount || 50000).toLocaleString('en-IN')}</strong></p>
            </div>
          `
        });
      }
    } catch (mailErr) {
      console.warn('Failed to send advance payment email (purchase route):', mailErr?.message || mailErr);
    }

    res.json({
      success: true,
      message: 'Advance payment recorded successfully',
      offer
    });
  } catch (err) {
    console.error('Error processing advance payment:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

module.exports = router;


