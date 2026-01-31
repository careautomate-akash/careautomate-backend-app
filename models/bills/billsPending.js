import mongoose from 'mongoose';

const billingPendingSchema = new mongoose.Schema({
    bill: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Bill'
    },
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'tenants'
    }
}, {
    timestamps: true,
});

export default mongoose.model('BillingPending', billingPendingSchema);