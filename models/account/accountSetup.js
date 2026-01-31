import mongoose from 'mongoose';
// Assuming you have a users model defined somewhere
// const User = require('./path/to/userModel'); // Uncomment and adjust the path as necessary

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

const loginInfoSchema = new mongoose.Schema({
    username: String,
    password: String
});

const adminAccountSchema = new mongoose.Schema({
    firstName: String,
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
    }
});

const bankingInfoSchema = new mongoose.Schema({
    nameOnCard: String,
    cardNumber: String,
    expiryDate: String,
    billingAddress: addressSchema
});

const accountSetupSchema = new mongoose.Schema({
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers'
    },
    email: String,
    firstName: String,
    lastName: String,
    companyName: String,
    address: addressSchema,
    contact: contactSchema,
    federalTaxId: String,
    idnpiUmpi: String,
    taxonomy: String,
    mnitsLogin: loginInfoSchema,
    waystarLogin: loginInfoSchema,
    childAdminAccounts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'childAdminAccount' }],
    bankingInfo: bankingInfoSchema,
});

export default mongoose.model('accountSetup', accountSetupSchema);