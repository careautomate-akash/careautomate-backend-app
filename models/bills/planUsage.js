import mongoose from 'mongoose';

const planUsageSchema = new mongoose.Schema({
  planId: { type: String, required: true },
  name: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  units: {
    allottedUnits: { type: Number, required: true },
    workedUnits: { type: Number, required: true },
    remainingUnits: { type: Number, required: true },
  },
  hours: {
    allottedHours: { type: Number, required: true },
    workedHours: { type: Number, required: true },
    remainingHours: { type: Number, required: true },
  },
  visits: {
    scheduled: { type: Number, required: true },
    completed: { type: Number, required: true },
    billed: { type: Number, required: true },
    unbilled: { type: Number, required: true },
    direct: { type: String, required: true },
    indirect: { type: String, required: true },
    remote: { type: String, required: true },
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'company'
  }
});

const PlanUsage = mongoose.model('PlanUsage', planUsageSchema);
export default PlanUsage;
