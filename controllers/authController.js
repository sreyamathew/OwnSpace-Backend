const User = require('../models/User');
const jwt = require('jsonwebtoken');
const transporter = require('../utils/mailer');
const crypto = require('crypto');

// JWT Secret (In production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRE });
};

// @desc    Register new user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
  try {
    const { name, email, password, phone, userType } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password'
      });
    }

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Create new user
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
    const user = new User({
      name,
      email,
      password,
      phone,
      userType: userType || 'buyer',
      otp,
      otpExpiry
    });

    await user.save();

    // Send OTP email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Your OTP Code',
      text: `Your OTP code is: ${otp}`,
      html: `<b>Your OTP code is: ${otp}</b>`
    });

    // Generate token
    const token = generateToken(user._id);

    // Get user profile without password
    const userProfile = user.getPublicProfile();

    res.status(201).json({
      success: true,
      message: 'User registered successfully. OTP sent to email.',
      data: {
        user: userProfile,
        // Do not send token until verified
      }
    });

  } catch (error) {
    console.error('Register error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: messages
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Find user by email
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Ensure agentProfile has the new fields for agents
    if (user.userType === 'agent' && user.agentProfile) {
      if (user.agentProfile.tempPassword === undefined) {
        user.agentProfile.tempPassword = false;
      }
      if (user.agentProfile.passwordChanged === undefined) {
        user.agentProfile.passwordChanged = false;
      }
      await user.save();
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Enforce agent status: only active (verified) agents can log in
    if (user.userType === 'agent') {
      const isActiveAgent = user?.agentProfile?.isVerified === true;
      if (!isActiveAgent) {
        return res.status(403).json({
          success: false,
          message: 'Your account is inactive, please contact admin'
        });
      }
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    // Get user profile without password
    const userProfile = user.getPublicProfile();

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: userProfile,
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/profile
// @access  Private
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        user
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
const updateProfile = async (req, res) => {
  try {
    const { name, phone, userType, address, preferences } = req.body;
    
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update fields
    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (userType) user.userType = userType;
    if (address) user.address = { ...user.address, ...address };
    if (preferences) user.preferences = { ...user.preferences, ...preferences };

    await user.save();

    const userProfile = user.getPublicProfile();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: userProfile
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during profile update'
    });
  }
};

// @desc    Register new agent (Admin only)
// @route   POST /api/auth/register-agent
// @access  Private (Admin)
const registerAgent = async (req, res) => {
  try {
    const { 
      name, 
      email, 
      phone, 
      licenseNumber, 
      agency, 
      experience, 
      specialization,
      address,
      city,
      state,
      zipCode,
      bio
    } = req.body;

    // Validation
    if (!name || !email || !licenseNumber || !agency) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, license number, and agency'
      });
    }

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Generate temporary password with special characters
    const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    
    // Ensure at least one character from each category
    let tempPassword = '';
    tempPassword += letters[Math.floor(Math.random() * letters.length)];
    tempPassword += numbers[Math.floor(Math.random() * numbers.length)];
    tempPassword += specialChars[Math.floor(Math.random() * specialChars.length)];
    
    // Fill remaining 9 characters with random mix
    const allChars = letters + numbers + specialChars;
    for (let i = 0; i < 9; i++) {
      tempPassword += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // Shuffle the password to randomize position of required characters
    tempPassword = tempPassword.split('').sort(() => Math.random() - 0.5).join('');
    
    // Create new agent
    const agent = new User({
      name,
      email,
      password: tempPassword,
      phone,
      userType: 'agent', // Set userType to agent
      address: {
        street: address,
        city,
        state,
        zipCode
      },
      // Add agent-specific fields (you might want to extend the User model for these)
      agentProfile: {
        licenseNumber,
        agency,
        experience,
        specialization,
        bio,
        isVerified: true, // Set agents as active by default
        tempPassword: true, // Flag to indicate temporary password
        passwordChanged: false // Track if password has been changed
      }
    });

    await agent.save();

    // Send credentials email
    try {
      const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`;
      
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: agent.email,
        subject: 'Welcome to OwnSpace - Your Agent Account Credentials',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f8fafc;">
            <div style="background-color: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
              <!-- Header -->
              <div style="text-align: center; margin-bottom: 30px;">
                <div style="background-color: #3B82F6; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                  <h1 style="margin: 0; font-size: 24px;">Welcome to OwnSpace!</h1>
                  <p style="margin: 10px 0 0 0; opacity: 0.9;">Your agent account has been created</p>
                </div>
              </div>

              <!-- Content -->
              <div style="margin-bottom: 30px;">
                <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                  Hello <strong>${agent.name}</strong>,
                </p>
                
                <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                  Your agent account has been successfully created by the admin. You can now access your agent dashboard using the credentials below:
                </p>

                <!-- Credentials Box -->
                <div style="background-color: #f3f4f6; border: 2px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                  <h3 style="color: #1f2937; margin: 0 0 15px 0; font-size: 18px;">Your Login Credentials</h3>
                  <div style="margin-bottom: 10px;">
                    <strong style="color: #374151;">Email:</strong> 
                    <span style="color: #6b7280; font-family: monospace; background-color: #e5e7eb; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">${agent.email}</span>
                  </div>
                  <div>
                    <strong style="color: #374151;">Temporary Password:</strong> 
                    <span style="color: #6b7280; font-family: monospace; background-color: #e5e7eb; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">${tempPassword}</span>
                  </div>
                </div>

                <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 15px; margin: 20px 0;">
                  <p style="color: #92400e; margin: 0; font-size: 14px;">
                    <strong>Important:</strong> This is a temporary password. You will be required to change it on your first login for security reasons.
                  </p>
                </div>

                <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                  Click the button below to access your agent dashboard:
                </p>

                <!-- Login Button -->
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${loginUrl}" style="background-color: #3B82F6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
                    Access Agent Dashboard
                  </a>
                </div>

                <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
                  If the button doesn't work, copy and paste this link into your browser:<br>
                  <span style="word-break: break-all; color: #3B82F6;">${loginUrl}</span>
                </p>
              </div>

              <!-- Footer -->
              <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
                <p style="color: #6b7280; font-size: 12px; margin: 0; text-align: center;">
                  This is an automated email from OwnSpace. Please do not reply to this email.<br>
                  If you have any questions, please contact your admin or support team.
                </p>
              </div>
            </div>
          </div>
        `
      });

      console.log('Agent credentials email sent successfully to:', agent.email);

    } catch (emailError) {
      console.error('Email sending error:', emailError);
      // Don't fail the registration if email fails, but log it
    }

    // Get agent profile without password
    const agentProfile = agent.getPublicProfile();

    res.status(201).json({
      success: true,
      message: 'Agent registered successfully. Login credentials have been sent to their email.',
      data: {
        agent: agentProfile,
        credentialsSent: true
      }
    });

  } catch (error) {
    console.error('Agent registration error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: messages
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error during agent registration'
    });
  }
};

