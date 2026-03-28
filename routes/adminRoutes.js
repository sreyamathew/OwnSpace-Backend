const express = require('express');
const router = express.Router();
const {
    getDashboardStats,
    getSalesReports,
    getSmartAlerts,
    getMarketNews,
    createMarketNews,
    updateMarketNewsStatus,
    deleteMarketNews
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');

// Protect all admin routes
router.use(protect);
router.use(authorize('admin'));

// Dashboard aggregated data routes
router.get('/dashboard-stats', getDashboardStats);
router.get('/sales-reports', getSalesReports);
router.get('/smart-alerts', getSmartAlerts);

// Market News management routes
router.get('/market-news', getMarketNews);
router.post('/market-news', createMarketNews);
router.put('/market-news/:id/status', updateMarketNewsStatus);
router.delete('/market-news/:id', deleteMarketNews);

module.exports = router;
