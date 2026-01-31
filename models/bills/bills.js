import mongoose from 'mongoose';

const billSchema = new mongoose.Schema({
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
  serviceDate: { type: Date, default: Date.now },
  monthYearKey: { type: String },
  fileName: { type: String },
  ediContent: { type: String },
  ediFileName: { type: String },
  companyNPI: { type: String },
  controlNumber: { type: String, default: '111111303' },
  claimId: { type: String },
  isGovernmentInsurance: { type: Boolean, default: false },
  bill: {
    taxonomyCode: { type: String, },
    additionalIdentifier: { type: String, },
    claimInformation: {
      patientAccountNumber: { type: String, },
      totalClaimChargeAmount: { type: Number, },
      medicalRecordNumber: { type: String, },
      diagnosisCode: { type: String, },
      claimId: { type: String, }
    }
  },
  insurance: {
    name: { type: String },
    identifier: { type: String, },
    type: { type: String },
    memberNumber: { type: String },
    planName: { type: String },
    payerId: { type: String }
  },
  company: {
    name: { type: String, },
    address: {
      addressLine1: { type: String, },
      addressLine2: { type: String, },
      city: { type: String, },
      state: { type: String, },
      zipCode: { type: String, },
      zipcode: { type: String, }
    },
    taxId: { type: String },
    umpi: { type: String }
  },
  patientDetails: {
    firstName: { type: String, },
    lastName: { type: String, },
    identifier: { type: String, },
    address: {
      addressLine1: { type: String, },
      addressLine2: { type: String, },
      city: { type: String, },
      state: { type: String, },
      zipcode: { type: String, },
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
    description: { type: String, },
    modifier: { type: String, },
    serviceType: {
      type: String,
    },
    serviceName: { type: String, },
    serviceDisplayName: { type: String, }
  },
  serviceLines: [{
    procedureCode: { type: String },
    modifier: { type: String },
    lineItemChargeAmount: { type: Number },
    serviceUnitCount: { type: Number },
    serviceDate: { type: Date },
    description: { type: String },
    serviceType: { type: String },
    serviceName: { type: String },
    serviceDisplayName: { type: String },
    claimId: { type: String },
    visitId: { type: mongoose.Schema.Types.ObjectId, ref: 'visits' },
    methodOfContact: { type: String, default: 'in_person' }
  }],
  hcms: [{
    id: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
    name: { type: String },
    serviceDate: { type: Date, default: null },
    workedUnits: { type: Number, default: 0 },
    billAmount: { type: Number, default: 0 },
  }],
  scheduledFor: { type: Date, default: Date.now },
  status: { type: String, default: 'scheduled' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

billSchema.index({ tenantId: 1, status: 1 });
billSchema.index({ visitId: 1 });
billSchema.index({ serviceDate: 1 });
billSchema.index({ "hcms.id": 1, status: 1 });
billSchema.index({ "hcms.id": 1 });
billSchema.index({ ediFileName: "text" });
billSchema.index({ monthYearKey: 1 });
billSchema.index({ tenantId: 1, monthYearKey: 1 });
billSchema.index({ claimId: 1 });

export default mongoose.model('Bill', billSchema);