import mongoose from 'mongoose';

const billingDoneSchema = new mongoose.Schema({
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

export default mongoose.model('BillingDone', billingDoneSchema);;