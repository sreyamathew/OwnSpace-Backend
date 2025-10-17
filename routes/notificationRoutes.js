const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const { markNotificationsRead, emitUnreadCount } = require('../utils/notificationService');

router.get('/', protect, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const cursor = req.query.before;
    const filter = { userId: req.user.userId };
    if (cursor) {
      filter.createdAt = { $lt: new Date(cursor) };
    }
    const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(limit);
    res.json({ success: true, data: notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
});

router.get('/unread-count', protect, async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({ userId: req.user.userId, isRead: false });
    res.json({ success: true, data: { unreadCount } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch unread count' });
  }
});

router.post('/mark-read', protect, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = await markNotificationsRead(req.user.userId, ids);
    res.json({ success: true, data: { modifiedCount: result.modifiedCount } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to mark notifications as read' });
  }
});

router.post('/mark-all-read', protect, async (req, res) => {
  try {
    const result = await markNotificationsRead(req.user.userId);
    res.json({ success: true, data: { modifiedCount: result.modifiedCount } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to mark notifications as read' });
  }
});

router.post('/refresh-unread', protect, async (req, res) => {
  try {
    const unreadCount = await emitUnreadCount(req.user.userId);
    res.json({ success: true, data: { unreadCount } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to refresh unread count' });
  }
});

module.exports = router;
