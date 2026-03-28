const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Offer = require('../models/Offer');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { createNotification, notifyAdmins } = require('../utils/notificationService');
const transporter = require('../utils/mailer');
const Property = require('../models/Property');

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = 'uploads/documents';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only images and PDF files are allowed!'));
  }
});

// Upload documents for an offer
router.post('/upload/:offerId', protect, upload.array('documents', 5), async (req, res) => {
  try {
    const { offerId } = req.params;
    
    // Find the offer
    const offer = await Offer.findById(offerId);
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }

    // Ensure requester is the investor
    if (String(offer.investorId) !== String(req.userProfile._id)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No documents uploaded' });
    }

    // Save file URLs to the offer
    const uploadedDocs = req.files.map(file => ({
      url: `/uploads/documents/${file.filename}`,
      name: file.originalname,
      uploadedAt: new Date()
    }));

    // Update offer
    offer.documents = [...(offer.documents || []), ...uploadedDocs];
    offer.documentStatus = 'pending';
    offer.updatedAt = new Date();
    await offer.save();

    // Notify Admins/Agent
    try {
      // Find property to get agent email
      const property = await Property.findById(offer.propertyId).populate('agent', 'name email');
      const agentEmail = property?.agent?.email;
      const agentName = property?.agent?.name || 'Agent';

      await createNotification({
        userId: offer.agentId,
        type: 'document_uploaded',
        title: 'Documents Uploaded',
        message: `${req.userProfile.name} uploaded documents for verification.`,
        metadata: { offerId: offer._id }
      });
      await notifyAdmins(
        'document_uploaded',
        'Documents Uploaded',
        `${req.userProfile.name} uploaded documents for an offer.`,
        { offerId: offer._id }
      );

      // Send Email to Agent
      if (agentEmail) {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: agentEmail,
          subject: 'Action Required: Property Documents Uploaded',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2>New Documents Uploaded</h2>
              <p>Hello ${agentName},</p>
              <p>The buyer <strong>${req.userProfile.name}</strong> has uploaded documents for property: <strong>${property.title}</strong>.</p>
              <p>Please review and verify the documents in your dashboard to proceed with the transaction.</p>
            </div>
          `
        });
      }
    } catch (e) {
      console.warn('Failed to send notification on document upload', e);
    }

    res.status(200).json({ success: true, message: 'Documents uploaded successfully', data: { documents: offer.documents, documentStatus: offer.documentStatus } });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server Error' });
  }
});

// Get documents for an offer
router.get('/:offerId', protect, async (req, res) => {
  try {
    const { offerId } = req.params;
    const offer = await Offer.findById(offerId).populate('investorId', 'name email');
    
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }

    const isOwner = String(offer.investorId._id || offer.investorId) === String(req.userProfile._id);
    const isAdminOrAgent = req.userProfile.userType === 'admin' || req.userProfile.userType === 'agent';
    
    if (!isOwner && !isAdminOrAgent) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    res.status(200).json({ 
      success: true, 
      data: {
        documentStatus: offer.documentStatus,
        documents: offer.documents,
        verificationRemarks: offer.verificationRemarks,
        verificationDate: offer.verificationDate
      }
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Verify documents (Admin/Agent only)
router.put('/verify/:offerId', protect, async (req, res) => {
  try {
    const { offerId } = req.params;
    const { status, remarks } = req.body;
    
    if (!['approved', 'rejected', 'pending'].includes(status)) {
       return res.status(400).json({ success: false, message: 'Invalid status. Must be approved, rejected, or pending' });
    }

    if (req.userProfile.userType !== 'admin' && req.userProfile.userType !== 'agent') {
      return res.status(403).json({ success: false, message: 'Only admins or agents can verify documents' });
    }

    const offer = await Offer.findById(offerId);
    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }

    offer.documentStatus = status;
    offer.verificationRemarks = remarks || '';
    if (status !== 'pending') {
      offer.verificationDate = new Date();
    }
    
    await offer.save();

    // Notify Buyer
    try {
      const uStatus = status.charAt(0).toUpperCase() + status.slice(1);
      const buyer = await User.findById(offer.investorId).select('name email');
      const property = await Property.findById(offer.propertyId).select('title');

      await createNotification({
        userId: offer.investorId,
        type: 'document_verification',
        title: `Documents ${uStatus}`,
        message: `Your documents have been ${status}. ${remarks ? `Remarks: ${remarks}` : ''}`,
        metadata: { offerId: offer._id, status }
      });

      // Send Email to Buyer
      if (buyer?.email) {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: buyer.email,
          subject: `Document Verification: ${uStatus}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2>Document Verification Update</h2>
              <p>Hello ${buyer.name || 'Buyer'},</p>
              <p>Your documents for <strong>${property?.title || 'the property'}</strong> have been <strong>${status}</strong>.</p>
              ${remarks ? `<p><strong>Remarks from Admin:</strong> ${remarks}</p>` : ''}
              ${status === 'approved' ? '<p>You can now proceed to pay the advance amount from your dashboard.</p>' : '<p>Please re-upload the required documents to proceed.</p>'}
            </div>
          `
        });
      }
    } catch (e) {
      console.warn('Failed to notify document status change', e);
    }

    res.status(200).json({ success: true, message: `Documents ${status}`, data: { documentStatus: offer.documentStatus, verificationRemarks: offer.verificationRemarks } });
  } catch (error) {
    console.error('Error verifying documents:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

module.exports = router;
