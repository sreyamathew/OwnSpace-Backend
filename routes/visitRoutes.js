const express = require('express');
const router = express.Router();
const VisitRequest = require('../models/VisitRequest');
const Property = require('../models/Property');
const User = require('../models/User');
const transporter = require('../utils/mailer');
const { protect } = require('../middleware/auth');

// Create a visit request
router.post('/', protect, async (req, res) => {
	try {
		const { propertyId, scheduledAt, note } = req.body;
		if (!propertyId || !scheduledAt) {
			return res.status(400).json({ success: false, message: 'propertyId and scheduledAt are required' });
		}

		const property = await Property.findById(propertyId).populate('agent createdBy', 'name email userType');
		if (!property) {
			return res.status(404).json({ success: false, message: 'Property not found' });
		}

		// Choose recipient: agent if exists, else createdBy
		const recipientUser = property.agent || property.createdBy;
		const requesterUserId = req.user.userId;

		const visit = await VisitRequest.create({
			property: property._id,
			requester: requesterUserId,
			recipient: recipientUser,
			scheduledAt: new Date(scheduledAt),
			note: note || ''
		});

		// Notify recipient by email (best-effort)
		try {
			const recipient = await User.findById(recipientUser);
			if (recipient?.email) {
				await transporter.sendMail({
					from: process.env.EMAIL_USER,
					to: recipient.email,
					subject: 'New Property Visit Request',
					html: `A new visit request has been submitted for property "${property.title}" on ${new Date(scheduledAt).toLocaleString()}.`
				});
			}
		} catch (e) {
			console.warn('Email send failed:', e.message);
		}

		res.status(201).json({ success: true, data: visit, message: 'Visit request submitted' });
	} catch (error) {
		console.error('Create visit request error:', error);
		res.status(500).json({ success: false, message: 'Failed to create visit request' });
	}
});

// Approve or reject a visit request (recipient only)
router.put('/:id/status', protect, async (req, res) => {
	try {
		const { status } = req.body;
		if (!['approved', 'rejected'].includes(status)) {
			return res.status(400).json({ success: false, message: 'Invalid status' });
		}
		const visit = await VisitRequest.findById(req.params.id);
		if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });
		if (String(visit.recipient) !== String(req.user.userId)) {
			return res.status(403).json({ success: false, message: 'Not authorized to update this request' });
		}
		visit.status = status;
		await visit.save();
		res.json({ success: true, data: visit, message: `Visit ${status}` });
	} catch (error) {
		console.error('Update visit status error:', error);
		res.status(500).json({ success: false, message: 'Failed to update visit status' });
	}
});

// List my requests (as requester)
router.get('/my', protect, async (req, res) => {
	try {
		const { status } = req.query;
		const filter = { requester: req.user.userId };
		if (status) filter.status = status;
		const items = await VisitRequest.find(filter)
			.populate('property', 'title address images')
			.sort({ scheduledAt: 1 });
		res.json({ success: true, data: items });
	} catch (e) {
		res.status(500).json({ success: false, message: 'Failed to fetch requests' });
	}
});

// List requests assigned to me (as recipient)
router.get('/assigned', protect, async (req, res) => {
	try {
		const { status = 'pending' } = req.query;
		const items = await VisitRequest.find({ recipient: req.user.userId, status })
			.populate('property', 'title address images')
			.sort({ scheduledAt: 1 });
		res.json({ success: true, data: items });
	} catch (e) {
		res.status(500).json({ success: false, message: 'Failed to fetch assigned requests' });
	}
});

// Reschedule a visit by requester (sets status back to pending)
router.put('/:id/reschedule', protect, async (req, res) => {
	try {
		const { scheduledAt, note } = req.body;
		if (!scheduledAt) return res.status(400).json({ success: false, message: 'scheduledAt required' });
		const visit = await VisitRequest.findById(req.params.id);
		if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });
		if (String(visit.requester) !== String(req.user.userId)) {
			return res.status(403).json({ success: false, message: 'Not authorized to reschedule this request' });
		}
		visit.scheduledAt = new Date(scheduledAt);
		visit.status = 'pending';
		if (note) visit.note = note;
		await visit.save();
		res.json({ success: true, data: visit, message: 'Visit rescheduled and pending approval' });
	} catch (e) {
		console.error('Reschedule error:', e);
		res.status(500).json({ success: false, message: 'Failed to reschedule visit' });
	}
});

// Reschedule a visit by recipient (keep approved)
router.put('/:id/recipient-reschedule', protect, async (req, res) => {
	try {
		const { scheduledAt } = req.body;
		if (!scheduledAt) return res.status(400).json({ success: false, message: 'scheduledAt required' });
		const visit = await VisitRequest.findById(req.params.id);
		if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });
		if (String(visit.recipient) !== String(req.user.userId)) {
			return res.status(403).json({ success: false, message: 'Not authorized to reschedule this request' });
		}
		if (visit.status !== 'approved') {
			return res.status(400).json({ success: false, message: 'Only approved visits can be directly rescheduled by recipient' });
		}
		visit.scheduledAt = new Date(scheduledAt);
		await visit.save();
		res.json({ success: true, data: visit, message: 'Visit rescheduled' });
	} catch (e) {
		console.error('Recipient reschedule error:', e);
		res.status(500).json({ success: false, message: 'Failed to reschedule visit' });
	}
});

// Cancel a visit by requester (marks as rejected)
router.delete('/:id', protect, async (req, res) => {
	try {
		const visit = await VisitRequest.findById(req.params.id);
		if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });
		if (String(visit.requester) !== String(req.user.userId)) {
			return res.status(403).json({ success: false, message: 'Not authorized to cancel this request' });
		}
		visit.status = 'rejected';
		await visit.save();
		res.json({ success: true, message: 'Visit cancelled' });
	} catch (e) {
		res.status(500).json({ success: false, message: 'Failed to cancel visit' });
	}
});

module.exports = router;


