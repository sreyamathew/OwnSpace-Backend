const express = require('express');
const router = express.Router();
const {
    getSoldStats,
    getSalesByLocation,
    getMonthlySalesTrend,
    getRiskDistribution,
    getSoldList
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');

// All report routes are admin-only
router.use(protect);
router.use(authorize('admin'));

router.get('/sold-stats', getSoldStats);
router.get('/sales-by-location', getSalesByLocation);
router.get('/sales-trend', getMonthlySalesTrend);
router.get('/risk-distribution', getRiskDistribution);
router.get('/sold-list', getSoldList);

module.exports = router;
