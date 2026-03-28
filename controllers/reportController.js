const Property = require('../models/Property');

// @desc    Get sold properties reporting statistics
// @route   GET /api/reports/sold-stats
// @access  Private/Admin
exports.getSoldStats = async (req, res) => {
    try {
        const stats = await Property.aggregate([
            {
                $match: {
                    $or: [
                        { status: 'sold' },
                        { soldDate: { $exists: true } }
                    ]
                }
            },
            {
                $group: {
                    _id: null,
                    totalSold: { $sum: 1 },
                    totalRevenue: { $sum: { $ifNull: ['$soldPrice', '$price'] } },
                    avgSalePrice: { $avg: { $ifNull: ['$soldPrice', '$price'] } },
                    highRiskCount: {
                        $sum: { $cond: [{ $eq: ['$riskCategory', 'High'] }, 1, 0] }
                    }
                }
            }
        ]);

        const result = stats.length > 0 ? stats[0] : {
            totalSold: 0,
            totalRevenue: 0,
            avgSalePrice: 0,
            highRiskCount: 0
        };

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get sales value grouped by location
// @route   GET /api/reports/sales-by-location
// @access  Private/Admin
exports.getSalesByLocation = async (req, res) => {
    try {
        const salesByLocation = await Property.aggregate([
            {
                $match: {
                    $or: [
                        { status: 'sold' },
                        { soldDate: { $exists: true } }
                    ]
                }
            },
            {
                $group: {
                    _id: '$address.city',
                    totalSales: { $sum: { $ifNull: ['$soldPrice', '$price'] } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { totalSales: -1 } }
        ]);

        res.status(200).json({
            success: true,
            data: salesByLocation
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get monthly sales trend
// @route   GET /api/reports/sales-trend
// @access  Private/Admin
exports.getMonthlySalesTrend = async (req, res) => {
    try {
        const trend = await Property.aggregate([
            {
                $match: {
                    $or: [
                        { status: 'sold' },
                        { soldDate: { $exists: true, $ne: null } }
                    ]
                }
            },
            {
                $project: {
                    effectiveDate: { $ifNull: ['$soldDate', '$updatedAt'] },
                    effectivePrice: { $ifNull: ['$soldPrice', '$price'] }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m", date: "$effectiveDate" } },
                    totalSales: { $sum: "$effectivePrice" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id": 1 } }
        ]);

        // Ensure the last 6 months always have data
        const today = new Date();
        const last6Months = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            last6Months.push({
                _id: d.toLocaleString('default', { month: 'short' }),
                sortKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                totalSales: 0,
                count: 0
            });
        }
        
        // Merge with actual data
        trend.forEach(item => {
            const index = last6Months.findIndex(m => m.sortKey === item._id);
            if(index !== -1) {
                last6Months[index].totalSales = item.totalSales;
                last6Months[index].count = item.count;
            }
        });

        // The frontend expects _id to be the display name
        const formattedTrend = last6Months.map(m => ({
            _id: m._id,
            totalSales: m.totalSales,
            count: m.count
        }));

        res.status(200).json({
            success: true,
            data: formattedTrend
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get risk distribution of sold properties
// @route   GET /api/reports/risk-distribution
// @access  Private/Admin
exports.getRiskDistribution = async (req, res) => {
    try {
        const riskData = await Property.aggregate([
            {
                $match: {
                    $or: [
                        { status: 'sold' },
                        { soldDate: { $exists: true } }
                    ]
                }
            },
            {
                $group: {
                    _id: { $ifNull: ['$riskCategory', 'Unknown'] },
                    count: { $sum: 1 }
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: riskData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get sold properties with price comparison
// @route   GET /api/reports/sold-list
// @access  Private/Admin
exports.getSoldList = async (req, res) => {
    try {
        const properties = await Property.find({
            $or: [
                { status: 'sold' },
                { soldDate: { $exists: true } }
            ]
        })
            .select('title address price soldPrice predictedPrice riskCategory soldDate updatedAt')
            .sort({ soldDate: -1, updatedAt: -1 });

        // Map and fallback soldDate to updatedAt if missing
        const formattedProperties = properties.map(p => {
            const data = p.toObject();
            if (!data.soldDate) {
                data.soldDate = data.updatedAt;
            }
            return data;
        });

        res.status(200).json({
            success: true,
            data: formattedProperties
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
