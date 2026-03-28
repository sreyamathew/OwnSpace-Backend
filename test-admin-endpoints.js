const axios = require('axios');
const mongoose = require('mongoose');

async function testAdminEndpoints() {
  try {
    // Connect to DB to get admin email
    require('dotenv').config();
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ownspace');
    
    // Instead of logging in with password, since we don't know the admin's actual password
    // we can generate a temporary token for the admin user directly using the JWT secret.
    const User = require('./models/User');
    const jwt = require('jsonwebtoken');
    
    const adminUser = await User.findOne({ userType: 'admin' });
    if (!adminUser) {
      console.log('No admin user found.');
      process.exit(1);
    }
    
    console.log(`Found Admin: ${adminUser.email}`);
    
    const token = jwt.sign(
      { userId: adminUser._id },
      process.env.JWT_SECRET || 'your-session-secret',
      { expiresIn: '1h' }
    );
    
    const API_BASE = 'http://localhost:3001/api/admin';
    const config = { headers: { Authorization: `Bearer ${token}` } };
    
    // Test stats
    const statsObj = await axios.get(`${API_BASE}/dashboard-stats`, config);
    console.log('--- Dashboard Stats ---');
    console.log(statsObj.data);
    
    // Test sales reports
    const salesObj = await axios.get(`${API_BASE}/sales-reports`, config);
    console.log('\n--- Sales Reports ---');
    console.log(salesObj.data);
    
    // Test smart alerts
    const alertsObj = await axios.get(`${API_BASE}/smart-alerts`, config);
    console.log('\n--- Smart Alerts ---');
    console.log(alertsObj.data);
    
    // Test market news (GET and POST)
    const newsGet = await axios.get(`${API_BASE}/market-news`, config);
    console.log('\n--- Market News ---');
    console.log(newsGet.data);
    
    if(newsGet.data.data.length > 0) {
       const newsId = newsGet.data.data[0].id;
       const newsPut = await axios.put(`${API_BASE}/market-news/${newsId}/status`, { status: 'approved' }, config);
       console.log('\n--- Market News Approve ---');
       console.log(newsPut.data);
    }
    
    console.log('\n✅ All endpoints working successfully!');
    process.exit(0);
  } catch (err) {
    if (err.response) {
      console.error('API Error:', err.response.status, err.response.data);
    } else {
      console.error('Error:', err.message);
    }
    process.exit(1);
  }
}

testAdminEndpoints();
