import mongoose from 'mongoose';

// Personal Information Schema
const personalInfoSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    middleName: { type: String },
    lastName: { type: String, required: true },
    dob: { type: Date }, // Assuming date format is MM-DD-YYYY
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
});

// Contact Information Schema
const contactInfoSchema = new mongoose.Schema({
    phoneNumber: { type: String, required: true },
    email: { type: String, required: true },
    homePhone: { type: String },
    cellPhone: { type: String }
});

// Address Information Schema
const addressInfoSchema = new mongoose.Schema({
    addressLine1: { type: String },
    addressLine2: { type: String },
    city: { type: String },
    state: { type: String },
    zipCode: { type: String },
    mailingAddress: { type: String, default: 'same' }
});

// Employment Information Schema
const employmentInfoSchema = new mongoose.Schema({
    employmentTitle: { type: String, required: true },
    hireDate: { type: Date },
    terminationDate: { type: Date },
    rateOfPay: { type: Number, required: true },
    ssn: { type: String }
});

const loginInfoSchema = new mongoose.Schema({
    username: { type: String, required: true },
    password: { type: String, required: true }
});

// Main HCM Info Schema
const hcmInfoSchema = new mongoose.Schema({
    personalInfo: personalInfoSchema,
    contactInfo: contactInfoSchema,
    addressInfo: addressInfoSchema,
    employmentInfo: employmentInfoSchema,
    loginInfo: loginInfoSchema,
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company'
    }
}, { timestamps: true });

export default mongoose.model('hcmInfo', hcmInfoSchema);