// @desc    Logout user (client-side token removal)
// @route   POST /api/auth/logout
// @access  Private
const logout = async (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Logout successful'
  });
};

// @desc    Verify OTP for user registration
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Validation
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and OTP'
      });
    }

    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'User already verified'
      });
    }

    if (user.otp !== otp || user.otpExpiry < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Mark user as verified
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    // Generate token after verification
    const token = generateToken(user._id);

    // Get user profile without password
    const userProfile = user.getPublicProfile();

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        user: userProfile,
        token
      }
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during OTP verification'
    });
  }
};

// @desc    Send password reset email
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Validation
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email address'
      });
    }

    // Find user by email
    const user = await User.findByEmail(email);
    if (!user) {
      // Don't reveal if user exists or not for security
      return res.status(200).json({
        success: true,
        message: 'If an account with that email exists, we have sent a password reset link.'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Save reset token to user
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiry = resetTokenExpiry;
    await user.save();

    // Create reset URL
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;

    // Send reset email
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Password Reset Request - OwnSpace',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>Hello ${user.name},</p>
            <p>You have requested to reset your password for your OwnSpace account.</p>
            <p>Please click the button below to reset your password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background-color: #3B82F6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Reset Password</a>
            </div>
            <p>Or copy and paste this link in your browser:</p>
            <p style="word-break: break-all; color: #666;">${resetUrl}</p>
            <p><strong>This link will expire in 10 minutes.</strong></p>
            <p>If you didn't request this password reset, please ignore this email.</p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 12px;">This is an automated email from OwnSpace. Please do not reply to this email.</p>
          </div>
        `
      });

      res.status(200).json({
        success: true,
        message: 'Password reset link has been sent to your email address.'
      });

    } catch (emailError) {
      console.error('Email sending error:', emailError);
      
      // Clear reset token if email fails
      user.resetPasswordToken = undefined;
      user.resetPasswordExpiry = undefined;
      await user.save();

      return res.status(500).json({
        success: false,
        message: 'Failed to send reset email. Please try again later.'
      });
    }

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset request'
    });
  }
};

// @desc    Reset password with token
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    // Validation
    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide reset token and new password'
      });
    }

    // Find user by reset token
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Update password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;
    await user.save();

    // Send confirmation email
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Password Reset Successful - OwnSpace',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Password Reset Successful</h2>
            <p>Hello ${user.name},</p>
            <p>Your password has been successfully reset for your OwnSpace account.</p>
            <p>If you didn't make this change, please contact our support team immediately.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" style="background-color: #3B82F6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Login to Your Account</a>
            </div>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #666; font-size: 12px;">This is an automated email from OwnSpace. Please do not reply to this email.</p>
          </div>
        `
      });
    } catch (emailError) {
      console.error('Confirmation email error:', emailError);
      // Don't fail the request if confirmation email fails
    }

    res.status(200).json({
      success: true,
      message: 'Password has been reset successfully'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset'
    });
  }
};

// @desc    Change password (for agents with temporary passwords)
// @route   POST /api/auth/change-password
// @access  Private
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current password and new password'
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    
    // If this was a temporary password, mark it as changed
    if (user.agentProfile && user.agentProfile.tempPassword) {
      user.agentProfile.tempPassword = false;
      user.agentProfile.passwordChanged = true;
    }
    
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password change'
    });
  }
};

// @desc    Google OAuth callback
// @route   GET /api/auth/google/callback
// @access  Public
const googleCallback = async (req, res) => {
  try {
    // User is authenticated via passport
    const user = req.user;
    
    if (!user) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=auth_failed`);
    }

    // Generate JWT token
    const token = generateToken(user._id);
    
    // Redirect to frontend with token
    const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/callback?token=${token}&user=${encodeURIComponent(JSON.stringify(user.getPublicProfile()))}`;
    
    res.redirect(redirectUrl);
    
  } catch (error) {
    console.error('Google callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=server_error`);
  }
};

// @desc    Google OAuth failure
// @route   GET /api/auth/google/failure
// @access  Public
const googleFailure = (req, res) => {
  res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=google_auth_failed`);
};

module.exports = {
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
};
