import mongoose from 'mongoose';

const claimGroupSchema = new mongoose.Schema({
    groupId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    batchId: {
        type: String,
        ref: 'BatchClaim',
        required: true,
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
    groupPeriod: {
        startDate: {
            type: Date,
            required: true,
            index: true
        },
        endDate: {
            type: Date,
            required: true,
            index: true
        },
        periodDays: {
            type: Number,
            default: 15,
            max: 15
        }
    },
    visits: [{
        visitId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'visits',
            required: true
        },
        serviceDate: {
            type: Date,
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
        status: {
            type: String,
            enum: ['included', 'excluded', 'pending_review'],
            default: 'included'
        },
        includedInClaim: {
            type: Boolean,
            default: true
        }
    }],
    aggregatedData: {
        totalVisits: {
            type: Number,
            default: 0
        },
        totalUnits: {
            type: Number,
            default: 0
        },
        totalAmount: {
            type: Number,
            default: 0
        },
        firstServiceDate: {
            type: Date
        },
        lastServiceDate: {
            type: Date
        },
        uniqueServiceDates: {
            type: Number,
            default: 0
        }
    },
    claimData: {
        claimId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Bill'
        },
        procedureCode: {
            type: String
        },
        modifiers: [{
            type: String
        }],
        diagnosisCode: {
            type: String
        },
        placeOfService: {
            type: String,
            default: '12' // Home
        }
    },
    groupStatus: {
        type: String,
        enum: ['draft', 'validated', 'claim_generated', 'submitted', 'processed'],
        default: 'draft',
        index: true
    },
    validationResults: {
        isValid: {
            type: Boolean,
            default: false
        },
        errors: [{
            type: String
        }],
        warnings: [{
            type: String
        }],
        validatedAt: {
            type: Date
        }
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

// Compound indexes for efficient querying
claimGroupSchema.index({ tenantId: 1, hcmId: 1, serviceType: 1, 'groupPeriod.startDate': 1 });
claimGroupSchema.index({ batchId: 1, groupStatus: 1 });
claimGroupSchema.index({ companyId: 1, groupStatus: 1, createdAt: -1 });
claimGroupSchema.index({ 'visits.visitId': 1 });
claimGroupSchema.index({ 'claimData.claimId': 1 });

// Pre-save middleware to update aggregated data and timestamps
claimGroupSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    this.calculateAggregatedData();
    next();
});

// Method to generate group ID
claimGroupSchema.statics.generateGroupId = function (tenantId, hcmId, serviceType, startDate) {
    const dateStr = startDate.toISOString().split('T')[0].replace(/-/g, '');
    const shortTenantId = tenantId.toString().slice(-4);
    const shortHcmId = hcmId.toString().slice(-4);
    return `GRP_${shortTenantId}_${shortHcmId}_${serviceType}_${dateStr}`;
};

// Method to calculate aggregated data
claimGroupSchema.methods.calculateAggregatedData = function () {
    const includedVisits = this.visits.filter(v => v.includedInClaim);

    this.aggregatedData.totalVisits = includedVisits.length;
    this.aggregatedData.totalUnits = includedVisits.reduce((sum, visit) => sum + (visit.units || 0), 0);
    this.aggregatedData.totalAmount = includedVisits.reduce((sum, visit) => sum + (visit.amount || 0), 0);

    if (includedVisits.length > 0) {
        const serviceDates = includedVisits.map(v => v.serviceDate).sort();
        this.aggregatedData.firstServiceDate = serviceDates[0];
        this.aggregatedData.lastServiceDate = serviceDates[serviceDates.length - 1];
        this.aggregatedData.uniqueServiceDates = new Set(serviceDates.map(d => d.toDateString())).size;
    }
};

// Method to validate group for claim generation
claimGroupSchema.methods.validateForClaim = function () {
    const errors = [];
    const warnings = [];

    // Check if there are visits
    if (this.visits.length === 0) {
        errors.push('No visits in group');
    }

    // Check if there are included visits
    const includedVisits = this.visits.filter(v => v.includedInClaim);
    if (includedVisits.length === 0) {
        errors.push('No visits included in claim');
    }

    // Check date range doesn't exceed 15 days
    const daysDiff = Math.ceil((this.groupPeriod.endDate - this.groupPeriod.startDate) / (1000 * 60 * 60 * 24));
    if (daysDiff > 15) {
        errors.push(`Group period exceeds 15 days (${daysDiff} days)`);
    }

    // Check for consistent service type
    const serviceTypes = new Set(this.visits.map(v => this.serviceType));
    if (serviceTypes.size > 1) {
        errors.push('Inconsistent service types in group');
    }

    // Check for minimum units based on service type
    if (this.aggregatedData.totalUnits === 0) {
        warnings.push('No units recorded for visits');
    }

    this.validationResults = {
        isValid: errors.length === 0,
        errors,
        warnings,
        validatedAt: new Date()
    };

    return this.validationResults;
};

// Method to check if visit can be added to group
claimGroupSchema.methods.canAddVisit = function (visitDate) {
    return visitDate >= this.groupPeriod.startDate && visitDate <= this.groupPeriod.endDate;
};

// Method to add visit to group
claimGroupSchema.methods.addVisit = function (visitData) {
    if (!this.canAddVisit(visitData.serviceDate)) {
        throw new Error('Visit date outside group period');
    }

    // Check if visit already exists
    const existingVisit = this.visits.find(v => v.visitId.toString() === visitData.visitId.toString());
    if (existingVisit) {
        return false; // Visit already in group
    }

    this.visits.push(visitData);
    this.calculateAggregatedData();
    return true;
};

export default mongoose.model('ClaimGroup', claimGroupSchema);