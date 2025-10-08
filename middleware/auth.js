const jwt = require('jsonwebtoken');
const User = require('../models/User');

// JWT Secret (In production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';

// Middleware to protect routes
const protect = async (req, res, next) => {
  try {
    console.log('=== AUTHENTICATION DEBUG ===');
    console.log('Headers:', req.headers.authorization ? 'Authorization header present' : 'No authorization header');
    
    let token;

    // Check for token in headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
      console.log('Token extracted:', token ? 'Token present' : 'No token');
    }

    // Check if token exists
    if (!token) {
      console.log('❌ Authentication failed: No token provided');
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, JWT_SECRET);
      console.log('Token decoded successfully:', decoded);
      
      // Get user from token
      const user = await User.findById(decoded.userId).select('-password');
      console.log('User found:', user ? `User ID: ${user._id}, Type: ${user.userType}` : 'User not found');

      if (!user) {
        console.log('❌ Authentication failed: User not found');
        return res.status(401).json({
          success: false,
          message: 'Token is valid but user not found'
        });
      }

      // Add user to request object
      req.user = decoded;
      req.userProfile = user;
      console.log('✅ Authentication successful');
      next();

    } catch (jwtError) {
      const isExpired = jwtError?.name === 'TokenExpiredError' || /jwt expired/i.test(jwtError?.message || '');
      console.log('❌ Authentication failed:', isExpired ? 'Token expired' : `Invalid token (${jwtError?.message})`);
      return res.status(401).json({
        success: false,
        message: isExpired ? 'Token expired' : 'Invalid token'
      });
    }

  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error in authentication'
    });
  }
};

// Middleware to check user roles
const authorize = (...roles) => {
  return (req, res, next) => {
    console.log('=== AUTHORIZATION DEBUG ===');
    console.log('Required roles:', roles);
    console.log('User profile exists:', !!req.userProfile);
    console.log('User profile:', req.userProfile);
    console.log('User type:', req.userProfile?.userType);
    
    if (!req.userProfile) {
      console.log('❌ Authorization failed: User not authenticated');
      return res.status(401).json({
        success: false,
        message: 'Access denied. User not authenticated.'
      });
    }

    if (!roles.includes(req.userProfile.userType)) {
      console.log('❌ Authorization failed: Role mismatch');
      console.log('User has role:', req.userProfile.userType);
      console.log('Required roles:', roles);
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}`
      });
    }

    console.log('✅ Authorization successful');
    next();
  };
};

// Optional auth middleware (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        
        if (user) {
          req.user = decoded;
          req.userProfile = user;
        }
      } catch (jwtError) {
        // Token is invalid, but we don't fail the request
        console.log('Invalid token in optional auth:', jwtError.message);
      }
    }

    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    next(); // Continue even if there's an error
  }
};

module.exports = {
  protect,
  authorize,
  optionalAuth
};
