import mongoose from 'mongoose';

const claimAuditLogSchema = new mongoose.Schema({
    auditId: {
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
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'causers',
        required: true,
        index: true
    },
    entityType: {
        type: String,
        required: true,
        enum: ['batch', 'claim_group', 'claim', 'visit', 'edi_file'],
        index: true
    },
    entityId: {
        type: String,
        required: true,
        index: true
    },
    action: {
        type: String,
        required: true,
        enum: [
            'created', 'updated', 'deleted', 'submitted', 'approved', 'rejected',
            'generated', 'validated', 'processed', 'cancelled', 'rescheduled',
            'visit_added', 'visit_removed', 'edi_generated', 'edi_failed',
            'batch_created', 'batch_submitted', 'filter_applied'
        ],
        index: true
    },
    description: {
        type: String,
        required: true
    },
    metadata: {
        // Previous state (for updates)
        previousState: {
            type: mongoose.Schema.Types.Mixed
        },
        // New state (for updates)
        newState: {
            type: mongoose.Schema.Types.Mixed
        },
        // Additional context
        context: {
            type: mongoose.Schema.Types.Mixed
        },
        // Filter data for batch operations
        filters: {
            startDate: { type: Date },
            endDate: { type: Date },
            tenantIds: [{ type: String }],
            hcmIds: [{ type: String }],
            serviceTypes: [{ type: String }],
            visitStatuses: [{ type: String }]
        },
        // Performance metrics
        performance: {
            executionTimeMs: { type: Number },
            recordsProcessed: { type: Number },
            recordsAffected: { type: Number }
        },
        // Error information
        error: {
            message: { type: String },
            code: { type: String },
            stack: { type: String }
        }
    },
    requestInfo: {
        ipAddress: {
            type: String
        },
        userAgent: {
            type: String
        },
        sessionId: {
            type: String
        },
        requestId: {
            type: String
        }
    },
    impact: {
        level: {
            type: String,
            enum: ['low', 'medium', 'high', 'critical'],
            default: 'low'
        },
        affectedEntities: [{
            entityType: { type: String },
            entityId: { type: String },
            changeType: { type: String }
        }],
        dataChanges: {
            recordsCreated: { type: Number, default: 0 },
            recordsUpdated: { type: Number, default: 0 },
            recordsDeleted: { type: Number, default: 0 }
        }
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    },
    timeZone: {
        type: String,
        default: 'UTC'
    }
});

// Compound indexes for efficient querying
claimAuditLogSchema.index({ companyId: 1, timestamp: -1 });
claimAuditLogSchema.index({ userId: 1, timestamp: -1 });
claimAuditLogSchema.index({ entityType: 1, entityId: 1, timestamp: -1 });
claimAuditLogSchema.index({ action: 1, timestamp: -1 });
claimAuditLogSchema.index({ 'impact.level': 1, timestamp: -1 });
claimAuditLogSchema.index({ timestamp: -1 }); // For general time-based queries

// TTL index to automatically remove old audit logs (optional - configurable retention)
claimAuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 31536000 }); // 1 year

// Static method to generate audit ID
claimAuditLogSchema.statics.generateAuditId = function () {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `AUDIT_${timestamp}_${random.toUpperCase()}`;
};

// Static method to log action
claimAuditLogSchema.statics.logAction = async function (actionData) {
    const auditLog = new this({
        auditId: this.generateAuditId(),
        ...actionData,
        timestamp: new Date()
    });

    try {
        await auditLog.save();
        return auditLog;
    } catch (error) {
        console.error('Failed to create audit log:', error);
        // Don't throw error to avoid breaking main operations
        return null;
    }
};

// Static method to log batch operation
claimAuditLogSchema.statics.logBatchOperation = async function (data) {
    return this.logAction({
        companyId: data.companyId,
        userId: data.userId,
        entityType: 'batch',
        entityId: data.batchId,
        action: data.action,
        description: data.description,
        metadata: {
            filters: data.filters,
            performance: data.performance,
            context: data.context
        },
        requestInfo: data.requestInfo,
        impact: data.impact
    });
};

// Static method to log claim group operation
claimAuditLogSchema.statics.logClaimGroupOperation = async function (data) {
    return this.logAction({
        companyId: data.companyId,
        userId: data.userId,
        entityType: 'claim_group',
        entityId: data.groupId,
        action: data.action,
        description: data.description,
        metadata: {
            previousState: data.previousState,
            newState: data.newState,
            context: data.context
        },
        requestInfo: data.requestInfo,
        impact: data.impact
    });
};

// Static method to log EDI operation
claimAuditLogSchema.statics.logEdiOperation = async function (data) {
    return this.logAction({
        companyId: data.companyId,
        userId: data.userId,
        entityType: 'edi_file',
        entityId: data.ediFileName,
        action: data.action,
        description: data.description,
        metadata: {
            context: {
                fileName: data.ediFileName,
                fileSize: data.fileSize,
                claimCount: data.claimCount,
                batchId: data.batchId
            },
            error: data.error,
            performance: data.performance
        },
        requestInfo: data.requestInfo,
        impact: data.impact
    });
};

// Method to get related audit logs
claimAuditLogSchema.methods.getRelatedLogs = function (limit = 50) {
    return this.constructor.find({
        $or: [
            { entityId: this.entityId },
            { 'metadata.context.batchId': this.entityId },
            { 'impact.affectedEntities.entityId': this.entityId }
        ]
    })
        .sort({ timestamp: -1 })
        .limit(limit);
};

// Virtual for formatted timestamp
claimAuditLogSchema.virtual('formattedTimestamp').get(function () {
    return this.timestamp.toISOString();
});

// Virtual for duration (if performance data exists)
claimAuditLogSchema.virtual('duration').get(function () {
    return this.metadata?.performance?.executionTimeMs ?
        `${this.metadata.performance.executionTimeMs}ms` : null;
});

export default mongoose.model('ClaimAuditLog', claimAuditLogSchema);