const mongoose = require('mongoose');
require('dotenv').config();
const Property = require('./models/Property');

async function checkData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ownspace');
    const property = await Property.findOne({ status: 'active', isActive: true });
    console.log('Sample Active Property:', property ? { title: property.title, city: property.address.city, price: property.price, bedrooms: property.bedrooms } : 'None found');
    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}
checkData();
