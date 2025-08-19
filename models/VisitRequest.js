const mongoose = require('mongoose');

const visitRequestSchema = new mongoose.Schema({
	property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
	requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
	recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
	scheduledAt: { type: Date, required: true },
	status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
	note: { type: String },
}, { timestamps: true });

visitRequestSchema.index({ recipient: 1, status: 1, scheduledAt: 1 });
visitRequestSchema.index({ requester: 1, status: 1 });

module.exports = mongoose.model('VisitRequest', visitRequestSchema);


