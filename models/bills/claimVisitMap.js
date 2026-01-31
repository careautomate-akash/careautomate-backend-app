import mongoose from 'mongoose';

const claimVisitMapSchema = new mongoose.Schema({
    claimId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Bill',
        required: true
    },
    visitId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Visit',
        required: true
    },
    // Array of visit IDs for merged visits
    visitIds: [{
        type: String
    }],
    serviceDate: {
        type: Date,
        required: true
    },
    mergedUnits: {
        type: Number,
        default: 0
    },
    mergedAmount: {
        type: Number,
        default: 0
    },
    serviceType: {
        type: String,
        required: true
    },
    procedureCode: {
        type: String
    },
    modifiers: [{
        type: String
    }],
    ref6r: {
        type: String
    },
    // Detailed data for each visit in this mapping
    visitData: [{
        visitId: {
            type: String,
            required: true
        },
        tenantId: {
            type: String,
            required: true
        },
        hcmId: {
            type: String,
            required: true
        },
        serviceType: {
            type: String,
            required: true
        },
        units: {
            type: Number,
            default: 0
        },
        amount: {
            type: Number,
            default: 0
        },
        startTime: {
            type: Date
        },
        endTime: {
            type: Date
        }
    }],
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Create indexes for faster lookups
claimVisitMapSchema.index({ claimId: 1 });
claimVisitMapSchema.index({ visitId: 1 });
claimVisitMapSchema.index({ serviceDate: 1 });
claimVisitMapSchema.index({ claimId: 1, serviceDate: 1 });
claimVisitMapSchema.index({ visitIds: 1 });

export default mongoose.model('ClaimVisitMap', claimVisitMapSchema); 