import mongoose from 'mongoose';

const batchClaimSchema = new mongoose.Schema({
    batchId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'company',
        required: true,
        index: true
    },
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers',
        required: true,
        index: true
    },
    hcmId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers',
        required: true,
        index: true
    },
    serviceType: {
        type: String,
        required: true,
        enum: ['T2024', 'H2015_U8', 'H2015_U8_TS', 'T2038'],
        index: true
    },
    dateRange: {
        startDate: {
            type: Date,
            required: true,
            index: true
        },
        endDate: {
            type: Date,
            required: true,
            index: true
        }
    },
    claims: [{
        claimId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Bill',
            required: true
        },
        visitIds: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'visits'
        }],
        totalAmount: {
            type: Number,
            default: 0
        },
        totalUnits: {
            type: Number,
            default: 0
        },
        status: {
            type: String,
            enum: ['pending', 'generated', 'submitted', 'processed', 'rejected'],
            default: 'pending'
        }
    }],
    ediGeneration: {
        status: {
            type: String,
            enum: ['pending', 'generating', 'completed', 'failed'],
            default: 'pending'
        },
        fileName: {
            type: String
        },
        filePath: {
            type: String
        },
        generatedAt: {
            type: Date
        },
        errorMessage: {
            type: String
        },
        fileSize: {
            type: Number
        }
    },
    batchStatus: {
        type: String,
        enum: ['draft', 'ready', 'submitted', 'processing', 'completed', 'cancelled'],
        default: 'draft',
        index: true
    },
    submissionMetadata: {
        submittedAt: {
            type: Date
        },
        submittedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'causers'
        },
        submissionMethod: {
            type: String,
            enum: ['manual', 'ftp', 'sftp', 'api']
        },
        confirmationNumber: {
            type: String
        }
    },
    filters: {
        originalStartDate: {
            type: Date
        },
        originalEndDate: {
            type: Date
        },
        selectedVisitStatuses: [{
            type: String
        }],
        includePendingVisits: {
            type: Boolean,
            default: false
        }
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Compound indexes for optimized queries
batchClaimSchema.index({ companyId: 1, batchStatus: 1, createdAt: -1 });
batchClaimSchema.index({ tenantId: 1, serviceType: 1, 'dateRange.startDate': 1, 'dateRange.endDate': 1 });
batchClaimSchema.index({ hcmId: 1, batchStatus: 1, createdAt: -1 });
batchClaimSchema.index({ 'ediGeneration.status': 1, createdAt: -1 });
batchClaimSchema.index({ 'claims.claimId': 1 });

// Pre-save middleware to update the updatedAt field
batchClaimSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

// Method to generate batch ID
batchClaimSchema.statics.generateBatchId = function (companyId, tenantId, serviceType) {
    const timestamp = Date.now();
    const shortCompanyId = companyId.toString().slice(-6);
    const shortTenantId = tenantId.toString().slice(-6);
    return `BATCH_${shortCompanyId}_${shortTenantId}_${serviceType}_${timestamp}`;
};

// Method to check if batch can be submitted
batchClaimSchema.methods.canBeSubmitted = function () {
    return this.batchStatus === 'ready' &&
        this.ediGeneration.status === 'completed' &&
        this.claims.length > 0;
};

// Method to calculate total batch amount
batchClaimSchema.methods.getTotalBatchAmount = function () {
    return this.claims.reduce((total, claim) => total + (claim.totalAmount || 0), 0);
};

// Method to calculate total batch units
batchClaimSchema.methods.getTotalBatchUnits = function () {
    return this.claims.reduce((total, claim) => total + (claim.totalUnits || 0), 0);
};

export default mongoose.model('BatchClaim', batchClaimSchema);