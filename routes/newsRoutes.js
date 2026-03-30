const express = require('express');
const router = express.Router();
const News = require('../models/News');
const { protect, authorize } = require('../middleware/auth');

// @desc    Create news
// @route   POST /api/news
// @access  Private (Agent)
router.post('/', protect, authorize('agent'), async (req, res) => {
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: 'Please provide title and content'
      });
    }

    const news = await News.create({
      title,
      content,
      createdBy: req.user.userId,
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      data: news
    });
  } catch (error) {
    console.error('Error creating news:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error: Failed to create news'
    });
  }
});

// @desc    Get all news for management
// @route   GET /api/news
// @access  Private (Admin)
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const news = await News.find()
      .populate('createdBy', 'name email').sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: news
    });
  } catch (error) {
    console.error('Error fetching all news:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error: Failed to fetch news'
    });
  }
});

// @desc    Update news status
// @route   PUT /api/news/:id
// @access  Private (Admin)
router.put('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const news = await News.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!news) {
      return res.status(404).json({
        success: false,
        message: 'News not found'
      });
    }

    res.status(200).json({
      success: true,
      data: news
    });
  } catch (error) {
    console.error('Error updating news status:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error: Failed to update news'
    });
  }
});

// @desc    Get approved news
// @route   GET /api/news/approved
// @access  Private (All Users)
router.get('/approved', protect, async (req, res) => {
  try {
    const news = await News.find({ status: 'approved' })
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: news
    });
  } catch (error) {
    console.error('Error fetching approved news:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error: Failed to fetch approved news'
    });
  }
});

module.exports = router;
