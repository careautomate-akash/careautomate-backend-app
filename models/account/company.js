import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
  addressLine1: { type: String },
  addressLine2: { type: String },
  city: { type: String },
  state: { type: String },
  zipCode: { type: String },
});

const companySchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'causers',
    required: true,
  },
  companyName: {
    type: String,
    required: true,
  },
  adminName: {
    type: String,
  },
  adminEmail: {
    type: String,
    required: true,
  },
  address: addressSchema,
  taxId: {
    type: String,
  },
});

export default mongoose.model('company', companySchema);
