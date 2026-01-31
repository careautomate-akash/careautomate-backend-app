import mongoose from 'mongoose';

const PersonalInfoSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
    },
    middleInitial: {
      type: String,
    },
    lastName: {
      type: String,
      required: true,
    },
    dateOfBirth: {
      type: Date,
      required: true,
    },
    gender: {
      type: String,
    },
    ssn: {
      type: String,
      unique: true,
      required: true,
    },
    address: {
      line1: { type: String, required: true },
      line2: { type: String },
      city: { type: String, required: true },
      state: { type: String, required: true },
      zipCode: { type: String, required: true },
    },
    contact: {
      homePhone: { type: String },
      cellPhone: { type: String },
      workPhone: { type: String },
      email: { type: String },
    },
  },
  { _id: false }
);

const EmergencyContactSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    middleInitial: { type: String },
    lastName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    email: { type: String },
    relationship: { type: String, required: true },
  },
  { _id: false }
);

const ResponsiblePartySchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    middleInitial: { type: String },
    lastName: { type: String, required: true },
    phoneNumber: { type: String, required: true },
    email: { type: String },
    relationship: { type: String, required: true },
  },
  { _id: false }
);

const ServiceSchema = new mongoose.Schema(
  {
    serviceType: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalDays: { type: Number, required: true },
    totalUnits: { type: Number, required: true },
    unitsPerDay: { type: Number, required: true },
    unitsPerWeek: { type: Number, required: true },
  },
  { _id: false }
);

const CaregiverSchema = new mongoose.Schema(
  {
    caregiverName: { type: String, required: true },
    serviceTypes: [ServiceSchema],
  },
  { _id: false }
);

const TenantSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      unique: true,
    },
    personalInfo: PersonalInfoSchema,
    emergencyContact: EmergencyContactSchema,
    responsibleParty: ResponsiblePartySchema,
    insurance: {
      type: String,
      required: true,
    },
    services: [ServiceSchema],
    caregivers: [CaregiverSchema],
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'company',
    },
  },
  { timestamps: true }
);

export default mongoose.model('tenant', TenantSchema);
