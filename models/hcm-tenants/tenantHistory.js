import mongoose from 'mongoose';

const tenantHistorySchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'causers', required: true },
    updatedFields: { type: mongoose.Schema.Types.Mixed, required: true }, // Store updated fields as a mixed type
    updatedBy: { type: String, required: true }, // Name of the person who made the update
    updatedById: { type: mongoose.Schema.Types.ObjectId, ref: 'causers', required: true }, // ID of the person who made the update
    updatedAt: { type: Date, default: Date.now } // Timestamp of when the update was made
});

export default mongoose.model('tenantHistory', tenantHistorySchema); 