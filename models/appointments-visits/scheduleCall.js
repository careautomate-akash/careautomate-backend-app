import mongoose from 'mongoose';

const scheduleCallSchema = new mongoose.Schema({
    companyId: { type: String, required: true },
    scheduledDate: { type: Date, required: true },
    scheduledTime: { type: String, required: true },
    duration: { type: Number, required: true },
    scheduledBy: { type: String, required: true },
    scheduledTo: { type: String, required: true },
    status: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model('ScheduleCall', scheduleCallSchema);