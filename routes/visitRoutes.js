const express = require('express');
const router = express.Router();
const VisitRequest = require('../models/VisitRequest');
const Property = require('../models/Property');
const User = require('../models/User');
const transporter = require('../utils/mailer');
const { protect, authorize } = require('../middleware/auth');
const VisitSlot = require('../models/VisitSlot');
const UnavailableDate = require('../models/UnavailableDate');

// Helpers
const toYMD = (d) => {
	const dt = new Date(d);
	return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
};
const toHM = (d) => {
	const dt = new Date(d);
	return `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
};
const addDays = (d, n) => {
	const dt = new Date(d);
	dt.setDate(dt.getDate()+n);
	return dt;
};

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

		// Reject any scheduling in the past (server time)
		const scheduled = new Date(scheduledAt);
		const now = new Date();
		if (scheduled.getTime() <= now.getTime()) {
			return res.status(400).json({ success: false, message: 'Cannot schedule a visit in the past' });
		}

		// Validate against available slots and blackout dates
		const ymd = toYMD(scheduled);
		const hm = toHM(scheduled);
		const today = toYMD(new Date());
		const maxDate = toYMD(addDays(new Date(), 30));

		if (ymd < today || ymd > maxDate) {
			return res.status(400).json({ success: false, message: 'Date must be within the next 30 days' });
		}

		const isUnavailable = await UnavailableDate.findOne({ property: property._id, date: ymd });
		if (isUnavailable) {
			return res.status(400).json({ success: false, message: 'Selected date is unavailable' });
		}

		const slot = await VisitSlot.findOne({ property: property._id, date: ymd, startTime: hm, isBooked: false });
		if (!slot) {
			return res.status(400).json({ success: false, message: 'Selected time slot is not available' });
		}

		// Extra guard: if slot is today, ensure its startTime is still in the future vs server time
		if (ymd === today) {
			const [sh, sm] = slot.startTime.split(':').map(Number);
			const slotDate = new Date();
			slotDate.setHours(sh, sm, 0, 0);
			if (slotDate.getTime() <= now.getTime()) {
				return res.status(400).json({ success: false, message: 'Selected time slot has already passed' });
			}
		}

		// Choose recipient: agent if exists, else createdBy
		const recipientUser = property.agent || property.createdBy;
		const requesterUserId = req.user.userId;

		const visit = await VisitRequest.create({
			property: property._id,
			requester: requesterUserId,
			recipient: recipientUser,
			scheduledAt: scheduled,
			note: note || ''
		});

		// Note: Frontend records 'visit_requested' in local history; approval will be reflected via status change endpoints

		// Mark slot as booked
		slot.isBooked = true;
		slot.bookedByVisitId = visit._id;
		await slot.save();

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

// Manage slots (agent/admin)
router.post('/slots', protect, authorize('agent', 'admin'), async (req, res) => {
	try {
		const { propertyId, date, times } = req.body; // times: array of HH:mm starts
		if (!propertyId || !date || !Array.isArray(times)) {
			return res.status(400).json({ success: false, message: 'propertyId, date, and times[] are required' });
		}
		const property = await Property.findById(propertyId);
		if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

		const now = new Date();
		const today = toYMD(now);
		const maxDate = toYMD(addDays(now, 30));
		
		// Rule 1: If the selected date is in the past → block it completely
		if (date < today) {
			return res.status(400).json({ success: false, message: 'Cannot create slots for past dates' });
		}
		
		// Validate date is within allowed range
		if (date > maxDate) {
			return res.status(400).json({ success: false, message: 'Date must be within the next 30 days' });
		}

		const created = [];
		const currentHour = now.getHours();
		const currentMinute = now.getMinutes();
		
		for (const start of times) {
			const [h, m] = start.split(':').map(Number);
			
			// Rule 2: If the selected date is today → only allow time slots that are at least 10 minutes later than the current time
			if (date === today) {
				// Calculate if this time is at least 10 minutes in the future
				if (h < currentHour || (h === currentHour && m < currentMinute + 10)) {
					continue; // Skip this time slot as it's less than 10 minutes in the future
				}
			}
			
			const endH = m + 30 >= 60 ? h + 1 : h;
			const endM = (m + 30) % 60;
			const end = `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`;
			try {
				const slot = await VisitSlot.create({ property: property._id, date, startTime: start, endTime: end, createdBy: req.user.userId });
				created.push(slot);
			} catch (e) {
				// ignore duplicates
			}
		}
		res.status(201).json({ success: true, data: created });
	} catch (e) {
		console.error('Create slots error:', e);
		res.status(500).json({ success: false, message: 'Failed to create slots' });
	}
});

router.delete('/slots/:slotId', protect, authorize('agent', 'admin'), async (req, res) => {
	try {
		const slot = await VisitSlot.findById(req.params.slotId);
		if (!slot) return res.status(404).json({ success: false, message: 'Slot not found' });
		if (slot.isBooked) return res.status(400).json({ success: false, message: 'Cannot delete a booked slot' });
		await slot.deleteOne();
		res.json({ success: true, message: 'Slot deleted' });
	} catch (e) {
		res.status(500).json({ success: false, message: 'Failed to delete slot' });
	}
});

// Manage unavailable dates (agent/admin)
router.post('/unavailable', protect, authorize('agent', 'admin'), async (req, res) => {
	try {
		const { propertyId, date } = req.body;
		if (!propertyId || !date) return res.status(400).json({ success: false, message: 'propertyId and date are required' });
		const property = await Property.findById(propertyId);
		if (!property) return res.status(404).json({ success: false, message: 'Property not found' });
		const today = toYMD(new Date());
		const maxDate = toYMD(addDays(new Date(), 30));
		if (date < today || date > maxDate) {
			return res.status(400).json({ success: false, message: 'Date must be within the next 30 days' });
		}
		const item = await UnavailableDate.findOneAndUpdate(
			{ property: property._id, date },
			{ property: property._id, date, createdBy: req.user.userId },
			{ new: true, upsert: true }
		);
		// Also remove any unbooked slots for that date
		await VisitSlot.deleteMany({ property: property._id, date, isBooked: false });
		res.status(201).json({ success: true, data: item });
	} catch (e) {
		console.error('Mark unavailable error:', e);
		res.status(500).json({ success: false, message: 'Failed to mark date unavailable' });
	}
});

router.delete('/unavailable', protect, authorize('agent', 'admin'), async (req, res) => {
	try {
		const { propertyId, date } = req.body;
		if (!propertyId || !date) return res.status(400).json({ success: false, message: 'propertyId and date are required' });
		await UnavailableDate.deleteOne({ property: propertyId, date });
		res.json({ success: true, message: 'Unavailable date removed' });
	} catch (e) {
		res.status(500).json({ success: false, message: 'Failed to remove unavailable date' });
	}
});

// Public availability for buyers
router.get('/availability/:propertyId', async (req, res) => {
	try {
		const { propertyId } = req.params;
		const property = await Property.findById(propertyId);
		if (!property) return res.status(404).json({ success: false, message: 'Property not found' });
		const start = toYMD(new Date());
		const end = toYMD(addDays(new Date(), 30));

		const blackout = await UnavailableDate.find({ property: property._id, date: { $gte: start, $lte: end } });
		const blackoutSet = new Set(blackout.map(b => b.date));
		// Get current date and time for filtering expired slots
		const now = new Date();
		const currentDate = toYMD(now);
		const currentHour = now.getHours();
		const currentMinute = now.getMinutes();
		const currentTime = `${String(currentHour).padStart(2,'0')}:${String(currentMinute).padStart(2,'0')}`;
		
		// Filter out expired slots (past dates or today with time in the past)
		const slots = await VisitSlot.find({
			property: property._id,
			date: { $gte: start, $lte: end },
			isBooked: false,
			$or: [
				{ date: { $gt: currentDate } }, // Future dates
				{ date: currentDate, startTime: { $gt: currentTime } } // Today but future time
			]
		})
			.sort({ date: 1, startTime: 1 })
			.lean();

		// Group by date and exclude blackout dates
		const byDate = {};
		for (const s of slots) {
			if (blackoutSet.has(s.date)) continue;
			if (!byDate[s.date]) byDate[s.date] = [];
			byDate[s.date].push({ slotId: s._id, startTime: s.startTime, endTime: s.endTime });
		}
		const availableDates = Object.keys(byDate);
		res.json({ success: true, data: { availableDates, slotsByDate: byDate } });
	} catch (e) {
		console.error('Fetch availability error:', e);
		res.status(500).json({ success: false, message: 'Failed to fetch availability' });
	}
});

// Approve or reject a visit request (recipient only)
router.put('/:id/status', protect, async (req, res) => {
	try {
		const { status } = req.body;
		if (!['approved', 'rejected'].includes(status)) {
			return res.status(400).json({ success: false, message: 'Invalid status' });
		}
		const visit = await VisitRequest.findById(req.params.id).populate('property', 'title').populate('requester', 'name email');
		if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });
		if (String(visit.recipient) !== String(req.user.userId)) {
			return res.status(403).json({ success: false, message: 'Not authorized to update this request' });
		}
		visit.status = status;
		await visit.save();

		// Best-effort email notification to requester when status changes
		if (status === 'rejected' || status === 'approved') {
			try {
				const requesterEmail = visit?.requester?.email;
				if (requesterEmail) {
					const subject = status === 'approved' ? 'Your Property Visit Was Approved' : 'Your Property Visit Was Cancelled';
					const statusText = status === 'approved' ? 'approved' : 'cancelled';
					await transporter.sendMail({
						from: process.env.EMAIL_USER,
						to: requesterEmail,
						subject: subject,
						html: `Hello ${visit?.requester?.name || ''},<br/><br/>Your visit for the property "${visit?.property?.title || 'Property'}" scheduled on ${new Date(visit.scheduledAt).toLocaleString()} has been ${statusText} by the recipient.<br/><br/>${status === 'approved' ? 'We look forward to seeing you at the scheduled time.' : 'You can request a new time from your dashboard.'}<br/><br/>Regards,<br/>OwnSpace Team`
					});
				}
			} catch (mailErr) {
				console.warn('Failed to send cancellation email:', mailErr?.message || mailErr);
			}
		}

		res.json({ success: true, data: visit, message: `Visit ${status}` });
	} catch (error) {
		console.error('Update visit status error:', error);
		res.status(500).json({ success: false, message: 'Failed to update visit status' });
	}
});

// Update visit status to visited or not visited (Admin/Agent only)
router.put('/:id/visit-status', protect, authorize('agent', 'admin'), async (req, res) => {
	try {
		const { status } = req.body;
		if (!['visited', 'not visited'].includes(status)) {
			return res.status(400).json({ success: false, message: 'Invalid status. Must be "visited" or "not visited"' });
		}
		
		const visit = await VisitRequest.findById(req.params.id).populate('property', 'title');
		if (!visit) return res.status(404).json({ success: false, message: 'Visit request not found' });
		
		// Check if the user is the recipient of the visit request
		if (String(visit.recipient) !== String(req.user.userId)) {
			return res.status(403).json({ success: false, message: 'Not authorized to update this request' });
		}
		
		// Check if the scheduled time has passed
		const now = new Date();
		if (new Date(visit.scheduledAt) > now) {
			return res.status(400).json({ 
				success: false, 
				message: 'Cannot update visit status before the scheduled time' 
			});
		}
		
		// Check if the visit was approved (can only mark visited/not visited for approved visits)
		if (visit.status !== 'approved') {
			return res.status(400).json({ 
				success: false, 
				message: 'Only approved visits can be marked as visited or not visited' 
			});
		}
		
		visit.status = status;
		await visit.save();
		
		// Best-effort email notification to requester
		try {
			const requester = await User.findById(visit.requester);
			if (requester?.email) {
				const statusText = status === 'visited' ? 'completed' : 'marked as not attended';
				await transporter.sendMail({
					from: process.env.EMAIL_USER,
					to: requester.email,
					subject: `Your Property Visit Status Updated`,
					html: `Hello ${requester.name || ''},<br/><br/>Your visit for the property "${visit?.property?.title || 'Property'}" scheduled on ${new Date(visit.scheduledAt).toLocaleString()} has been ${statusText}.<br/><br/>Thank you for using our service.`
				});
			}
		} catch (mailErr) {
			console.warn('Failed to send status update email:', mailErr?.message || mailErr);
		}
		
		res.json({ success: true, data: visit, message: `Visit marked as ${status}` });
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
			.populate({
				path: 'property',
				select: 'title address images agent',
				populate: { path: 'agent', select: 'name' }
			})
			.sort({ scheduledAt: 1 });
		res.json({ success: true, data: items });
	} catch (e) {
		res.status(500).json({ success: false, message: 'Failed to fetch requests' });
	}
});

// List requests assigned to me (as recipient)
router.get('/assigned', protect, async (req, res) => {
    try {
        // Support filtering by status and future/past flags
        // Defaults: status=approved for dashboard usage if not explicitly provided
        let { status, futureOnly, pastOnly } = req.query;
        if (!status) status = 'approved';

        const baseQuery = { recipient: req.user.userId };

        // Build default mongoose query (by single status)
        let mongooseQuery = VisitRequest.find({ ...baseQuery, status })
            .populate({
                path: 'property',
                select: 'title address images agent',
                populate: { path: 'agent', select: 'name' }
            })
            .sort({ scheduledAt: 1 });

        // If futureOnly=true, filter scheduledAt to be in the future
        if (String(futureOnly).toLowerCase() === 'true') {
            const now = new Date();
            mongooseQuery = VisitRequest.find({ ...baseQuery, status, scheduledAt: { $gt: now } })
                .populate({
                    path: 'property',
                    select: 'title address images agent',
                    populate: { path: 'agent', select: 'name' }
                })
                .sort({ scheduledAt: 1 });
        }

        // If pastOnly=true, include approved + visited + not visited and scheduled in the past
        if (String(pastOnly).toLowerCase() === 'true') {
            const now = new Date();
            const statuses = ['approved', 'visited', 'not visited'];
            mongooseQuery = VisitRequest.find({ ...baseQuery, status: { $in: statuses }, scheduledAt: { $lt: now } })
                .populate({
                    path: 'property',
                    select: 'title address images agent',
                    populate: { path: 'agent', select: 'name' }
                })
                .sort({ scheduledAt: -1 }); // most recent past first
        }

        const items = await mongooseQuery;
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


