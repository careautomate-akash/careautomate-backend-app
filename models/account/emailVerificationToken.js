import { Schema, model } from 'mongoose';

const emailVerificationTokenSchema = new Schema({
    email: { type: String, required: true },
    verificationCode: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: '10m' },
});

export default model('EmailVerificationToken', emailVerificationTokenSchema);