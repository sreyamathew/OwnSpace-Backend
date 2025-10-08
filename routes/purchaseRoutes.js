const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const Property = require('../models/Property');
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

    const status = (offer.status || '').toLowerCase();
    if (status !== 'accepted' && status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Purchase request must be accepted before advance payment' });
    }
    if (offer.advancePaid) {
      return res.status(400).json({ success: false, message: 'Advance already paid' });
    }

    offer.advancePaid = true;
    offer.advanceAmount = 50000;
    offer.advancePaidAt = new Date();
    offer.status = 'advance_paid';
    await offer.save();

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


