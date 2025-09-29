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

		// Reject any scheduling in the past or present (server time)
		const scheduled = new Date(scheduledAt);
		const now = new Date();
		if (scheduled.getTime() <= now.getTime()) {
			return res.status(400).json({ success: false, message: 'Cannot schedule a visit in the past or present. Please select a future time.' });
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
		
		// Validate date is not in the past and within 30 days
		if (date < today || date > maxDate) {
			return res.status(400).json({ success: false, message: 'Date must be within the next 30 days' });
		}

		const created = [];
		const skipped = [];
		
		for (const start of times) {
			const [h, m] = start.split(':').map(Number);
			const endH = m + 30 >= 60 ? h + 1 : h;
			const endM = (m + 30) % 60;
			const end = `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}`;
			
			// For today's slots, validate they are at least 10 minutes in the future
			if (date === today) {
				const slotTime = new Date(now);
				slotTime.setHours(h, m, 0, 0);
				
				// Create a buffer time (current time + 10 minutes)
				const bufferTime = new Date(now);
				bufferTime.setMinutes(bufferTime.getMinutes() + 10);
				
				// Skip if slot time is not at least 10 minutes in the future
				if (slotTime <= bufferTime) {
					skipped.push({ time: start, reason: 'Time must be at least 10 minutes in the future' });
					continue;
				}
			}
			
			try {
				const slot = await VisitSlot.create({ property: property._id, date, startTime: start, endTime: end, createdBy: req.user.userId });
				created.push(slot);
			} catch (e) {
				// ignore duplicates
				skipped.push({ time: start, reason: 'Duplicate slot' });
			}
		}
		res.status(201).json({ 
			success: true, 
			data: created,
			skipped: skipped.length > 0 ? skipped : undefined,
			message: skipped.length > 0 ? `Created ${created.length} slots. Skipped ${skipped.length} invalid slots.` : `Created ${created.length} slots.`
		});
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
    const now = new Date();
    const start = toYMD(now);
    const end = toYMD(addDays(now, 30));

    const blackout = await UnavailableDate.find({ property: property._id, date: { $gte: start, $lte: end } });
    const blackoutSet = new Set(blackout.map(b => b.date));
    const slots = await VisitSlot.find({ property: property._id, date: { $gte: start, $lte: end }, isBooked: false, isExpired: false })
      .sort({ date: 1, startTime: 1 });

    // Group by date and exclude blackout dates
    const byDate = {};
    for (const s of slots) {
      if (blackoutSet.has(s.date)) continue;
      // Exclude any slot whose start time has already passed (server time)
      if (s.date === start) {
        try {
          const slotStart = new Date(`${s.date}T${s.startTime}:00`);
          if (slotStart.getTime() <= now.getTime()) continue;
        } catch (_) { /* ignore parse errors */ }
      }
      if (!byDate[s.date]) byDate[s.date] = [];
      byDate[s.date].push({ slotId: s._id, startTime: s.startTime, endTime: s.endTime });
    }
    // Only include dates that still have available slots
    const availableDates = Object.keys(byDate).filter(d => (byDate[d]?.length || 0) > 0);
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


