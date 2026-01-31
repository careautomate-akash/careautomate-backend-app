import mongoose from 'mongoose';

const movedOutTenantsSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true,
    },
    movedOutDate: {
        type: Date,
        required: true,
    },
    reason: {
        type: String,
        required: true,
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
    },
});

const MovedOutTenants = mongoose.model('MovedOutTenants', movedOutTenantsSchema);
