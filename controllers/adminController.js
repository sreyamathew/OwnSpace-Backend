const Property = require('../models/Property');
const User = require('../models/User');
const MarketNews = require('../models/MarketNews');

exports.getDashboardStats = async (req, res) => {
    try {
        const totalProperties = await Property.countDocuments();
        const totalUsers = await User.countDocuments();
        
        // Mock system logs and platform performance as they don't have dedicated models currently
        const totalLogs = Math.floor(Math.random() * 5000) + 10000;
        const platformPerformance = 98.5;

        res.status(200).json({
            success: true,
            data: {
                totalProperties,
                totalUsers,
                totalLogs,
                platformPerformance
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getSalesReports = async (req, res) => {
    try {
        // Properties Sold & Revenue
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
                    propertiesSold: { $sum: 1 },
                    totalRevenue: { $sum: { $ifNull: ['$soldPrice', '$price'] } }
                }
            }
        ]);

        const result = stats.length > 0 ? stats[0] : { propertiesSold: 0, totalRevenue: 0 };
        
        // Monthly Sales Trend
        const monthlyData = await Property.aggregate([
            {
                $match: {
                    status: 'sold'
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
                    properties: { $sum: 1 },
                    revenue: { $sum: "$effectivePrice" }
                }
            },
            { $sort: { "_id": 1 } },
            { $limit: 6 }
        ]);

        // Ensure the last 6 months always have data
        const today = new Date();
        const last6Months = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            last6Months.push({
                _id: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                month: d.toLocaleString('default', { month: 'short' }),
                properties: 0,
                revenue: 0,
                agent: '-'
            });
        }
        
        // Merge with actual data
        monthlyData.forEach(item => {
            const index = last6Months.findIndex(m => m._id === item._id);
            if(index !== -1) {
                last6Months[index].properties = item.properties;
                last6Months[index].revenue = item.revenue;
                // Since this system doesn't directly map agents in this aggregate, keep generic fallback if there are sales
                last6Months[index].agent = "Top Agent";
            }
        });
        
        const formattedMonthlyData = last6Months;

        res.status(200).json({
            success: true,
            data: {
                propertiesSold: result.propertiesSold,
                revenue: result.totalRevenue || 0,
                agentPerformance: 87.3, // Mock metric mapping
                monthlySales: formattedMonthlyData
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getSmartAlerts = async (req, res) => {
    try {
        // Dynamic alerts based on system state
        const alerts = [];
        let idCounter = 1;

        // 1. Pending Agents
        const pendingAgents = await User.countDocuments({ userType: 'agent', isApproved: false }); // Or isActive: false depending on user schema
        
        if (pendingAgents > 0) {
            alerts.push({
                id: idCounter++,
                title: 'New Agent Registration',
                message: `${pendingAgents} new agent(s) pending approval`,
                type: 'medium',
                time: 'Just now',
                read: false
            });
        } else {
             alerts.push({
                id: idCounter++,
                title: 'No Pending Agents',
                message: 'All agents are approved.',
                type: 'low',
                time: 'Just now',
                read: true
            });
        }

        // 2. High risk properties (mock dynamically)
        const highRisk = await Property.countDocuments({ status: 'active', riskCategory: 'HIGH' });
        if (highRisk > 0) {
            alerts.push({
                id: idCounter++,
                title: 'High Risk Properties Detected',
                message: `${highRisk} active properties flagged as high risk.`,
                type: 'high',
                time: '1 hour ago',
                read: false
            });
        }

        // 3. System performance notice
        alerts.push({
            id: idCounter++,
            title: 'Monthly Report Ready',
            message: 'Performance report is available',
            type: 'low',
            time: '2 hours ago',
            read: true
        });

        res.status(200).json({
            success: true,
            data: alerts
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- Market News ---
exports.getMarketNews = async (req, res) => {
    try {
        const news = await MarketNews.find().sort({ createdAt: -1 });
        // Format to match frontend structure
        const formattedNews = news.map(n => ({
            id: n._id.toString(),
            title: n.title,
            author: n.author,
            date: new Date(n.date).toISOString().split('T')[0],
            status: n.status
        }));
        
        // Add default mock news if DB is empty to populate the UI automatically
        if (formattedNews.length === 0) {
            const seedNews = [
                { title: 'Real Estate Market Shows Strong Growth in Q1', author: 'Market Analyst', status: 'approved' },
                { title: 'New Housing Development Announced Downtown', author: 'City Reporter', status: 'pending' },
                { title: 'Interest Rates Expected to Stabilize', author: 'Financial Expert', status: 'approved' }
            ];
            await MarketNews.insertMany(seedNews);
            const refetched = await MarketNews.find().sort({ createdAt: -1 });
            const refetchedFormat = refetched.map(n => ({
                id: n._id.toString(),
                title: n.title,
                author: n.author,
                date: new Date(n.date).toISOString().split('T')[0],
                status: n.status
            }));
            return res.status(200).json({ success: true, data: refetchedFormat });
        }

        res.status(200).json({ success: true, data: formattedNews });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createMarketNews = async (req, res) => {
    try {
        const { title, content, author, status } = req.body;
        const news = await MarketNews.create({ title, content, author, status });
        res.status(201).json({ success: true, data: news });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateMarketNewsStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!['pending', 'approved'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }
        const news = await MarketNews.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true, runValidators: true }
        );
        if (!news) {
            return res.status(404).json({ success: false, message: 'News not found' });
        }
        res.status(200).json({ success: true, data: news });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteMarketNews = async (req, res) => {
    try {
        const news = await MarketNews.findByIdAndDelete(req.params.id);
        if (!news) {
            return res.status(404).json({ success: false, message: 'News not found' });
        }
        res.status(200).json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
