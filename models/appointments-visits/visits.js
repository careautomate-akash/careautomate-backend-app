import mongoose from 'mongoose';
// Define the schema for Visits
const visitsSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'causers',
    },
    hcmId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'causers',
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'causers',
    },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'bills',
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'services',
      required: true,
    },
    activity: {
      type: String,
      trim: true,
      required: false,
    },
    date: {
      type: Date,
      required: true,
    },
    startTime: {
      type: Date,
      required: false,
    },
    endTime: {
      type: Date,
      required: false,
    },
    place: {
      type: String,
      trim: true,
    },
    methodOfContact: {
      type: String,
      enum: ['in-person', 'remote', 'indirect'],
    },
    reasonForRemote: {
      type: String,
      trim: true,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
    },
    travel: {
      type: String,
      enum: ['yes', 'no'],
    },
    totalMiles: {
      type: Number,
      default: 0,
    },
    travelWithTenant: {
      type: Number,
      default: 0,
    },
    travelWithoutTenant: {
      type: Number,
      default: 0,
    },
    signature: {
      type: String,
      enum: ['done', 'not done'],
      default: 'not done',
    },
    signedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'causers',
      default: null,
    },
    signedByName: {
      type: String,
      trim: true,
      default: null,
    },
    signatureTimestamp: {
      type: Date,
      default: null,
    },
    signatureType: {
      type: String,
      enum: ['electronic', 'image'],
      default: null,
    },
    signatureImageKey: {
      type: String,
      trim: true,
      default: null,
    },
    signatureImageUrl: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    response: {
      type: String,
    },
    reasonForRejection: {
      type: String,
      trim: true,
    },
    timeOfRejection: {
      type: Date,
      default: null,
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'causers',
      default: null,
    },
    timeOfApproval: {
      type: Date,
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'causers',
      default: null,
    },
    approvalNotes: {
      type: String,
      trim: true,
      default: null,
    },
    withdrawalReason: {
      type: String,
      trim: true,
      default: null,
    },
    withdrawnBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'causers',
      default: null,
    },
    timeOfWithdrawal: {
      type: Date,
      default: null,
    },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'company' },
    fromAppointment: {
      type: Boolean,
      default: false,
    },
    unitsRemaining: {
      type: Number,
      default: 0,
    },
    // Dynamic Claims System Status Tracking
    claimStatus: {
      type: String,
      enum: ['not_scheduled', 'scheduled', 'submitted', 'billed', 'cancelled'],
      default: 'not_scheduled',
    },
    scheduledDate: {
      type: Date,
      default: null,
    },
    scheduledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'causers',
      default: null,
    },
    submittedDate: {
      type: Date,
      default: null,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'causers',
      default: null,
    },
    billedDate: {
      type: Date,
      default: null,
    },
    billedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'causers',
      default: null,
    },
    cancelledDate: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'causers',
      default: null,
    },
    cancellationReason: {
      type: String,
      trim: true,
      default: null,
    },
    // EDI Generation Tracking
    ediGenerated: {
      type: Boolean,
      default: false,
    },
    ediGeneratedDate: {
      type: Date,
      default: null,
    },
    ediFileName: {
      type: String,
      trim: true,
      default: null,
    },
    ediContent: {
      type: String,
      default: null,
    },
    // Batch and Claim Tracking
    batchId: {
      type: String,
      trim: true,
      default: null,
    },
    claimId: {
      type: String,
      trim: true,
      default: null,
    },
    // Amount and Units for Claims
    claimAmount: {
      type: Number,
      default: 0,
    },
    claimUnits: {
      type: Number,
      default: 1,
    },
    clockInTime: {
      type: Date,
      default: null,
    },
    clockOutTime: {
      type: Date,
      default: null,
    },
    clockInAt: {
      type: String,
      default: '',
    },
  },

  {
    timestamps: true,
  },
);

visitsSchema.pre('save', async function (next) {
  try {
    // Remove static mapping, do not use getServiceTypeFromProcedureCode
    // Instead, serviceTypeName should be set from DB in controller (see createVisit)
    next();
  } catch (error) {
    console.error('Error in pre-save middleware:', error);
    next();
  }
});

