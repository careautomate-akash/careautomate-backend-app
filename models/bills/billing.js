import mongoose from 'mongoose';

const billingSchema = new mongoose.Schema({
  name: {
    type: String,
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users'
  },
  visitId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'visits'
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'companies'
  },
  companyNPI: { type: String },
  controlNumber: { type: String, default: '111111303' },
  bill: {
    taxonomyCode: { type: String, },
    additionalIdentifier: { type: String, },
    claimInformation: {
      patientAccountNumber: { type: String, },
      totalClaimChargeAmount: { type: Number, },
      medicalRecordNumber: { type: String, },
      diagnosisCode: { type: String, },
    }
  },
  insurance: {
    name: { type: String },
    identifier: { type: String, }
  },
  company: {
    name: { type: String, },
    address: {
      addressLine1: { type: String, },
      addressLine2: { type: String, },
      city: { type: String, },
      state: { type: String, },
      zipCode: { type: String, },
    },
    taxId: { type: String, }
  },
  patientDetails: {
    firstName: { type: String, },
    lastName: { type: String, },
    identifier: { type: String, },
    adress: {
      addressLine1: { type: String, },
      addressLine2: { type: String, },
      city: { type: String, },
      state: { type: String, },
      zipCode: { type: String, },
    },
    gender: { type: String, },
    birthDate: { type: Date },
    pmiNumber: { type: String, },
    diagnosisCode: { type: String, }
  },
  serviceLine: {
    procedureCode: { type: String, },
    lineItemChargeAmount: { type: Number, },
    serviceUnitCount: { type: Number, },
    serviceDate: { type: Date, },
    description: { type: String, }
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('Billing', billingSchema);