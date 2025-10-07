require('dotenv').config();
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

const app = express();
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

app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
  console.log(`📱 API Health Check: http://localhost:${port}/api/health`);
});