import mongoose from 'mongoose';

const serviceSchema = new mongoose.Schema({
  // user_id:{type: mongoose.Schema.Types.ObjectId,ref:'causers',required:true},
  service_name: { type: String, required: true },
  service_type: { type: String, required: true },
  service_duration: { type: String, required: true },
  service_procedure_code: { type: String, required: true },
  service_modifiers: { type: [String], required: false, default: [] },
  service_rate: { type: Number, required: true },
  default_units: { type: Number, required: false, default: 100 },
  visit_frequency: { type: [String], required: true },
  covered_parent_activities: { type: [String], required: false, default: [] },
  place_of_service: { type: [String], required: false, default: [] },
  state_of_service:{ type: String, required: true },
  // company: {
  //   type: mongoose.Schema.Types.ObjectId,
  //   ref: 'company',
  //   required: true,
  // },
});

const Service = mongoose.model('Service', serviceSchema);

export default Service;
