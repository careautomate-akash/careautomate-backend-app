import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    zipCode: String
});

const contactSchema = new mongoose.Schema({
    officePhoneNumber: String,
    cellPhoneNumber: String,
    primaryEmailAddress: String,
    alternateEmailAddress: String
});

const childAdminAccountSchema = new mongoose.Schema({
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers'
    },
    firstName: String,
    lastName: String,
    address: addressSchema,
    contact: contactSchema,
    username: String,
    password: String,
    permissions: {
        billing: Boolean,
        tenant: Boolean,
        hcm: Boolean,
        appointments: Boolean,
        visit: Boolean,
        communication: Boolean
    },
    dateCreated: {
        type: Date,
        default: Date.now
    },
    dateUpdated: {
        type: Date,
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    }
});
export default mongoose.model('childAdminAccount', childAdminAccountSchema);