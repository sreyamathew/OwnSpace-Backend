const Property = require('../models/Property');
const axios = require('axios');

// Helper to get ML analysis
const getMLAnalysis = async (properties) => {
    try {
        const ML_SERVICE_URL = process.env.ML_PRICE_API || process.env.ML_SERVICE_URL || 'http://127.0.0.1:5001';
        console.log(`Analyzing ${properties.length} properties via ML at ${ML_SERVICE_URL}`);

        const analysisPromises = properties.map(async (prop) => {
            try {
                const response = await axios.post(`${ML_SERVICE_URL}/predict-price`, {
                    location: prop.address.city,
                    size: prop.area,
                    bhk: prop.bedrooms,
                    bath: prop.bathrooms,
                    amenitiesScore: prop.features ? prop.features.length : 5, // Simple proxy
                    propertyAge: 5 // Default for now
                });

                const predictedPrice = response.data.predicted_price;
                const actualPrice = prop.price;

                // Risk analysis logic:
                // High risk if actual price is > 30% higher than predicted
                // Medium risk if actual price is 15-30% higher
                let riskCategory = 'LOW';
                if (actualPrice > predictedPrice * 1.3) riskCategory = 'HIGH';
                else if (actualPrice > predictedPrice * 1.15) riskCategory = 'MEDIUM';

                return {
                    propertyId: prop._id,
                    predictedPrice,
                    riskCategory
                };
            } catch (err) {
                return { propertyId: prop._id, predictedPrice: null, riskCategory: 'UNKNOWN' };
            }
        });

        return await Promise.all(analysisPromises);
    } catch (error) {
        console.error('ML Service Error:', error.message);
        return [];
    }
};

exports.getDashboardStats = async (req, res) => {
    try {
        const totalProperties = await Property.countDocuments();
        const activeListings = await Property.countDocuments({ status: 'active' });

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const newPropertiesLast7Days = await Property.countDocuments({ createdAt: { $gte: sevenDaysAgo } });

        // Get average prices and risk from ML for active properties (limit to recent for performance)
        const activeProps = await Property.find({ status: 'active' }).limit(10);
        const mlData = await getMLAnalysis(activeProps);

        const validPredictions = mlData.filter(d => d.predictedPrice !== null);
        const avgPredictedPrice = validPredictions.length > 0
            ? validPredictions.reduce((acc, curr) => acc + curr.predictedPrice, 0) / validPredictions.length
            : 0;

        const highRiskCount = mlData.filter(d => d.riskCategory === 'HIGH').length;

        res.status(200).json({
            success: true,
            data: {
                totalProperties,
                activeListings,
                newPropertiesLast7Days,
                avgPredictedPrice,
                highRiskCount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getLocationDistribution = async (req, res) => {
    try {
        const distribution = await Property.aggregate([
            {
                $group: {
                    _id: '$address.city',
                    count: { $sum: 1 },
                    avgPrice: { $avg: '$price' }
                }
            },
            { $sort: { count: -1 } }
        ]);

        res.status(200).json({ success: true, data: distribution });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getMonthlyTrends = async (req, res) => {
    try {
        const trends = await Property.aggregate([
            {
                $group: {
                    _id: {
                        month: { $month: '$createdAt' },
                        year: { $year: '$createdAt' }
                    },
                    count: { $sum: 1 },
                    avgPrice: { $avg: '$price' }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        res.status(200).json({ success: true, data: trends });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getRiskDistribution = async (req, res) => {
    try {
        const properties = await Property.find({ status: 'active' }).limit(20);
        const mlData = await getMLAnalysis(properties);

        const distribution = {
            LOW: mlData.filter(d => d.riskCategory === 'LOW').length,
            MEDIUM: mlData.filter(d => d.riskCategory === 'MEDIUM').length,
            HIGH: mlData.filter(d => d.riskCategory === 'HIGH').length,
            UNKNOWN: mlData.filter(d => d.riskCategory === 'UNKNOWN').length
        };

        res.status(200).json({ success: true, data: distribution });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAIInsights = async (req, res) => {
    try {
        const properties = await Property.find({ status: 'active' }).limit(20);
        const mlData = await getMLAnalysis(properties);

        const insights = [];
        const highRisk = mlData.filter(d => d.riskCategory === 'HIGH').length;
        if (highRisk > 0) {
            insights.push(`${highRisk} properties flagged as high risk based on price deviation.`);
        }

        // Location trend insight
        const cityStats = await Property.aggregate([
            { $group: { _id: '$address.city', avgPrice: { $avg: '$price' } } },
            { $sort: { avgPrice: -1 } },
            { $limit: 1 }
        ]);

        if (cityStats.length > 0) {
            insights.push(`Market prices are currently highest in ${cityStats[0]._id}.`);
        }

        const newThisWeek = await Property.countDocuments({
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        });
        if (newThisWeek > 0) {
            insights.push(`${newThisWeek} new listings added this week.`);
        }

        res.status(200).json({ success: true, data: insights });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
