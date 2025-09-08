const express = require('express');
const router = express.Router();
const passport = require('../config/passport');
const User = require('../models/User');
const {
  register,
  login,
  getProfile,
  updateProfile,
  registerAgent,
  logout,
  verifyOtp,
  forgotPassword,
  resetPassword,
  changePassword,
  googleCallback,
  googleFailure
} = require('../controllers/authController');
const { protect, authorize } = require('../middleware/auth');

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', register);

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', login);

// @route   GET /api/auth/profile
// @desc    Get current user profile
// @access  Private
router.get('/profile', protect, getProfile);

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', protect, updateProfile);

// @route   POST /api/auth/register-agent
// @desc    Register a new agent (Admin only)
// @access  Private (Admin only)
router.post('/register-agent', protect, authorize('admin'), registerAgent);

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', protect, logout);

// @route   POST /api/auth/verify-otp
// @desc    Verify OTP for user registration
// @access  Public
router.post('/verify-otp', verifyOtp);

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email
// @access  Public
router.post('/forgot-password', forgotPassword);

// @route   POST /api/auth/reset-password
// @desc    Reset password with token
// @access  Public
router.post('/reset-password', resetPassword);

// @route   POST /api/auth/change-password
// @desc    Change password (for agents with temporary passwords)
// @access  Private
router.post('/change-password', protect, changePassword);

// @route   GET /api/auth/google
// @desc    Google OAuth authentication
// @access  Public
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// @route   GET /api/auth/google/callback
// @desc    Google OAuth callback
// @access  Public
router.get('/google/callback', 
  passport.authenticate('google', { 
    failureRedirect: '/api/auth/google/failure',
    session: false 
  }),
  googleCallback
);

// @route   GET /api/auth/google/failure
// @desc    Google OAuth failure
// @access  Public
router.get('/google/failure', googleFailure);

// @route   POST /api/auth/make-admin
// @desc    Make current user admin (for testing purposes)
// @access  Private
router.post('/make-admin', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.userType = 'admin';
    user.isVerified = true;
    await user.save();

    const userProfile = user.getPublicProfile();

    res.status(200).json({
      success: true,
      message: 'User updated to admin successfully',
      data: {
        user: userProfile
      }
    });
  } catch (error) {
    console.error('Make admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
