const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.use(authorize('admin'));

router.get('/stats', analyticsController.getDashboardStats);
router.get('/location-distribution', analyticsController.getLocationDistribution);
router.get('/monthly-trends', analyticsController.getMonthlyTrends);
router.get('/risk-distribution', analyticsController.getRiskDistribution);
router.get('/ai-insights', analyticsController.getAIInsights);

module.exports = router;
