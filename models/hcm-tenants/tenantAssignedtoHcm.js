import mongoose from 'mongoose';

const tenantAssignedToHcmSchema = new mongoose.Schema({
    hcmId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers',
        required: true,
    },
    tenantIds: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: 'causers',
        required: true,
    }, companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company'
    }
});

export default mongoose.model('tenantAssignedtoHcm', tenantAssignedToHcmSchema);