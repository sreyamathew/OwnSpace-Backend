const mongoose = require('mongoose');
require('dotenv').config();
const Preference = require('./models/Preference');
const Property = require('./models/Property');

async function testRecommendations() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ownspace');
    console.log('Connected to MongoDB');

    const userId = '67db8755c3c1370e531818bd'; // Mock user ID (should be a real one from DB if possible)
    
    // 1. Create mock preferences
    const preferences = {
      locations: ['Pala'],
      minPrice: 100000,
      maxPrice: 50000000,
      bhk: 4,
      minSize: 500,
      furnishing: 'any'
    };

    await Preference.findOneAndUpdate(
      { userId },
      { userId, preferences },
      { upsert: true, new: true }
    );
    console.log('Preferences saved');

    // 2. Test Recommendation Logic (Simulated)
    const p = preferences;
    const query = {
      isActive: true,
      status: 'active'
    };
    if (p.locations && p.locations.length > 0) {
      query['address.city'] = { $in: p.locations.map(loc => new RegExp(loc, 'i')) };
    }
    if (p.minPrice || p.maxPrice) {
      query.price = {};
      if (p.minPrice) query.price.$gte = p.minPrice;
      if (p.maxPrice) query.price.$lte = p.maxPrice;
    }

    const properties = await Property.find(query).limit(5);
    console.log(`Found ${properties.length} potential recommendations`);

    const scored = properties.map(prop => {
      let score = 0;
      if (p.locations.some(loc => loc.toLowerCase() === prop.address.city.toLowerCase())) score += 0.4;
      if (p.bhk && prop.bedrooms === p.bhk) score += 0.3;
      if (p.maxPrice > 0) {
        const priceDiff = Math.abs(prop.price - p.maxPrice);
        score += (1 - Math.min(priceDiff / p.maxPrice, 1)) * 0.2;
      }
      if (p.minSize && prop.area >= p.minSize) score += 0.1;
      return { title: prop.title, score };
    });

    console.log('Top Scored Results:', scored.sort((a, b) => b.score - a.score));

    await mongoose.disconnect();
  } catch (err) {
    console.error(err);
  }
}

testRecommendations();
