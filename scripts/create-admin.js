require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

// MongoDB Atlas Connection
const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ownspace';

async function createAdminUser() {
  try {
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ userType: 'admin' });
    if (existingAdmin) {
      console.log('✅ Admin user already exists:', existingAdmin.email);
      console.log('Admin details:', {
        name: existingAdmin.name,
        email: existingAdmin.email,
        userType: existingAdmin.userType,
        isVerified: existingAdmin.isVerified
      });
      process.exit(0);
    }

    // Create admin user
    const adminUser = new User({
      name: 'Admin User',
      email: 'admin@ownspace.com',
      password: 'admin123', // Change this to a secure password
      phone: '9876543210',
      userType: 'admin',
      isVerified: true // Skip OTP verification for admin
    });

    await adminUser.save();
    console.log('✅ Admin user created successfully!');
    console.log('Admin credentials:');
    console.log('Email: admin@ownspace.com');
    console.log('Password: admin123');
    console.log('UserType: admin');

  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📤 Disconnected from MongoDB');
  }
}

async function updateExistingUserToAdmin() {
  try {
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');

    // List all users
    const users = await User.find({}).select('name email userType isVerified');
    console.log('\n📋 Existing users:');
    users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.name} (${user.email}) - Type: ${user.userType}, Verified: ${user.isVerified}`);
    });

    if (users.length === 0) {
      console.log('No users found. Please register a user first.');
      return;
    }

    // For demo purposes, let's update the first user to admin
    const firstUser = users[0];
    console.log(`\n🔄 Updating user ${firstUser.email} to admin...`);
    
    await User.findByIdAndUpdate(firstUser._id, { 
      userType: 'admin',
      isVerified: true 
    });

    console.log('✅ User updated to admin successfully!');
    console.log(`Admin credentials: ${firstUser.email}`);

  } catch (error) {
    console.error('❌ Error updating user:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📤 Disconnected from MongoDB');
  }
}

// Check command line arguments
const action = process.argv[2];

if (action === 'create') {
  createAdminUser();
} else if (action === 'update') {
  updateExistingUserToAdmin();
} else {
  console.log('Usage:');
  console.log('  node create-admin.js create  - Create new admin user');
  console.log('  node create-admin.js update  - Update existing user to admin');
}
