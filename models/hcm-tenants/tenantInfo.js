import mongoose from 'mongoose';

// Contact Information Schema
const contactInfoSchema = new mongoose.Schema({
  phoneNumber: { type: String },
  email: { type: String, required: true },
  homePhone: { type: String },
  cellPhone: { type: String },
  race: { type: String },
  ethnicity: { type: String },
});

// Address Schema
const addressSchema = new mongoose.Schema({
  addressLine1: { type: String, required: true },
  addressLine2: { type: String },
  city: { type: String, required: true },
  state: { type: String, required: true },
  zipCode: { type: String, required: true },
  mailingSameAsAbove: { type: Boolean, default: false },
  mailingDifferent: { type: Boolean, default: false },
});

// Emergency Contact Schema
const emergencyContactSchema = new mongoose.Schema({
  firstName: { type: String },
  middleName: { type: String },
  lastName: { type: String },
  phoneNumber: { type: String },
  email: { type: String },
  relationship: { type: String },
});

// Case Manager Schema
const caseManagerSchema = new mongoose.Schema({
  firstName: { type: String },
  middleName: { type: String },
  lastName: { type: String },
  phoneNumber: { type: String },
  email: { type: String },
});

// Responsible Party Schema
const responsiblePartySchema = new mongoose.Schema({
  firstName: { type: String },
  middleName: { type: String },
  lastName: { type: String },
  phoneNumber: { type: String },
  email: { type: String },
  relationship: { type: String },
});

const insuranceSchema = new mongoose.Schema({
  insurance: { type: String, required: true },
  insuranceNumber: { type: String, required: true },
  ssn: { type: String },
  intakeDate: { type: Date },
  letGoDate: { type: Date },
  letGoReason: { type: String },
  diagnosisCode: { type: String, required: true },
  admissionDate: { type: Date, default: Date.now() },
});

const personalInfoSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  middleName: { type: String },
  lastName: { type: String, required: true },
  dob: { type: Date, required: true },
  gender: { type: String, required: true },
  maPMINumber: { type: String },
  email: { type: String, required: true },
  race: { type: String },
  ethnicity: { type: String },

});

const mailingAddressSchema = new mongoose.Schema({
  line1: { type: String },
  line2: { type: String },
  city: { type: String },
  state: { type: String },
  zipcode: { type: String },
});
const loginInfoSchema = new mongoose.Schema({
  userName: { type: String },
  password: { type: String },
});
const assessmentSchema = new mongoose.Schema({
  barriers: {
    type: String,
  },
  supportsNeeded: {
    type: String,
  },
});
// Main Tenant Info Schema
const tenantInfoSchema = new mongoose.Schema(
  {
    personalInfo: personalInfoSchema,
    address: addressSchema,
    contactInfo: contactInfoSchema,
    emergencyContact: emergencyContactSchema,
    admissionInfo: insuranceSchema,
    caseManager: caseManagerSchema,
    mailingAddress: mailingAddressSchema,
    loginInfo: loginInfoSchema,
    responsibleParty: responsiblePartySchema,
    assessment: assessmentSchema,
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'company',
    },
  },
  { timestamps: true }
);

export default mongoose.model('tenantInfo', tenantInfoSchema);