visitsSchema.virtual('serviceTypeDisplayName').get(function () {
  return this.serviceTypeName || this.serviceType;
});

visitsSchema.index({ status: 1 });
visitsSchema.index({ _id: 1, status: 1 });
visitsSchema.index({ tenantId: 1, status: 1 });
visitsSchema.index({ hcmId: 1, status: 1 });
visitsSchema.index({ tenantId: 1, date: -1 });
visitsSchema.index({ hcmId: 1, date: -1 });
visitsSchema.index({ companyId: 1, status: 1 });
visitsSchema.index({ date: 1 });
visitsSchema.index({ serviceType: 1, status: 1 });
// Dynamic Claims System Indexes
visitsSchema.index({ claimStatus: 1 });
visitsSchema.index({ companyId: 1, claimStatus: 1 });
visitsSchema.index({ batchId: 1 });
visitsSchema.index({ claimId: 1 });
visitsSchema.index({ tenantId: 1, serviceType: 1, date: 1 });
visitsSchema.index({ companyId: 1, tenantId: 1, serviceType: 1, date: 1 });
visitsSchema.index({ ediGenerated: 1 });
visitsSchema.index({ scheduledDate: 1 });
visitsSchema.index({ submittedDate: 1 });

export default mongoose.model('visits', visitsSchema);

export const visitCompilance = async (req, res) => {
  try {
    const visits = await Visits.find({})
      .populate({
        path: 'tenantId',
        select: '_id name email',
        model: 'causers',
      })
      .populate({
        path: 'hcmId',
        select: '_id name email',
        model: 'causers',
      });

    const visitCounts = {};
    const visitDetails = {
      inPerson: [],
      direct: [],
      indirect: [],
      remote: [],
      unknown: [],
    };

    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    visits.forEach((visit) => {
      const visitDate = new Date(visit.date);
      if (isNaN(visitDate)) {
        console.error(`Invalid date for visit ID: ${visit._id}`);
        return;
      }

      const year = visitDate.getFullYear();
      const month = monthNames[visitDate.getMonth()];

      if (!visitCounts[year]) {
        visitCounts[year] = {};
      }
      if (!visitCounts[year][month]) {
        visitCounts[year][month] = {
          direct: 0,
          indirect: 0,
          remote: 0,
          inPerson: 0,
        };
      }

      let method = visit.methodOfContact || 'unknown';
      switch (method) {
        case 'in-person':
          visitCounts[year][month].inPerson++;
          visitDetails.inPerson.push(createVisitDetail(visit));
          break;
        case 'direct':
          visitCounts[year][month].direct++;
          visitDetails.direct.push(createVisitDetail(visit));
          break;
        case 'indirect':
          visitCounts[year][month].indirect++;
          visitDetails.indirect.push(createVisitDetail(visit));
          break;
        case 'remote':
          visitCounts[year][month].remote++;
          visitDetails.remote.push(createVisitDetail(visit));
          break;
        default:
          console.warn(`Unknown methodOfContact for visit ID: ${visit._id}`);
          visitDetails.unknown.push(createVisitDetail(visit));
          break;
      }
    });

    res.status(200).json({
      success: true,
      message: 'Visit compliance fetched successfully',
      response: {
        visitCounts,
        visitDetails,
        totalVisits: visits.length,
      },
    });
  } catch (error) {
    console.error('Error fetching visit data:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching visit compliance data.',
    });
  }
};

function createVisitDetail(visit) {
  return {
    visitId: visit._id,
    tenant: {
      tenantId: visit.tenantId ? visit.tenantId._id : 'Unknown Tenant ID',
      tenantName: visit.tenantId ? visit.tenantId.name : 'Unknown Tenant',
      tenantEmail: visit.tenantId ? visit.tenantId.email : 'Unknown Email',
    },
    hcm: {
      hcmId: visit.hcmId ? visit.hcmId._id : 'Unknown HCM ID',
      hcmName: visit.hcmId ? visit.hcmId.name : 'Unknown HCM',
      hcmEmail: visit.hcmId ? visit.hcmId.email : 'Unknown Email',
    },
    serviceType: visit.serviceType,
    dateOfService: visit.date.toISOString().split('T')[0],
    methodOfVisit: visit.methodOfContact || 'N/A',
  };
}
