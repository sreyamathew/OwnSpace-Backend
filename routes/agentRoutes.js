const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

// Get all agents (Admin only)
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const agents = await User.find({ userType: 'agent' })
      .select('-password -otp -otpExpiry -resetPasswordToken -resetPasswordExpiry')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: agents,
      message: 'Agents retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch agents',
      error: error.message
    });
  }
});

// Update agent (Admin only)
router.put('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { name, email, phone, licenseNumber, agency, experience, specialization, status } = req.body;
    
    // Find the agent
    const agent = await User.findOne({ 
      _id: req.params.id, 
      userType: 'agent' 
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    // Check if email is being changed and if it's already taken
    if (email && email !== agent.email) {
      const existingUser = await User.findOne({ 
        email: email.toLowerCase(),
        _id: { $ne: req.params.id }
      });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email is already registered'
        });
      }
    }

    // Update basic fields
    if (name) agent.name = name;
    if (email) agent.email = email.toLowerCase();
    if (phone) agent.phone = phone;

    // Ensure agentProfile exists
    if (!agent.agentProfile) {
      agent.agentProfile = {};
    }

    // Update agent profile fields
    if (licenseNumber) agent.agentProfile.licenseNumber = licenseNumber;
    if (agency) agent.agentProfile.agency = agency;
    if (experience) agent.agentProfile.experience = experience;
    if (specialization) agent.agentProfile.specialization = specialization;

    // Handle status update
    if (status !== undefined) {
      agent.agentProfile.isVerified = status === 'active';
    }

    agent.updatedAt = new Date();
    await agent.save();

    // Return updated agent without sensitive data
    const updatedAgent = await User.findById(agent._id)
      .select('-password -otp -otpExpiry -resetPasswordToken -resetPasswordExpiry');

    res.json({
      success: true,
      data: updatedAgent,
      message: 'Agent updated successfully'
    });
  } catch (error) {
    console.error('Error updating agent:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update agent',
      error: error.message
    });
  }
});

// Delete agent (Admin only)
router.delete('/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const agent = await User.findOne({ 
      _id: req.params.id, 
      userType: 'agent' 
    });

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    await User.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Agent deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting agent:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete agent',
      error: error.message
    });
  }
});

module.exports = router;