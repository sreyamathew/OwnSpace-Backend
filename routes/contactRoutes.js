const express = require('express');
const User = require('../models/User');

const router = express.Router();

// @route   POST /api/contact/messages
// @desc    Submit contact message to admin inbox
// @access  Public
router.post('/messages', async (req, res) => {
  try {
    const {
      name = '',
      email = '',
      phone = '',
      userType = '',
      subject = '',
      message = ''
    } = req.body || {};

    const normalizedUserType = String(userType).trim().toLowerCase();

    if (!name.trim() || !email.trim() || !subject.trim() || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, subject and message are required'
      });
    }

    if (!['buyer', 'agent'].includes(normalizedUserType)) {
      return res.status(400).json({
        success: false,
        message: 'Role must be either buyer or agent'
      });
    }

    const messagePayload = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      userType: normalizedUserType,
      subject: subject.trim(),
      message: message.trim(),
      isRead: false,
      createdAt: new Date()
    };

    // Update all admin inboxes (case-insensitive match for safety)
    const updateRes = await User.updateMany(
      { userType: { $regex: /^admin$/i } },
      { $push: { messages: messagePayload } }
    );

    const updatedCount =
      Number(updateRes?.modifiedCount ?? updateRes?.nModified ?? 0) ||
      Number(updateRes?.matchedCount ?? updateRes?.n ?? 0) ||
      0;

    if (updatedCount <= 0) {
      return res.status(404).json({
        success: false,
        message: 'No admin accounts found to receive this message'
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully to admin',
      delivered_to_admins: updatedCount
    });
  } catch (error) {
    console.error('Contact message submission error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
});

module.exports = router;
