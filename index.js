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
const VisitSlot = require('./models/VisitSlot');

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

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/visits', visitRoutes);

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
  
  // Scheduled cleanup: mark expired, unbooked slots as expired every 3 minutes
  const markExpiredSlots = async () => {
    try {
      const now = new Date();
      // Fetch candidate slots that are not yet expired and not booked
      const candidates = await VisitSlot.find({ isExpired: false, isBooked: false });
      const toExpireIds = [];
      for (const s of candidates) {
        try {
          const endDt = new Date(`${s.date}T${s.endTime}:00`);
          if (endDt.getTime() <= now.getTime()) {
            toExpireIds.push(s._id);
          }
        } catch (e) {
          // ignore parse errors
        }
      }
      if (toExpireIds.length > 0) {
        await VisitSlot.updateMany({ _id: { $in: toExpireIds } }, { $set: { isExpired: true } });
        console.log(`⏱️ Marked ${toExpireIds.length} slots as expired`);
      }
    } catch (err) {
      console.error('Expired slots cleanup error:', err.message);
    }
  };

  // Run immediately and then on interval
  markExpiredSlots();
  setInterval(markExpiredSlots, 3 * 60 * 1000);
});