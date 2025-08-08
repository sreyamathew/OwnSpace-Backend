require('dotenv').config();
const mongoose = require('mongoose');

console.log('🔍 MongoDB Atlas Connection Troubleshooter');
console.log('==========================================\n');

// Check environment variables
console.log('1. Environment Variables Check:');
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
    console.log('❌ MONGODB_URI not found in .env file');
    process.exit(1);
}

// Parse the connection string to show components
console.log('✅ MONGODB_URI found');
try {
    const url = new URL(mongoUri.replace('mongodb+srv://', 'https://'));
    console.log(`   Username: ${url.username}`);
    console.log(`   Password: ${url.password ? '***' + url.password.slice(-2) : 'NOT FOUND'}`);
    console.log(`   Host: ${url.hostname}`);
    console.log(`   Database: ${url.pathname.slice(1).split('?')[0]}`);
} catch (error) {
    console.log('❌ Invalid connection string format');
    console.log('   Error:', error.message);
}

console.log('\n2. Connection Test:');
console.log('Attempting to connect to MongoDB Atlas...');

// Test connection with detailed error handling
mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000, // 10 second timeout
    connectTimeoutMS: 10000,
})
.then(() => {
    console.log('✅ Successfully connected to MongoDB Atlas!');
    console.log(`   Database: ${mongoose.connection.name}`);
    console.log(`   Host: ${mongoose.connection.host}`);
    console.log(`   Port: ${mongoose.connection.port}`);
    console.log(`   Ready State: ${mongoose.connection.readyState}`);
    
    // Test a simple operation
    console.log('\n3. Testing Database Operations:');
    return mongoose.connection.db.admin().ping();
})
.then(() => {
    console.log('✅ Database ping successful!');
    
    // List collections
    return mongoose.connection.db.listCollections().toArray();
})
.then((collections) => {
    console.log(`✅ Found ${collections.length} collections in database`);
    collections.forEach(col => console.log(`   - ${col.name}`));
    
    console.log('\n🎉 All tests passed! Your MongoDB Atlas connection is working perfectly.');
    process.exit(0);
})
.catch((error) => {
    console.log('\n❌ Connection failed!');
    console.log('Error Details:');
    console.log(`   Message: ${error.message}`);
    console.log(`   Code: ${error.code}`);
    console.log(`   Name: ${error.name}`);
    
    if (error.code === 8000) {
        console.log('\n🔧 Troubleshooting Steps for Authentication Error:');
        console.log('1. Go to MongoDB Atlas Dashboard (https://cloud.mongodb.com)');
        console.log('2. Navigate to "Database Access" in the left sidebar');
        console.log('3. Check if user exists and has correct permissions');
        console.log('4. Navigate to "Network Access" in the left sidebar');
        console.log('5. Add your current IP address or 0.0.0.0/0 for testing');
        console.log('6. Go to "Clusters" → "Connect" → "Connect your application"');
        console.log('7. Copy the fresh connection string');
    }
    
    if (error.code === 'ENOTFOUND') {
        console.log('\n🔧 Troubleshooting Steps for DNS Error:');
        console.log('1. Check your internet connection');
        console.log('2. Verify the cluster hostname in your connection string');
        console.log('3. Try connecting from a different network');
    }
    
    process.exit(1);
});

// Timeout handler
setTimeout(() => {
    console.log('\n⏰ Connection timeout after 15 seconds');
    console.log('This might indicate network issues or incorrect cluster hostname');
    process.exit(1);
}, 15000);