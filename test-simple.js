const mongoose = require('mongoose');

// Test with the basic cluster URL first
const clusterUrl = 'ownspace.bgljiz0.mongodb.net';
const dbName = 'ownspace';

console.log('Testing basic connectivity to cluster:', clusterUrl);

// Try different connection string formats
const testConnections = [
  // Original format with URL encoding
  'mongodb+srv://sreyaelizabethmathew2026:sreya%402002@ownspace.bgljiz0.mongodb.net/ownspace?retryWrites=true&w=majority',
  
  // Without appName
  'mongodb+srv://sreyaelizabethmathew2026:sreya%402002@ownspace.bgljiz0.mongodb.net/ownspace?retryWrites=true&w=majority',
  
  // With different encoding
  'mongodb+srv://sreyaelizabethmathew2026:sreya%40%32%30%30%32@ownspace.bgljiz0.mongodb.net/ownspace?retryWrites=true&w=majority'
];

async function testConnection(uri, index) {
  console.log(`\n--- Testing connection ${index + 1} ---`);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log('✅ Connection successful!');
    console.log(`Database: ${mongoose.connection.name}`);
    await mongoose.disconnect();
    return true;
  } catch (error) {
    console.log('❌ Connection failed:', error.message);
    return false;
  }
}

async function runTests() {
  for (let i = 0; i < testConnections.length; i++) {
    const success = await testConnection(testConnections[i], i);
    if (success) {
      console.log('\n🎉 Found working connection string!');
      console.log('Use this in your .env file:');
      console.log(`MONGODB_URI=${testConnections[i]}`);
      process.exit(0);
    }
  }
  
  console.log('\n❌ All connection attempts failed.');
  console.log('Please check:');
  console.log('1. Database user exists and has correct permissions');
  console.log('2. Your IP address is whitelisted in Network Access');
  console.log('3. Username and password are correct');
  process.exit(1);
}

runTests();