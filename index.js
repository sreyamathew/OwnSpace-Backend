require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const passport = require('./config/passport');
const authRoutes = require('./routes/authRoutes');
const agentRoutes = require('./routes/agentRoutes');
const propertyRoutes = require('./routes/propertyRoutes');
const visitRoutes = require('./routes/visitRoutes');
const offerRoutes = require('./routes/offerRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const { initSocket } = require('./utils/socket');
const Razorpay = require('razorpay');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3001'], // Frontend URLs
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session configuration for passport
app.use(session({
  secret: process.env.JWT_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// MongoDB Atlas Connection
const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ownspace';
mongoose.connect(mongoURI)
  .then(() => {
    console.log('✅ Connected to MongoDB Atlas');
    console.log(`🌐 Database: ${mongoose.connection.name}`);
  })
  .catch(err => {
    console.error('❌ Error connecting to MongoDB:', err);
    process.exit(1);
  });

// Automatic cleanup for expired visit slots
const VisitSlot = require('./models/VisitSlot');

// Function to clean up expired slots
const cleanupExpiredSlots = async () => {
  try {
    // Skip if DB not connected
    if (mongoose.connection.readyState !== 1) {
      console.warn('🛑 Skipping cleanup: MongoDB not connected');
      return;
    }
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = `${String(currentHour).padStart(2,'0')}:${String(currentMinute).padStart(2,'0')}`;
    
    // Find and remove expired slots (past dates or today with time in the past)
    const result = await VisitSlot.deleteMany({
      $or: [
        { date: { $lt: currentDate } }, // Past dates
        { date: currentDate, startTime: { $lt: currentTime } } // Today but past time
      ]
    });
    
    console.log(`🧹 Cleaned up ${result.deletedCount} expired visit slots`);
  } catch (error) {
    console.error('Error cleaning up expired slots:', error);
  }
};

// Run cleanup on startup
cleanupExpiredSlots();

// Schedule cleanup to run every 10 minutes
setInterval(cleanupExpiredSlots, 10 * 60 * 1000);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/notifications', notificationRoutes);

// Payment: Razorpay order creation (test)
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_RQvwxfrTu00hqp',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'lc1B2qkCH3v7eVjStPcs9rTY',
});

app.post('/api/payments/order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt } = req.body || {};
    const parsedAmountInRupees = Number(amount);
    if (!Number.isFinite(parsedAmountInRupees)) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // Limits (configurable). Razorpay minimum is 100 paise (₹1.00)
    const minAmountInPaise = 100;
    const maxAmountInRupees = Number(process.env.RAZORPAY_MAX_AMOUNT_INR || 100000); // default ₹1,00,000
    const maxAmountInPaise = Math.round(maxAmountInRupees * 100);

    const minorAmount = Math.round(parsedAmountInRupees * 100);
    if (minorAmount < minAmountInPaise) {
      return res.status(400).json({ success: false, message: 'Amount below minimum allowed (₹1.00)' });
    }
    if (minorAmount > maxAmountInPaise) {
      return res.status(400).json({ success: false, message: 'Amount exceeds maximum allowed' });
    }

    const order = await razorpay.orders.create({ amount: minorAmount, currency, receipt: receipt || `rcpt_${Date.now()}` });
    res.json({ success: true, order });
  } catch (e) {
    console.error('Failed to create Razorpay order', e?.error || e);
    res.status(500).json({ 
      success: false, 
      message: e?.error?.description || e?.message || 'Failed to create payment order' 
    });
  }
});

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'OwnSpace API is running!',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

initSocket(server);

server.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
  console.log(`📱 API Health Check: http://localhost:${port}/api/health`);
});