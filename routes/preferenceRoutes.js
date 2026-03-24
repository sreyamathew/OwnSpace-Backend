const express = require('express');
const router = express.Router();
const Preference = require('../models/Preference');
const { protect } = require('../middleware/auth');

// @route   POST /api/preferences/save
// @desc    Save or update user preferences
// @access  Private
router.post('/save', protect, async (req, res) => {
  try {
    const userId = req.user.userId; // Use userId from the token payload (based on auth middleware)
    const preferences = req.body;

    let pref = await Preference.findOne({ userId });

    if (pref) {
      pref.preferences = preferences;
      await pref.save();
    } else {
      pref = new Preference({ userId, preferences });
      await pref.save();
    }

    res.json({ 
      success: true,
      message: "Preferences saved successfully",
      data: pref
    });

  } catch (err) {
    console.error('Error saving preferences:', err);
    res.status(500).json({ 
      success: false,
      error: "Failed to save preferences",
      message: err.message
    });
  }
});

// @route   GET /api/preferences/me
// @desc    Get current user's preferences
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const pref = await Preference.findOne({ userId: req.user.userId });
    if (!pref) {
      return res.json({
        success: true,
        data: null,
        message: "No preferences found"
      });
    }
    res.json({
      success: true,
      data: pref
    });
  } catch (err) {
    console.error('Error fetching preferences:', err);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch preferences",
      message: err.message
    });
  }
});

module.exports = router;
