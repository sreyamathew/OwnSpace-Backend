const mongoose = require('mongoose');
const Property = require('../models/Property');
require('dotenv').config();

const checkSold = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const soldCount = await Property.countDocuments({
            $or: [{ status: 'sold' }, { soldDate: { $exists: true } }]
        });

        console.log(`Current sold properties: ${soldCount}`);

        if (soldCount === 0) {
            console.log('No sold properties found. Marking one property as sold for testing...');
            const property = await Property.findOne({ status: 'active' });
            if (property) {
                property.status = 'sold';
                property.soldDate = new Date();
                property.soldPrice = property.price * 0.95; // 5% below asking
                property.predictedPrice = property.price * 0.98;
                property.riskCategory = 'Low';
                await property.save();
                console.log(`Property "${property.title}" marked as SOLD.`);
            } else {
                console.log('No active properties found to mark as sold.');
            }
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

checkSold();
