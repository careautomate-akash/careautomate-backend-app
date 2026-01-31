import mongoose from 'mongoose';
const securityDetailsSchema = new mongoose.Schema({
    passwordLastChanged: Date,
    loginNotifications: {
        type: Boolean,
        default: false
    },
    recentAccountActivity: {
        type: String,
        default: "No Suspicious Activity Detected"
    },
    password: String
});

const preferencesSchema = new mongoose.Schema({
    emailNotifications: {
        type: Boolean,
        default: true
    },
    language: {
        type: String,
        default: "English"
    }
});

const settingsSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers'
    },
    personalDetails: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers'
    },
    accountDetails: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'accountSetup'
    },
    securityDetails: securityDetailsSchema,
    preferences: preferencesSchema, companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'company' }
});

export default mongoose.model('Settings', settingsSchema);