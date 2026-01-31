import mongoose from 'mongoose';

const hcmAssignedToTenantSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers',
        required: true,
    },
    hcmIds: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: 'causers',
        required: true,
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company'
    }
});

export default mongoose.model('hcmAssignedToTenant', hcmAssignedToTenantSchema);