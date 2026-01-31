import Visits from '../../models/appointments-visits/visits.js';
import users from '../../models/account/users.js';
import ServiceTracking from '../../models/bills/serviceTracking.js';
import ClaimVisitMap from '../../models/bills/claimVisitMap.js';
import {
  getProcedureCodeFromServiceType,
  getServiceTypeFromProcedureCode,
  getProcedureCodeAndModifier,
} from '../../utils/procedureCodeMapper.js';
import {
  markVisitAsApproved,
  updateBillandEDI,
  removeBill,
} from './vistiBillController.js';
import hcmVisitHistory from '../../models/appointments-visits/hcmVisitHistory.js';
import mongoose from 'mongoose';
import appsDirectlyFromVisits from '../../models/appointments-visits/appsDirectlyFromVisits.js';
import Service from '../../models/services/services.js';
import Bills from '../../models/bills/bills.js';
import { sendVisitNotification } from '../../utils/pushnotifications.js';
import { formatDateAndTimeForNotificationWithTimezone } from '../../utils/notificationDateTimeFormat.js';
import { generateBill } from '../../tasks/billGeneration.js';
import { regenerateBatchEDI } from '../../tasks/billGeneration.js';
import company from '../../models/account/company.js';
import { s3Client } from '../../utils/s3.js';
import { GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  getProcedureAndTypeFromServiceName,
  getProcedureCodeAndModifierFromDB,
} from '../services/serviceController.js';
import Appointments from '../../models/appointments-visits/appointments.js';

export const fetchVisits = async (req, res) => {
  try {
    const { companyId } = req.params;

    const visitsRecords = await Visits.find({ companyId })
      .populate({
        path: 'creatorId',
        select: 'name email role',
        model: 'users',
      })
      .populate({
        path: 'hcmId',
        select: 'name email phoneNo',
        model: 'users',
      })
      .populate({
        path: 'tenantId',
        select: 'name email phoneNo',
        model: 'users',
      })
      .populate({
        path: 'serviceId',
        select: 'service_procedure_code service_name',
        model: 'Service',
      })
      .sort({ dateOfService: 1, startTime: 1 });

    const formattedVisits = visitsRecords.map((visit) => ({
      ...visit.toObject(),
      creatorDetails: visit.creatorId,
      hcmDetails: visit.hcmId,
      tenantDetails: visit.tenantId,
      serviceType: visit.serviceId?.service_procedure_code || null,
      serviceTypeName: visit.serviceId?.service_name || null,
    }));

    res.status(200).json({
      success: true,
      message: 'All visits fetched successfully',
      response: formattedVisits,
    });
  } catch (error) {
    console.error('Error in fetchVisits:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const markVisitApproved = async (req, res) => {
  const { visitId } = req.body;
  const result = await markVisitAsApproved(visitId);

  visitStartTime = new Date(startTime);
  visitEndTime = new Date(endTime);
  durationInMinutes = (visitEndTime - visitStartTime) / 60000;
  const serviceUnits = durationInMinutes / 15;
  const workedHours = durationInMinutes / 60;

  await hcmVisitHistory.create({
    hcmId: visit.hcmId,
    visitId: visit._id,
    tenantId: visit.tenantId,
    serviceId: visit.serviceId,
    serviceUnits: serviceUnits,
    workedHours: workedHours,
    status: 'approved',
  });

  if (result.success) {
    res
      .status(200)
      .json({ success: true, message: 'Visit approved successfully' });
  } else {
    res.status(400).json({ success: false, message: result.message });
  }
};

export const createVisit = async (req, res) => {
  try {
    let {
      tenantId,
      hcmId,
      serviceType: reqServiceType,
      activity,
      date,
      startTime,
      endTime,
      place,
      methodOfContact,
      reasonForRemote,
      notes,
      travel,
      totalMiles,
      travelWithTenant,
      travelWithoutTenant,
      status,
      signature,
      signedBy,
      signedByName,
      signatureTimestamp,
      signatureType,
      response,
      companyId,
      fromAppointment,
      creatorId,
      reasonForRejection,
      serviceId,
      appointmentId,
      clockOutTime,
      clockOutAt,
    } = req.body;

    let serviceType = reqServiceType;
    const query = {
      $or: [
        { service_procedure_code: reqServiceType },
        { _id: new mongoose.Types.ObjectId(serviceId) },
      ],
    };
    const findServiceDetails = await Service.findOne(query);

    if (!findServiceDetails) {
      return res.status(400).json({
        success: false,
        message: serviceType
          ? `Service with procedure code "${serviceType}" not found in company catalog.`
          : `Service with ID "${serviceId}" not found in company catalog.`,
      });
    }

    // Extract variables
    let serviceTypeName = findServiceDetails.service_name;
    let procedureCodeId = findServiceDetails.service_procedure_code;
    const serviceDuration = findServiceDetails.service_duration;

    // ✅ Use found procedure code if serviceType not provided
    if (!serviceType) {
      serviceType = procedureCodeId;
    }

    if (!tenantId || !hcmId || !date || !serviceType) {
      return res.status(400).json({
        success: false,
        message: 'tenantId, hcmId, date, and serviceType are required fields',
      });
    }

    if (
      procedureCodeId !== 'T2038' &&
      procedureCodeId !== 'T2024' &&
      (!startTime || !endTime)
    ) {
      return res.status(400).json({
        success: false,
        message: 'startTime and endTime are required for this service type',
      });
    }

    const creator = await users.findById(creatorId);
    if (!creator) {
      return res.status(404).json({
        success: false,
        message: 'Creator not found',
      });
    }

    let visitStatus = 'pending';
    if (creator.role === 2 && notes && response) {
      visitStatus = 'approved';
    } else if (creator.role === 0) {
      return res.status(403).json({
        success: false,
        message: 'Tenants cannot create visits',
      });
    }

    let visitDate = null;
    if (date) {
      try {
        const dateParts = date.split('T')[0].split('-');
        const year = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1;
        const day = parseInt(dateParts[2], 10);

        visitDate = new Date(Date.UTC(year, month, day));
      } catch (error) {
        console.error('Error parsing visit date:', error);
        visitDate = new Date(date);
      }
    }

    let visitStartTime = null;
    let visitEndTime = null;
    let durationInMinutes = 0;
    let unitsUsed = 0;

    if (!startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'startTime and endTime are required for this service type',
      });
    }

    let tempVisitStartTime;
    let tempVisitEndTime;

    try {
      tempVisitStartTime = new Date(startTime);
      tempVisitEndTime = new Date(endTime);
      // Derive visit date from start time (UTC-safe)
      const visitDate = new Date(
        Date.UTC(
          tempVisitStartTime.getUTCFullYear(),
          tempVisitStartTime.getUTCMonth(),
          tempVisitStartTime.getUTCDate(),
        ),
      );
      visitStartTime = tempVisitStartTime;
      visitEndTime = tempVisitEndTime;

      if (
        isNaN(tempVisitStartTime.getTime()) ||
        isNaN(tempVisitEndTime.getTime())
      ) {
        throw new Error('Invalid date');
      }
    } catch (error) {
      console.error('Error parsing visit times:', error);
      return res.status(400).json({
        success: false,
        message: 'Invalid startTime or endTime format',
      });
    }

    // ✅ Correct comparison (UTC-safe)
    if (tempVisitStartTime >= tempVisitEndTime) {
      return res.status(400).json({
        success: false,
        message: 'End time must be after start time.',
      });
    }

    const overlappingVisit = await Visits.findOne({
      $or: [
        { tenantId: new mongoose.Types.ObjectId(tenantId) },
        { hcmId: new mongoose.Types.ObjectId(hcmId) },
      ],
      status: { $nin: ['rejected', 'cancelled'] },
      startTime: { $lt: visitEndTime },
      endTime: { $gt: visitStartTime },
    });

    if (overlappingVisit) {
      return res.status(400).json({
        success: false,
        message: 'A visit already exists in the selected timeslot.',
      });
    }

    durationInMinutes = (visitEndTime - visitStartTime) / 60000;
    const serviceDoc = await Service.findOne({
      $or: [
        {
          service_name: serviceTypeName,
          _id: new mongoose.Types.ObjectId(serviceId),
        },
        {
          service_procedure_code: serviceType,
          _id: new mongoose.Types.ObjectId(serviceId),
        },
      ],
    });
    // DAILY vs 15-MINUTE UNIT LOGIC
    if (serviceDuration === 'Daily') {
      // Use the visit's calendar day in UTC
      const startOfDay = new Date(
        Date.UTC(
          visitDate.getUTCFullYear(),
          visitDate.getUTCMonth(),
          visitDate.getUTCDate(),
        ),
      );
      const endOfDay = new Date(startOfDay);
      endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

      const existingVisitCount = await Visits.countDocuments({
        tenantId: new mongoose.Types.ObjectId(tenantId),
        serviceId: serviceDoc._id,

        date: {
          $gte: startOfDay,
          $lt: endOfDay,
        },
      });
      // First visit of the day → 1 unit, others → 0
      unitsUsed = existingVisitCount > 0 ? 0 : 1;
    } else {
      // Normal 15-min logic
      unitsUsed = Math.ceil(durationInMinutes / 15);
    }

    if (!serviceDoc) {
      return res.status(400).json({
        success: false,
        message: `Service with name or code "${serviceType}" not found in company catalog.`,
      });
    }
    const service = await ServiceTracking.findOne({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      serviceId: serviceDoc._id,
    });

    if (service && unitsUsed > service.unitsRemaining) {
      return res.status(400).json({
        success: false,
        message: `Insufficient units remaining. Available: ${service.unitsRemaining}, Required: ${unitsUsed}`,
      });
    }

    // Handle signature image upload if provided
    let signatureImageKey = null;
    let signatureImageUrl = null;

    if (req.fileData && req.fileData.key) {
      signatureImageKey = req.fileData.key;
      signatureImageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${signatureImageKey}`;
    }

    const visitData = {
      creatorId: new mongoose.Types.ObjectId(creatorId),
      hcmId: new mongoose.Types.ObjectId(hcmId),
      tenantId: new mongoose.Types.ObjectId(tenantId),
      date: visitStartTime,
      startTime: visitStartTime,
      endTime: visitEndTime,
      activity: activity || '',
      methodOfContact: methodOfContact,
      reasonForRemote: reasonForRemote || '',
      place: place || 'Office',
      serviceId: new mongoose.Types.ObjectId(serviceDoc._id),
      totalMiles: totalMiles || 0,
      travelWithTenant: travelWithTenant || 0,
      travelWithoutTenant: travelWithoutTenant || 0,
      signature: signature && signature !== 'pending' ? signature : 'not done',
      signedBy:
        signature && signature !== 'pending' && signedBy
          ? new mongoose.Types.ObjectId(signedBy)
          : null,
      signedByName: signature && signature !== 'pending' ? signedByName : null,
      signatureTimestamp:
        signature && signature !== 'pending' && signatureTimestamp
          ? new Date(signatureTimestamp)
          : null,
      signatureType:
        signature && signature !== 'pending'
          ? signatureType || 'electronic'
          : null,
      signatureImageKey: signatureImageKey,
      signatureImageUrl: signatureImageUrl,
      response: response || '',
      status: visitStatus,
      travel: travel || 'no',
      notes: notes || '',
      reasonForRejection: reasonForRejection || '',
      companyId,
      fromAppointment: fromAppointment || false,
      unitsRemaining: service.unitsRemaining - unitsUsed,
    };

    const newVisit = new Visits(visitData);
    const visit = await newVisit.save();
    if (appointmentId && clockOutTime) {
      try {
        const updatePayload = {
          clockOutTime: new Date(clockOutTime),
          clockOutAt: clockOutAt || '',
        };

        await Appointments.findByIdAndUpdate(
          appointmentId,
          { $set: updatePayload },
          { new: true },
        );
      } catch (err) {
        console.error(
          '[createVisit] Failed to update appointment clockOutTime:',
          err,
        );
        // ❗Do not throw — visit creation should succeed even if appointment update fails
      }
    }
    // Send notifications based on who created the visit
    if (creatorId == hcmId) {
      // HCM created the visit - send notification to admin
      // HCM-Name - Visit Submission
      // HCM_Name submitted a visit with Tenant_Name for June 25, 2025 at 11:00 AM. Ready for Review
      const companyDetails = await company.findById(companyId);
      const adminId = companyDetails?.adminId;

      const adminDetails = await users.findById(adminId);
      const timezone = adminDetails?.timezone || 'UTC';

      const dateAndTime = formatDateAndTimeForNotificationWithTimezone(
        visit.date,
        visit.startTime,
        timezone,
      );
      const tenantData = await users.findById(tenantId);
      const hcmData = await users.findById(hcmId);

      await sendVisitNotification(
        adminId,
        `${hcmData.name} - Visit Submission`,
        `${hcmData.name} submitted a visit with ${tenantData.name} for ${dateAndTime}. Ready for Review`,
        adminId,
        `${hcmData.name} - Visit Submission`,
        `${hcmData.name} submitted a visit with ${tenantData.name} for ${dateAndTime}. Ready for Review`,
        {
          visitId: visit._id.toString(),
          type: 'visit',
        },
      );
    } else {
      // Admin created the visit - send notification to HCM
      // A visit with Tenant_Name has been created for June 25, 2025 at 11:00 AM.
      const hcmDetails = await users.findById(hcmId);
      const timezone = hcmDetails?.timezone || 'UTC';

      const dateAndTime = formatDateAndTimeForNotificationWithTimezone(
        visit.date,
        visit.startTime,
        timezone,
      );

      const tenantData = await users.findById(tenantId);

      await sendVisitNotification(
        hcmId,
        'Visit Created',
        `A visit with ${tenantData.name} has been created for ${dateAndTime}.`,
        {
          visitId: visit._id.toString(),
          type: 'visit',
        },
      );
    }

    if (!fromAppointment) {
      const appsDirectlyFromVisitsRecord = new appsDirectlyFromVisits({
        visitId: visit._id,
        tenantId: visit.tenantId,
        hcmId: visit.hcmId,
        date: visit?.date,
        startTime: visit?.startTime,
        endTime: visit?.endTime,
        serviceId: visit?.serviceId,
        activity: visit?.activity,
        methodOfContact: visit?.methodOfContact,
        reasonForRemote: visit?.reasonForRemote,
        placeOfService: visit?.place,
        signature: visit?.signature,
        status: 'completed',
        companyId,
        billId: null,
      });

      await appsDirectlyFromVisitsRecord.save();
    }

    if (service && service.hcms) {
      const hcmEntry = service.hcms.find(
        (hcm) =>
          hcm.hcmId && hcm.hcmId.toString() === newVisit.hcmId.toString(),
      );

      const isHcmAutoApproved =
        creator?.role === 1 && visit.status === 'approved';

      if (!isHcmAutoApproved) {
        // Only do this for non-auto-approved visits (e.g., admin-created pending ones)
        const isWorked =
          creator?.role === 2 && newVisit.notes && newVisit.response;

        if (isWorked) {
          // treat as worked
          if (hcmEntry) {
            hcmEntry.billAmount += unitsUsed * service.billRate;
            hcmEntry.serviceDetails.push({
              dateOfService: newVisit.date,
              workedUnits: unitsUsed,
              billAmount: unitsUsed * service.billRate,
            });
            hcmEntry.workedUnits += unitsUsed;
          } else {
            service.hcms.push({
              hcmId: newVisit.hcmId,
              serviceDetails: [
                {
                  dateOfService: newVisit.date,
                  workedUnits: unitsUsed,
                  billAmount: unitsUsed * service.billRate,
                },
              ],
              workedUnits: unitsUsed,
              billAmount: unitsUsed * service.billRate,
            });
          }

          service.workedUnits += unitsUsed;
          service.unitsRemaining -= unitsUsed;
        } else {
          // treat as scheduled
          service.scheduledUnits = (service.scheduledUnits || 0) + unitsUsed;
          service.unitsRemaining -= unitsUsed;
        }

        await service.save();
      } else {
      }
    }

    if (creator.role === 2 && visit.status === 'approved') {
      const result = await markVisitAsApproved(newVisit._id);
      const historyServiceUnits =
        serviceDuration === 'Daily' ? unitsUsed : durationInMinutes / 15;
      const workedHours = durationInMinutes / 60;
      await hcmVisitHistory.create({
        hcmId: visit.hcmId,
        visitId: visit._id,
        tenantId: visit.tenantId,
        serviceId: visit.serviceId,
        serviceDate: visit.date,
        serviceUnits: historyServiceUnits,
        workedHours: workedHours,
        status: 'approved',
      });

      // Create claim-visit mapping when admin creates visit and bill is generated
      if (result.success && result.billId) {
        // Get procedure code information for the mapping
        const procedureCodeInfo = await getProcedureCodeAndModifierFromDB(
          procedureCodeId,
          visit.methodOfContact,
        );

        const mappingResult = await createClaimVisitMapping(
          newVisit._id,
          result.billId,
          visit,
          procedureCodeInfo,
        );

        if (mappingResult.success) {
        } else {
          console.error(
            '[BACKEND] Failed to create claim-visit mapping:',
            mappingResult.error,
          );
        }
      }

      if (result.success) {
        const remainingUnits = service.unitsRemaining;
        const lowUnitThreshold = 20;

        const responseData = {
          success: true,
          message:
            'Visit created, approved, and claim mapping generated successfully',
          billId: result.billId,
          mappingCreated: result.billId ? true : false,
        };
        if (remainingUnits <= lowUnitThreshold) {
          responseData.unitsRemaining = remainingUnits;
          responseData.warning = `Only ${remainingUnits} units remaining for this tenant's service.`;
        }

        return res.status(200).json(responseData);
      } else {
        return res.status(200).json({
          success: false,
          message: result.message,
        });
      }
    }

    const historyServiceUnits =
      serviceDuration === 'Daily' ? unitsUsed : durationInMinutes / 15;
    const workedHours = durationInMinutes / 60;

    await hcmVisitHistory.create({
      hcmId: visit.hcmId,
      visitId: visit._id,
      tenantId: visit.tenantId,
      serviceId: visit.serviceId,
      serviceDate: visit.date,
      serviceUnits: historyServiceUnits,
      workedHours: workedHours,
    });

    const remainingUnits = service.unitsRemaining;
    const lowUnitThreshold = 20;

    const responseData = {
      success: true,
      message: 'Visit created successfully',
    };

    if (remainingUnits <= lowUnitThreshold) {
      responseData.unitsRemaining = remainingUnits;
      responseData.warning = `Only ${remainingUnits} units remaining for this tenant's service.`;
    }

    return res.status(200).json(responseData);
  } catch (error) {
    console.error('Error creating visit:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error',
      error: error.message,
    });
  }
};

export const getVisits = async (req, res) => {
  const { companyId } = req.params;
  try {
    const visits = await Visits.find({ companyId })
      .populate({
        path: 'creatorId',
        select: 'name email role',
        model: 'causers',
      })
      .populate({
        path: 'hcmId',
        select: 'name email phoneNo',
        model: 'causers',
      })
      .populate({
        path: 'tenantId',
        select: 'name email phoneNo',
        model: 'causers',
      })
      .populate({
        path: 'signedBy',
        select: 'name email',
        model: 'causers',
      })
      .populate({
        path: 'serviceId',
        select: 'service_name service_procedure_code',
        model: 'Service',
      });
    // console.log(`[BACKEND] Fetched ${visits} visits for company: ${companyId}`);

    const tenantIds = [...new Set(visits.map((v) => v.tenantId?._id))];

    const servicesTracking = await ServiceTracking.find({
      tenantId: { $in: tenantIds },
    }).select('tenantId serviceId unitsRemaining');

    const visitsWithServices = visits.map((visit) => {
      const v = visit.toObject();

      v.serviceType = visit.serviceId?.service_procedure_code || null;
      v.serviceTypeName = visit.serviceId?.service_name || null;

      const tracking = servicesTracking.find(
        (s) =>
          s.tenantId?.toString() === visit.tenantId?._id?.toString() &&
          s.serviceId?.toString() === v.serviceId?._id?.toString(),
      );

      if (!tracking) {
      }

      v.unitsRemaining = tracking ? tracking.unitsRemaining : null;
      return v;
    });

    res.status(200).json({
      success: true,
      message: 'Visits fetched successfully',
      response: {
        visits: visitsWithServices,
      },
    });
  } catch (error) {
    console.error('❌ Error in getVisits:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

export const getVisitSignatureImage = async (req, res) => {
  try {
    const { visitId } = req.params;

    if (!visitId) {
      return res.status(400).json({
        success: false,
        message: 'visitId is required',
      });
    }
    // Get the visit to find the signature image key
    const visit = await Visits.findById(visitId);

    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found',
      });
    }

    if (!visit.signatureImageKey) {
      return res.status(404).json({
        success: false,
        message: 'No signature image found for this visit',
      });
    }
    // Check if the file actually exists in S3
    try {
      const exists = await checkFileExists(visit.signatureImageKey);
      if (!exists) {
        return res.status(404).json({
          success: false,
          message: 'Signature image file not found in storage',
        });
      }
    } catch (checkError) {
      console.error('Error checking if signature image exists:', checkError);
      return res.status(500).json({
        success: false,
        message: 'Error checking signature image availability',
      });
    }

    // With public bucket, we can return the direct URL
    const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${visit.signatureImageKey}`;
    return res.status(200).json({
      success: true,
      imageUrl,
      signatureType: visit.signatureType || 'image',
      signedBy: visit.signedByName,
      signatureTimestamp: visit.signatureTimestamp,
    });
  } catch (error) {
    console.error('Error getting visit signature image:', error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving signature image',
      error: error.message,
    });
  }
};

// Helper function to check if file exists in S3
const checkFileExists = async (key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    });
    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      return false;
    }
    throw error;
  }
};

const deleteFileFromS3 = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    });
    await s3Client.send(command);
  } catch (error) {
    console.error(`[BACKEND] Error deleting file from S3: ${key}`, error);
    throw error;
  }
};

export const updateVisit = async (req, res) => {
  try {
    const { id: visitId } = req.params;

    let updateData;
    try {
      updateData =
        typeof req.body.updateData === 'string'
          ? JSON.parse(req.body.updateData)
          : req.body.updateData || req.body;
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'Invalid updateData format',
      });
    }

    const { companyId } = req.body;

    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(visitId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid visit ID format',
      });
    }

    // Find the visit
    const visit = await Visits.findById(visitId);
    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found',
      });
    }
    const getStartEndOfDayUTC = (dateObj) => {
      const d = new Date(dateObj);
      const start = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
      );
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      return { start, end };
    };

    const upsertHcmEntry = (serviceTracking, hcmId) => {
      let entry = serviceTracking.hcms?.find(
        (h) => h.hcmId.toString() === hcmId.toString(),
      );

      if (!entry) {
        entry = {
          hcmId,
          scheduledUnits: 0,
          workedUnits: 0,
          billAmount: 0,
          scheduledDetails: [],
          serviceDetails: [],
        };

        if (!serviceTracking.hcms) serviceTracking.hcms = [];
        serviceTracking.hcms.push(entry);
      }

      return entry;
    };

    const clampNonNegative = (num) => Math.max(0, num || 0);

    const recalcRemaining = (st) => {
      const total = st.totalUnits || 0;
      const scheduled = st.scheduledUnits || 0;
      const worked = st.workedUnits || 0;
      st.unitsRemaining = total - scheduled - worked;
      if (st.unitsRemaining < 0) st.unitsRemaining = 0;
    };

    const serviceDoc = await Service.findById(visit.serviceId);
    const serviceDuration = serviceDoc?.service_duration || null;
    const isDailyService = serviceDuration === 'Daily';

    const originalData = {
      tenantId: visit.tenantId,
      hcmId: visit.hcmId,
      serviceId: visit.serviceId,
      date: visit.date,
      startTime: visit.startTime,
      endTime: visit.endTime,
      methodOfContact: visit.methodOfContact,
      status: visit.status,
    };

    // Calculate original units
    let originalUnits = 0;
    if (originalData.startTime && originalData.endTime) {
      const originalDurationInMinutes =
        (new Date(originalData.endTime) - new Date(originalData.startTime)) /
        (1000 * 60);
      originalUnits = Math.ceil(originalDurationInMinutes / 15);
    }

    // Handle signature image upload if provided
    if (req.fileData && req.fileData.key) {
      // If there's an existing signature image, optionally delete it
      if (visit.signatureImageKey) {
        try {
          await deleteFileFromS3(visit.signatureImageKey);
        } catch (deleteError) {
          console.error(
            '[BACKEND] Error deleting old signature image:',
            deleteError,
          );
          // Continue with update even if deletion fails
        }
      }

      visit.signatureImageKey = req.fileData.key;
      visit.signatureImageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${req.fileData.key}`;
      visit.signatureType = 'image';
    }

    // Process each field in the update data
    // ...existing code...
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] !== undefined && updateData[key] !== null) {
        if (key === 'date') {
          // Parse date as UTC
          const dateValue = updateData[key];
          visit[key] = new Date(dateValue);
        } else if (key === 'startTime' || key === 'endTime') {
          // Parse time as UTC
          const timeValue = updateData[key];
          if (timeValue) {
            visit[key] = new Date(timeValue);
          }
        } else if (key === 'signatureTimestamp') {
          // Parse signature timestamp
          visit[key] = updateData[key] ? new Date(updateData[key]) : null;
        } else if (key === 'signedBy') {
          // Handle signedBy ObjectId
          visit[key] = updateData[key]
            ? new mongoose.Types.ObjectId(updateData[key])
            : null;
        } else if (key === 'hcmId') {
          // Ensure hcmId is a valid ObjectId
          if (mongoose.Types.ObjectId.isValid(updateData[key])) {
            visit[key] = new mongoose.Types.ObjectId(updateData[key]);
          } else {
            console.warn(
              `[BACKEND] Skipping update for hcmId: not a valid ObjectId (${updateData[key]})`,
            );
          }
        } else if (
          ['signatureImageUrl', 'signatureImageKey', 'signatureType'].includes(
            key,
          ) &&
          req.fileData?.key
        ) {
        } else {
          visit[key] = updateData[key];
        }
      }
    });
    // ...existing code...

    // Calculate new units
    let newUnits = 0;
    if (visit.startTime && visit.endTime) {
      const newDurationInMinutes =
        (new Date(visit.endTime) - new Date(visit.startTime)) / (1000 * 60);
      newUnits = Math.ceil(newDurationInMinutes / 15);

      if (newDurationInMinutes <= 0) {
        return res.status(400).json({
          success: false,
          message: 'End time must be after start time',
        });
      }
    }
    const overlappingVisit = await Visits.findOne({
      _id: { $ne: visit._id }, // exclude current visit
      status: { $nin: ['rejected', 'cancelled'] },
      $or: [{ tenantId: visit.tenantId }, { hcmId: visit.hcmId }],
      startTime: { $lt: visit.endTime },
      endTime: { $gt: visit.startTime },
    });

    if (overlappingVisit) {
      return res.status(400).json({
        success: false,
        message: 'Another visit already exists in the selected timeslot.',
      });
    }

    const unitsDifference = newUnits - originalUnits; // can be +ve, -ve or 0

    if (
      !isDailyService &&
      unitsDifference !== 0 &&
      originalData.status === visit.status
    ) {
      const serviceTracking = await ServiceTracking.findOne({
        tenantId: visit.tenantId,
        serviceId: visit.serviceId,
      });

      if (!serviceTracking) {
        console.warn(
          '[BACKEND] No ServiceTracking found for tenant/service; skipping unit update',
        );
      } else {
        const isPending = visit.status === 'pending';
        const isApproved = visit.status === 'approved';

        if (isPending || isApproved) {
          const total = serviceTracking.totalUnits || 0;
          const scheduled = serviceTracking.scheduledUnits || 0;
          const worked = serviceTracking.workedUnits || 0;

          // Increasing units → check remaining capacity
          if (unitsDifference > 0) {
            const remaining = total - scheduled - worked;
            if (remaining < unitsDifference) {
              return res.status(400).json({
                success: false,
                message: 'Insufficient units to extend this visit',
              });
            }
          }

          // ✅ Update global units
          if (isPending) {
            serviceTracking.scheduledUnits = clampNonNegative(
              scheduled + unitsDifference,
            );
          } else if (isApproved) {
            serviceTracking.workedUnits = clampNonNegative(
              worked + unitsDifference,
            );
          }

          // ✅ Update HCM-level units too (this was missing)
          const hcmEntry = upsertHcmEntry(serviceTracking, visit.hcmId);

          if (isPending) {
            hcmEntry.scheduledUnits = clampNonNegative(
              hcmEntry.scheduledUnits + unitsDifference,
            );
          } else if (isApproved) {
            hcmEntry.workedUnits = clampNonNegative(
              hcmEntry.workedUnits + unitsDifference,
            );
          }

          recalcRemaining(serviceTracking);
          await serviceTracking.save();
        }
      }
    }

    // Save the updated visit
    await visit.save();
    // ✅ DAILY SERVICE: handle date change even if status didn't change
    if (isDailyService && originalData.status === visit.status) {
      const oldDateStr = new Date(originalData.date)
        .toISOString()
        .split('T')[0];
      const newDateStr = new Date(visit.date).toISOString().split('T')[0];

      const hcmChanged =
        originalData.hcmId.toString() !== visit.hcmId.toString();
      const dateChanged = oldDateStr !== newDateStr;

      // only act if date OR hcm changed (because daily unit is tied to day + who owns it)
      if (dateChanged || hcmChanged) {
        const serviceTracking = await ServiceTracking.findOne({
          tenantId: visit.tenantId,
          serviceId: visit.serviceId,
        });

        if (serviceTracking) {
          const oldHcmEntry = upsertHcmEntry(
            serviceTracking,
            originalData.hcmId,
          );
          const newHcmEntry = upsertHcmEntry(serviceTracking, visit.hcmId);

          const { start: oldStart, end: oldEnd } = getStartEndOfDayUTC(
            originalData.date,
          );
          const { start: newStart, end: newEnd } = getStartEndOfDayUTC(
            visit.date,
          );

          // ✅ Count NON-REJECTED visits on old day (excluding this visit)
          const oldNonRejectedCountAfter = await Visits.countDocuments({
            _id: { $ne: visit._id },
            tenantId: visit.tenantId,
            serviceId: visit.serviceId,
            date: { $gte: oldStart, $lt: oldEnd },
            status: { $ne: 'rejected' }, // ✅ rejected ignored
          });

          // ✅ Count NON-REJECTED visits on new day (including this one, since visit.date is already updated)
          const newNonRejectedCountAfter = await Visits.countDocuments({
            tenantId: visit.tenantId,
            serviceId: visit.serviceId,
            date: { $gte: newStart, $lt: newEnd },
            status: { $ne: 'rejected' }, // ✅ rejected ignored
          });

          // if old day becomes empty => remove 1 scheduled/worked depending on current status
          if (oldNonRejectedCountAfter === 0) {
            if (visit.status === 'pending') {
              serviceTracking.scheduledUnits = clampNonNegative(
                serviceTracking.scheduledUnits - 1,
              );
              oldHcmEntry.scheduledUnits = clampNonNegative(
                oldHcmEntry.scheduledUnits - 1,
              );
            }
            if (visit.status === 'approved') {
              serviceTracking.workedUnits = clampNonNegative(
                serviceTracking.workedUnits - 1,
              );
              oldHcmEntry.workedUnits = clampNonNegative(
                oldHcmEntry.workedUnits - 1,
              );
            }
          }

          // if new day has exactly 1 non-rejected visit => this visit is first => add 1 unit
          if (newNonRejectedCountAfter === 1) {
            if (visit.status === 'pending') {
              serviceTracking.scheduledUnits = clampNonNegative(
                serviceTracking.scheduledUnits + 1,
              );
              newHcmEntry.scheduledUnits = clampNonNegative(
                newHcmEntry.scheduledUnits + 1,
              );
            }
            if (visit.status === 'approved') {
              serviceTracking.workedUnits = clampNonNegative(
                serviceTracking.workedUnits + 1,
              );
              newHcmEntry.workedUnits = clampNonNegative(
                newHcmEntry.workedUnits + 1,
              );
            }
          }

          recalcRemaining(serviceTracking);
          await serviceTracking.save();
        }
      }
    }

    // Find and update any associated claim-visit mapping and bills
    try {
      const claimMapping = await ClaimVisitMap.findOne({ visitId: visitId });

      if (claimMapping) {
        // Check if this is part of a merged visit group or single visit
        if (claimMapping.visitIds && claimMapping.visitIds.length > 1) {
          // Recalculate merged totals instead of incrementing
          const service = await ServiceTracking.findOne({
            tenantId: visit.tenantId,
            serviceId: visit.serviceId,
          });

          // Update visitData entry
          const visitDataIndex = claimMapping.visitData.findIndex(
            (data) => data.visitId === visitId.toString(),
          );
          if (visitDataIndex !== -1) {
            claimMapping.visitData[visitDataIndex].units = newUnits;
            claimMapping.visitData[visitDataIndex].amount = service
              ? newUnits * service.billRate
              : 0;
          }

          // Recompute final merged totals
          claimMapping.mergedUnits = claimMapping.visitData.reduce(
            (sum, v) => sum + (v.units || 0),
            0,
          );

          claimMapping.mergedAmount = claimMapping.visitData.reduce(
            (sum, v) => sum + (v.amount || 0),
            0,
          );

          await claimMapping.save();
        } else {
          // Handle single visit updates
          const service = await ServiceTracking.findOne({
            tenantId: visit.tenantId,
            serviceId: visit.serviceId,
          });

          claimMapping.mergedUnits = newUnits;
          claimMapping.mergedAmount = service ? newUnits * service.billRate : 0;

          await claimMapping.save();
        }

        // Update the associated bill regardless of visit type (merged or single)
        if (claimMapping.claimId) {
          const bill = await Bills.findById(claimMapping.claimId);
          if (bill) {
            // Find the service line for this date and service type
            const serviceLineIndex = bill.serviceLines.findIndex(
              (line) =>
                new Date(line.serviceDate).toDateString() ===
                  new Date(visit.date).toDateString() &&
                line.serviceType === visit.serviceType,
            );

            if (serviceLineIndex !== -1) {
              // Update the service line with the new units and amount
              bill.serviceLines[serviceLineIndex].serviceUnitCount =
                claimMapping.mergedUnits;
              bill.serviceLines[serviceLineIndex].lineItemChargeAmount =
                claimMapping.mergedAmount;
            } else {
              // If no specific service line found, update the main service line
              if (bill.serviceLine) {
                bill.serviceLine.serviceUnitCount = claimMapping.mergedUnits;
                bill.serviceLine.lineItemChargeAmount =
                  claimMapping.mergedAmount;
              }
            }

            // Recalculate total amounts from all service lines
            const totalAmount = bill.serviceLines.reduce(
              (sum, line) => sum + (line.lineItemChargeAmount || 0),
              0,
            );
            const totalUnits = bill.serviceLines.reduce(
              (sum, line) => sum + (line.serviceUnitCount || 0),
              0,
            );

            // Update main service line totals
            if (bill.serviceLine) {
              bill.serviceLine.serviceUnitCount = totalUnits;
              bill.serviceLine.lineItemChargeAmount = totalAmount;
            }

            // Update bill claim information
            if (bill.bill && bill.bill.claimInformation) {
              bill.bill.claimInformation.totalClaimChargeAmount = totalAmount;
            }

            await bill.save();
            // Regenerate EDI for this bill
            const visitDate = new Date(visit.date);
            const monthYearKey = `${visitDate.getFullYear()}-${(
              visitDate.getMonth() + 1
            )
              .toString()
              .padStart(2, '0')}`;

            try {
              await regenerateBatchEDI(
                companyId || visit.companyId,
                monthYearKey,
              );
            } catch (ediError) {
              console.error(
                `Error regenerating EDI batch: ${ediError.message}`,
              );
            }
          }
        }
      }
    } catch (mappingError) {
      console.error('Error updating claim-visit mapping:', mappingError);
    }

    // Send notification to HCM about the update (only if status hasn't changed)
    if (originalData.status === visit.status) {
      try {
        const hcmDetails = await users.findById(visit.hcmId);
        const timezone = hcmDetails?.timezone || 'UTC';

        const previousDateAndTime =
          formatDateAndTimeForNotificationWithTimezone(
            originalData.date,
            originalData.startTime,
            timezone,
          );

        const newDateAndTime = formatDateAndTimeForNotificationWithTimezone(
          visit.date,
          visit.startTime,
          timezone,
        );

        const tenantData = await users.findById(visit.tenantId);

        await sendVisitNotification(
          visit.hcmId,
          'Visit Updated',
          `Your visit with ${tenantData.name} scheduled on ${previousDateAndTime} has been updated to ${newDateAndTime}.`,
          {
            visitId: visit._id.toString(),
            type: 'visit',
          },
        );
      } catch (notificationError) {
        console.error(
          'Error sending visit update notification:',
          notificationError,
        );
        // Continue with response even if notification fails
      }
    }

    // Handle status changes and update claims/bills
    if (originalData.status !== visit.status) {
      // ------------ UNIT MOVEMENT SECTION ------------
      try {
        const serviceTracking = await ServiceTracking.findOne({
          tenantId: visit.tenantId,
          serviceId: visit.serviceId,
        });

        if (!serviceTracking) {
          console.warn(
            '[BACKEND] ServiceTracking not found. Skipping unit movement.',
          );
        } else {
          const total = serviceTracking.totalUnits || 0;

          let scheduled = serviceTracking.scheduledUnits || 0;
          let worked = serviceTracking.workedUnits || 0;
          let remaining = serviceTracking.unitsRemaining ?? 0;

          // ✅ HCM entry (important!)
          const hcmEntry = upsertHcmEntry(serviceTracking, visit.hcmId);

          const fromStatus = originalData.status;
          const toStatus = visit.status;

          // ---------------- DAILY SERVICE LOGIC ----------------
          if (isDailyService) {
            const { start: startOfDay, end: endOfDay } = getStartEndOfDayUTC(
              visit.date,
            );

            const otherNonRejectedCount = await Visits.countDocuments({
              _id: { $ne: visit._id },
              tenantId: visit.tenantId,
              serviceId: visit.serviceId,
              date: { $gte: startOfDay, $lt: endOfDay },
              status: { $ne: 'rejected' },
            });

            const otherApprovedCount = await Visits.countDocuments({
              _id: { $ne: visit._id },
              tenantId: visit.tenantId,
              serviceId: visit.serviceId,
              date: { $gte: startOfDay, $lt: endOfDay },
              status: 'approved',
            });

            // ✅ pending → approved (convert scheduled → worked only if NO other approved exists)
            if (fromStatus === 'pending' && toStatus === 'approved') {
              if (otherApprovedCount === 0) {
                scheduled = clampNonNegative(scheduled - 1);
                worked += 1;

                hcmEntry.scheduledUnits = clampNonNegative(
                  hcmEntry.scheduledUnits - 1,
                );
                hcmEntry.workedUnits += 1;
              }
            }

            // ✅ pending → rejected (remove scheduled only if this was the LAST non-rejected on that day)
            else if (fromStatus === 'pending' && toStatus === 'rejected') {
              if (otherNonRejectedCount === 0) {
                scheduled = clampNonNegative(scheduled - 1);
                remaining += 1;
                if (total > 0) remaining = Math.min(remaining, total);

                hcmEntry.scheduledUnits = clampNonNegative(
                  hcmEntry.scheduledUnits - 1,
                );
              }
            }

            // ✅ rejected → pending (add scheduled only if this becomes first non-rejected)
            else if (fromStatus === 'rejected' && toStatus === 'pending') {
              if (otherNonRejectedCount === 0) {
                if (remaining < 1) {
                  return res.status(400).json({
                    success: false,
                    message:
                      'Insufficient available units to reschedule this visit',
                  });
                }

                remaining -= 1;
                scheduled += 1;

                hcmEntry.scheduledUnits += 1;
              }
            }

            // ✅ approved → pending (move worked → scheduled only if this was the ONLY approved on that day)
            else if (fromStatus === 'approved' && toStatus === 'pending') {
              // if this was only approved visit that day, revert the 1 worked unit
              if (otherApprovedCount === 0) {
                worked = clampNonNegative(worked - 1);
                scheduled += 1;

                hcmEntry.workedUnits = clampNonNegative(
                  hcmEntry.workedUnits - 1,
                );
                hcmEntry.scheduledUnits += 1;
              }
            }

            serviceTracking.scheduledUnits = scheduled;
            serviceTracking.workedUnits = worked;
            recalcRemaining(serviceTracking);

            await serviceTracking.save();
          }

          // ---------------- NON-DAILY (15-min etc) ----------------
          else {
            const visitUnits = newUnits || originalUnits || 0;
            if (visitUnits > 0) {
              // pending → approved
              if (fromStatus === 'pending' && toStatus === 'approved') {
                scheduled = clampNonNegative(scheduled - visitUnits);
                worked += visitUnits;

                hcmEntry.scheduledUnits = clampNonNegative(
                  hcmEntry.scheduledUnits - visitUnits,
                );
                hcmEntry.workedUnits += visitUnits;
              }

              // pending → rejected
              else if (fromStatus === 'pending' && toStatus === 'rejected') {
                scheduled = clampNonNegative(scheduled - visitUnits);
                remaining += visitUnits;
                if (total > 0) remaining = Math.min(remaining, total);

                hcmEntry.scheduledUnits = clampNonNegative(
                  hcmEntry.scheduledUnits - visitUnits,
                );
              }

              // approved → pending
              else if (fromStatus === 'approved' && toStatus === 'pending') {
                worked = clampNonNegative(worked - visitUnits);
                scheduled += visitUnits;

                hcmEntry.workedUnits = clampNonNegative(
                  hcmEntry.workedUnits - visitUnits,
                );
                hcmEntry.scheduledUnits += visitUnits;
              }

              // rejected → pending
              else if (fromStatus === 'rejected' && toStatus === 'pending') {
                if (remaining < visitUnits) {
                  return res.status(400).json({
                    success: false,
                    message:
                      'Insufficient available units to reschedule this visit',
                  });
                }

                remaining -= visitUnits;
                scheduled += visitUnits;

                hcmEntry.scheduledUnits += visitUnits;
              }

              serviceTracking.scheduledUnits = scheduled;
              serviceTracking.workedUnits = worked;
              recalcRemaining(serviceTracking);

              await serviceTracking.save();
            }
          }
        }
      } catch (err) {
        console.error('Error updating units based on status change:', err);
      }
      // ------------------------------------------------

      // ------------ STATUS-SPECIFIC BEHAVIOR ------------
      if (visit.status === 'approved') {
        const result = await markVisitAsApproved(visit._id);

        if (!result.success) {
          return res.status(400).json({
            success: false,
            message: result.message || 'Failed to approve visit',
          });
        }
      } else if (visit.status === 'rejected') {
        visit.reasonForRejection =
          updateData?.reasonForRejection || visit.reasonForRejection;
        visit.timeOfRejection = new Date();
        await visit.save();

        await removeBill(visit._id);
      } else if (visit.status === 'pending') {
        await removeBill(visit._id);
      }

      if (originalData.status === 'approved' && visit.status === 'approved') {
        await updateBillandEDI(visit._id);
      }

      return res.status(200).json({
        success: true,
        message: 'Visit updated successfully with status change',
        updatedVisit: visit,
      });
    }

    // Add return statement for when status hasn't changed
    return res.status(200).json({
      success: true,
      message: 'Visit updated successfully',
      updatedVisit: visit,
    });
  } catch (error) {
    console.error('Error updating visit:', error);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: error.message,
    });
  }
};

export const deleteVisit = async (req, res) => {
  const { id } = req.params;
  try {
    // Find the visit first to get its data
    const visit = await Visits.findById(id);

    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found',
      });
    }

    // Store visit data before deletion for reference
    const visitData = {
      _id: visit._id,
      tenantId: visit.tenantId,
      hcmId: visit.hcmId,
      serviceId: visit.serviceId,
      date: visit.date,
      startTime: visit.startTime,
      endTime: visit.endTime,
      status: visit.status,
      companyId: visit.companyId,
      billId: visit.billId,
    };

    const serviceDoc = await Service.findById(visit.serviceId).select(
      'service_procedure_code',
    );
    const serviceProcedureCode = serviceDoc?.service_procedure_code || null;

    // Calculate units for this visit
    let units = 0;
    if (visitData.startTime && visitData.endTime) {
      const durationInMinutes =
        (new Date(visitData.endTime) - new Date(visitData.startTime)) /
        (1000 * 60);
      units = Math.ceil(durationInMinutes / 15);
    }

    // Delete the visit
    const deletedVisit = await Visits.findByIdAndDelete(id);

    // Find claim-visit mapping for this visit
    let claimMapping = null;
    try {
      claimMapping = await ClaimVisitMap.findOne({ visitId: id });

      if (claimMapping) {
        // Check if this is part of a merged visit group
        if (claimMapping.visitIds && claimMapping.visitIds.length > 1) {
          // This is a merged visit - update the mapping instead of deleting it
          // Remove this visit ID from the visitIds array
          const visitIdIndex = claimMapping.visitIds.indexOf(id.toString());
          if (visitIdIndex !== -1) {
            claimMapping.visitIds.splice(visitIdIndex, 1);
          }

          // Update mergedUnits and mergedAmount
          claimMapping.mergedUnits = Math.max(
            0,
            claimMapping.mergedUnits - units,
          );

          // Calculate amount to subtract based on service rate
          const service = await ServiceTracking.findOne({
            tenantId: visitData.tenantId,
            serviceId: visit.serviceId,
          });

          const amountToSubtract = service ? units * service.billRate : 0;
          claimMapping.mergedAmount = Math.max(
            0,
            claimMapping.mergedAmount - amountToSubtract,
          );

          // If there are still visits in the mapping, save it; otherwise delete it
          if (claimMapping.visitIds.length > 0) {
            await claimMapping.save();
          } else {
            await ClaimVisitMap.findByIdAndDelete(claimMapping._id);
          }
        } else {
          // This is a single visit mapping - delete it
          await ClaimVisitMap.findByIdAndDelete(claimMapping._id);
        }
      }
    } catch (mappingError) {
      console.error(
        '[BACKEND] Error handling claim-visit mapping:',
        mappingError,
      );
    }

    // Send notification to HCM
    // Your visit with Tenant_Name on June 24, 2025 at 10:00 AM has been deleted
    try {
      const hcmDetails = await users.findById(visitData.hcmId);
      const timezone = hcmDetails?.timezone || 'UTC';

      const dateAndTime = formatDateAndTimeForNotificationWithTimezone(
        visitData.date,
        visitData.startTime,
        timezone,
      );

      const tenantData = await users.findById(visitData.tenantId);

      await sendVisitNotification(
        visitData.hcmId,
        'Visit Deleted',
        `Your visit with ${tenantData.name} on ${dateAndTime} has been deleted.`,
        {
          visitId: visitData._id.toString(),
          type: 'visit',
        },
      );
    } catch (notificationError) {
      console.error(
        'Error sending visit deletion notification:',
        notificationError,
      );
      // Continue with response even if notification fails
    }

    // Try to find and delete related records if they exist
    try {
      // If the visit had a billId, use it to find and delete the bill
      if (visitData.billId) {
        await Bills.findByIdAndDelete(visitData.billId);
      } else {
        // Otherwise try to find the bill by visitId
        const bill = await Bills.findOne({ visitId: id });
        if (bill) {
          await Bills.findByIdAndDelete(bill._id);
        }
      }

      // If the visit was approved, we need to update service tracking
      if (visitData.status === 'approved' && units > 0) {
        // Find the service tracking record
        const serviceTracking = await ServiceTracking.findOne({
          tenantId: visitData.tenantId,
          serviceId: visitData.serviceId,
        });

        if (serviceTracking) {
          // Update total units used and remaining
          serviceTracking.unitsUsed = Math.max(
            0,
            serviceTracking.unitsUsed - units,
          );
          serviceTracking.unitsRemaining =
            serviceTracking.unitsRemaining + units;
          // Update HCM's units
          const hcmRecord = serviceTracking.hcms.find(
            (hcm) =>
              hcm.hcmId && hcm.hcmId.toString() === visitData.hcmId.toString(),
          );

          if (hcmRecord) {
            // Update HCM's total units
            hcmRecord.unitsUsed = Math.max(
              0,
              (hcmRecord.unitsUsed || 0) - units,
            );
            // Find service detail for the date
            const visitDate = new Date(visitData.date);
            const dateString = visitDate.toISOString().split('T')[0];

            const serviceDetailIndex = hcmRecord.serviceDetails.findIndex(
              (detail) =>
                new Date(detail.dateOfService).toISOString().split('T')[0] ===
                dateString,
            );

            if (serviceDetailIndex !== -1) {
              const serviceDetail =
                hcmRecord.serviceDetails[serviceDetailIndex];

              // Subtract units from the service detail
              serviceDetail.unitsUsed = Math.max(
                0,
                (serviceDetail.unitsUsed || 0) - units,
              );
              // If no units left, remove the service detail
              if (serviceDetail.unitsUsed <= 0) {
                hcmRecord.serviceDetails.splice(serviceDetailIndex, 1);
              } else {
                hcmRecord.serviceDetails[serviceDetailIndex] = serviceDetail;
              }
            }
          }

          await serviceTracking.save();
          // If this was the only visit for this month, we need to regenerate the EDI file
          const monthStart = new Date(
            visitDate.getFullYear(),
            visitDate.getMonth(),
            1,
          );
          const monthEnd = new Date(
            visitDate.getFullYear(),
            visitDate.getMonth() + 1,
            0,
            23,
            59,
            59,
          );

          // Check if there are any other approved visits for this tenant in this month
          const otherVisitsInMonth = await Visits.countDocuments({
            _id: { $ne: visitData._id },
            tenantId: visitData.tenantId,
            date: { $gte: monthStart, $lte: monthEnd },
            status: 'approved',
          });

          if (otherVisitsInMonth === 0) {
            // This was the only visit, so we need to regenerate the EDI
            const monthYearKey = `${visitDate.getFullYear()}-${(
              visitDate.getMonth() + 1
            )
              .toString()
              .padStart(2, '0')}`;
            await regenerateBatchEDI(visitData.companyId, monthYearKey);
          }
        }
      }
    } catch (error) {
      console.error('Error cleaning up related records:', error);
      // Continue with response even if cleanup fails
    }

    res.status(200).json({
      success: true,
      message: 'Visit deleted successfully',
      data: deletedVisit,
    });
  } catch (error) {
    console.error('Error deleting visit:', error);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: error.message,
    });
  }
};

export const visitsWaitingForApproval = async (req, res) => {
  const { companyId } = req.params;
  try {
    // Step 1: Get all pending visits for this company
    const visits = await Visits.find({ status: 'pending', companyId })
      .populate({
        path: 'creatorId',
        select: 'name email role',
        model: 'causers',
      })
      .populate({
        path: 'hcmId',
        select: 'name email phoneNo',
        model: 'causers',
      })
      .populate({
        path: 'tenantId',
        select: 'name email phoneNo',
        model: 'causers',
      })
      .populate({
        path: 'signedBy',
        select: 'name email',
        model: 'causers',
      })
      .populate({
        path: 'serviceId',
        select: 'service_name service_procedure_code',
        model: 'Service',
      });

    // Step 2: Transform into old format
    const formattedVisits = visits.map((visit) => {
      const v = visit.toObject();

      return {
        ...v,
        serviceType: v.serviceId?.service_procedure_code || null, // old "serviceType"
        serviceTypeName: v.serviceId?.service_name || null, // old "serviceTypeName"
      };
    });

    // Step 3: Send response
    res.status(200).json({
      success: true,
      message: 'Visits waiting for approval fetched successfully',
      response: {
        visits: formattedVisits,
        count: formattedVisits.length,
      },
    });
  } catch (error) {
    console.error('Error in visitsWaitingForApproval:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getVisitsCompliance = async (req, res) => {
  const { companyId } = req.params;
  try {
    const visits = await Visits.find({ companyId })
      .populate({
        path: 'tenantId',
        select: '_id name email',
        model: 'causers',
      })
      .populate({
        path: 'hcmId',
        select: '_id name email',
        model: 'causers',
      })
      .populate({
        path: 'serviceId',
        select: 'service_name service_procedure_code',
        model: 'Service',
      });

    const visitCounts = {};
    const visitDetails = {
      'in-person': {},
      indirect: {},
      remote: {},
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
        visitCounts[year][month] = { 'in-person': 0, indirect: 0, remote: 0 };
      }

      if (!visitDetails['in-person'][year]) {
        visitDetails['in-person'][year] = {};
      }
      if (!visitDetails['indirect'][year]) {
        visitDetails['indirect'][year] = {};
      }
      if (!visitDetails['remote'][year]) {
        visitDetails['remote'][year] = {};
      }

      if (!visitDetails['in-person'][year][month]) {
        visitDetails['in-person'][year][month] = [];
      }
      if (!visitDetails['indirect'][year][month]) {
        visitDetails['indirect'][year][month] = [];
      }
      if (!visitDetails['remote'][year][month]) {
        visitDetails['remote'][year][month] = [];
      }

      const method = visit.methodOfContact || 'unknown';
      switch (method) {
        case 'in-person':
          visitCounts[year][month]['in-person']++;
          visitDetails['in-person'][year][month].push(createVisitDetail(visit));
          break;
        case 'indirect':
          visitCounts[year][month]['indirect']++;
          visitDetails['indirect'][year][month].push(createVisitDetail(visit));
          break;
        case 'remote':
          visitCounts[year][month]['remote']++;
          visitDetails['remote'][year][month].push(createVisitDetail(visit));
          break;
        default:
          console.warn(`Unknown methodOfContact for visit ID: ${visit._id}`);
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
      tenantId: visit.tenantId ? visit.tenantId._id : '-',
      tenantName: visit.tenantId ? visit.tenantId.name : '-',
      tenantEmail: visit.tenantId ? visit.tenantId.email : '-',
    },
    hcm: {
      hcmId: visit.hcmId ? visit.hcmId._id : '-',
      hcmName: visit.hcmId ? visit.hcmId.name : '-',
      hcmEmail: visit.hcmId ? visit.hcmId.email : '-',
    },
    serviceType: visit.serviceId?.service_procedure_code || null, // old field
    serviceTypeName: visit.serviceId?.service_name || null,
    dateOfService: visit.date.toISOString().split('T')[0],
    methodOfVisit: visit.methodOfContact || 'N/A',
  };
}

export const getVisitsComplianceReports = async (req, res) => {
  const { companyId } = req.params;
  try {
    // Fetch all visit records
    const visits = await Visits.find({ companyId })
      .populate({
        path: 'tenantId',
        select: '_id name email phoneNo',
        model: 'causers',
      })
      .populate({
        path: 'hcmId',
        select: '_id name email phoneNo',
        model: 'causers',
      })
      .populate({
        path: 'serviceId',
        select: 'service_name service_procedure_code',
        model: 'Service',
      });

    // Format the response
    const formattedReports = visits.map((visit) => {
      const durationInMinutes =
        (new Date(visit.endTime) - new Date(visit.startTime)) / 60000;
      const hours = Math.floor(durationInMinutes / 60);
      const minutes = Math.floor(durationInMinutes % 60);
      const duration = `${hours}h ${minutes}m`;

      return {
        tenantId: visit.tenantId ? visit.tenantId._id : '-',
        tenantName: visit.tenantId ? visit.tenantId.name : '-',
        hcmId: visit.hcmId ? visit.hcmId._id : '-',
        assignedHCM: visit.hcmId ? visit.hcmId.name : '-',
        serviceType: visit.serviceId?.service_procedure_code || '-', // from Service
        serviceTypeName: visit.serviceId?.service_name || '-', // added back
        dateOfService: visit.date?.toISOString().split('T')[0] || '-',
        duration,
        visitType: visit.activity || '-',
        methodOfVisit: visit.methodOfContact || '-',
        mileage: visit.totalMiles || 0,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Visits compliance reports fetched successfully',
      response: {
        totalVisits: visits.length,
        visits: formattedReports,
      },
    });
  } catch (error) {
    console.error('Error fetching visits compliance reports:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const filterVisits = async (req, res) => {
  try {
    const { companyId } = req.params;
    const filterCriteria = req.body;

    // Initialize base query with companyId
    const query = { companyId };

    // Apply filters
    if (filterCriteria && Object.keys(filterCriteria).length > 0) {
      if (filterCriteria._id) query._id = filterCriteria._id;
      if (filterCriteria.tenantId) query.tenantId = filterCriteria.tenantId;
      if (filterCriteria.hcmId) query.hcmId = filterCriteria.hcmId;
      if (filterCriteria.creatorId) query.creatorId = filterCriteria.creatorId;
      if (filterCriteria.serviceId) query.serviceId = filterCriteria.serviceId; // ✅ updated
      if (filterCriteria.title) query.title = filterCriteria.title;
      if (filterCriteria.date) query.date = new Date(filterCriteria.date);
      if (filterCriteria.startDate && filterCriteria.endDate) {
        const start = new Date(filterCriteria.startDate);
        const end = new Date(filterCriteria.endDate);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          query.date = { $gte: start, $lte: end };
        }
      }
      if (filterCriteria.startTime) query.startTime = filterCriteria.startTime;
      if (filterCriteria.endTime) query.endTime = filterCriteria.endTime;
      if (filterCriteria.place) query.place = filterCriteria.place;
      if (filterCriteria.methodOfVisit)
        query.methodOfVisit = filterCriteria.methodOfVisit;
      if (filterCriteria.reasonForRemote)
        query.reasonForRemote = filterCriteria.reasonForRemote;
      if (filterCriteria.notes) query.notes = filterCriteria.notes;
      if (filterCriteria.travel) query.travel = filterCriteria.travel;
      if (filterCriteria.totalMiles !== undefined)
        query.totalMiles = filterCriteria.totalMiles;
      if (filterCriteria.travelWithTenant !== undefined)
        query.travelWithTenant = filterCriteria.travelWithTenant;
      if (filterCriteria.travelWithoutTenant !== undefined)
        query.travelWithoutTenant = filterCriteria.travelWithoutTenant;
      if (filterCriteria.signature) query.signature = filterCriteria.signature;
      if (filterCriteria.status) query.status = filterCriteria.status;
    }

    // Fetch visits
    const visits = await Visits.find(query)
      .populate({
        path: 'creatorId',
        select: 'name email role',
        model: 'causers',
      })
      .populate({
        path: 'hcmId',
        select: 'name email phoneNo',
        model: 'causers',
      })
      .populate({
        path: 'tenantId',
        select: 'name email phoneNo',
        model: 'causers',
      })
      .populate({
        path: 'serviceId',
        select: 'service_name service_procedure_code',
        model: 'Service',
      })
      .sort({ date: 1, startTime: 1 }); // ✅ fixed

    if (visits.length === 0) {
      return res.status(200).json({
        success: false,
        message:
          'No visits found for this company with the specified criteria.',
      });
    }

    // Fetch all services for the tenants in the visits
    const tenantIds = [...new Set(visits.map((visit) => visit.tenantId?._id))];

    const services = await ServiceTracking.find({
      tenantId: { $in: tenantIds },
    }).select('tenantId serviceId unitsRemaining');

    // Attach remaining units to each visit
    const visitsWithServices = visits.map((visit) => {
      const service = services.find(
        (s) =>
          s.tenantId.toString() === visit.tenantId?._id.toString() &&
          s.serviceId.toString() === visit.serviceId?._id.toString(), // ✅ compare with service ID
      );

      return {
        ...visit.toObject(),
        unitsRemaining: service ? service.unitsRemaining : null,
        serviceTypeName: visit.serviceId?.service_name || null,
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Visits fetched successfully',
      response: visitsWithServices,
    });
  } catch (error) {
    console.error('Error in filterVisits:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

//to get the visit count of a company
export const getVisitsCount = async (req, res) => {
  const { companyId } = req.params;

  try {
    const visits = await Visits.find({ companyId });

    const counts = {
      status: { pending: 0, approved: 0, rejected: 0 },
      signature: { done: 0, 'not done': 0 },
      methodOfContact: { 'in-person': 0, remote: 0 },
      totalVisits: visits.length,
    };

    visits.forEach((visit) => {
      if (visit.status && counts.status[visit.status] !== undefined) {
        counts.status[visit.status]++;
      }

      if (visit.signature && counts.signature[visit.signature] !== undefined) {
        counts.signature[visit.signature]++;
      }

      if (
        visit.methodOfContact &&
        counts.methodOfContact[visit.methodOfContact] !== undefined
      ) {
        counts.methodOfContact[visit.methodOfContact]++;
      }
    });

    res.status(200).json({
      success: true,
      message: 'Visits count fetched successfully',
      counts,
    });
  } catch (error) {
    console.error('Error fetching visits count:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching visits count.',
    });
  }
};

const withdrawingMarkingVisitAsApproved = async (visitId) => {
  try {
    const visitDocumentId = new mongoose.Types.ObjectId(visitId);
    const visit = await Visits.findById(visitDocumentId);
    if (!visit) {
      return { success: false, message: 'Visit not found' };
    }

    const companyId = visit.companyId;

    // Calculate visit units for service tracking adjustment
    let visitUnits = 0;
    if (visit.startTime && visit.endTime) {
      const visitDuration =
        (new Date(visit.endTime) - new Date(visit.startTime)) / 60000;
      visitUnits = Math.ceil(visitDuration / 15);
    }

    // Update visit status
    visit.status = 'pending';
    visit.signature = 'not done';
    visit.timeOfApproval = null;
    visit.timeOfRejection = null;
    visit.reasonForRejection = null;
    visit.billId = null;

    const bill = await removeBill(visit.billId);

    const visitStartTime = new Date(visit.startTime);
    const visitEndTime = new Date(visit.endTime);
    const durationInMinutes = (visitEndTime - visitStartTime) / 60000;
    const serviceUnits = durationInMinutes / 15;
    const workedHours = durationInMinutes / 60;

    await hcmVisitHistory.create({
      hcmId: visit.hcmId,
      visitId: visit._id,
      tenantId: visit.tenantId,
      serviceId: visit.serviceId,
      serviceDate: visit.date,
      serviceUnits: serviceUnits,
      workedHours: workedHours,
      status: 'pending',
    });

    return { success: true, message: 'Visit approval withdrawn successfully' };
  } catch (error) {
    console.error(
      '[WITHDRAW APPROVAL] Error withdrawing visit approval:',
      error,
    );
    return {
      success: false,
      message: 'Internal Server Error',
      response: error.message,
    };
  }
};

export const markVisitAsRejected = async (req, res) => {
  try {
    const { visitId, reasonForRejection } = req.body;

    const response = await withdrawingMarkingVisitAsApproved(visitId);
    if (!response.success) {
      return res.status(400).json({
        success: false,
        message: response.message,
      });
    }

    const visitDocumentId = new mongoose.Types.ObjectId(visitId);
    const visit = await Visits.findById(visitDocumentId);
    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found',
      });
    }

    visit.status = 'rejected';
    visit.signature = 'not done';
    visit.reasonForRejection = reasonForRejection;
    visit.timeOfRejection = new Date();
    visit.timeOfApproval = null;
    visit.response = null;
    visit.rejectedBy = req.user?.id || null;
    await visit.save();

    const visitStartTime = new Date(visit.startTime);
    const visitEndTime = new Date(visit.endTime);
    const durationInMinutes = (visitEndTime - visitStartTime) / 60000;
    const serviceUnits = durationInMinutes / 15;
    const workedHours = durationInMinutes / 60;

    await hcmVisitHistory.create({
      hcmId: visit.hcmId,
      visitId: visit._id,
      tenantId: visit.tenantId,
      serviceId: visit.serviceId,
      serviceDate: visit.date,
      serviceUnits: serviceUnits,
      workedHours: workedHours,
      status: 'rejected',
    });

    return res.status(200).json({
      success: true,
      message: 'Visit rejected successfully',
      visitId: visitId,
      reasonForRejection: reasonForRejection,
    });
  } catch (error) {
    console.error('[VISIT REJECTION] Error marking visit as rejected:', error);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      response: error.message,
    });
  }
};

export const withdrawMarkedVisitAsApproved = async (req, res) => {
  try {
    const { visitId } = req.body;
    const response = await withdrawingMarkingVisitAsApproved(visitId);
    if (!response.success) {
      return res.status(200).json({
        success: false,
        message: response.message,
      });
    }

    const visit = await Visits.findById(visitId);

    const visitStartTime = new Date(visit.startTime);
    const visitEndTime = new Date(visit.endTime);
    const durationInMinutes = (visitEndTime - visitStartTime) / 60000;
    const serviceUnits = durationInMinutes / 15;
    const workedHours = durationInMinutes / 60;

    await hcmVisitHistory.create({
      hcmId: visit.hcmId,
      visitId: visit._id,
      tenantId: visit.tenantId,
      serviceId: visit.serviceId,
      serviceDate: visit.date,
      serviceUnits: serviceUnits,
      workedHours: workedHours,
      status: 'pending',
    });

    return res.status(200).json({
      success: true,
      message: 'Visit approval withdrawn successfully',
    });
  } catch (error) {
    console.error('Error withdrawing marking visit as approved:', error);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      response: error.message,
    });
  }
};

export const withdrawMarkedVisitAsRejected = async (req, res) => {
  try {
    const { visitId } = req.body;
    const response = await withdrawingMarkingVisitAsApproved(visitId);
    if (!response.success) {
      return res.status(200).json({
        success: false,
        message: response.message,
      });
    }
    const visit = await Visits.findById(visitId);
    visit.status = 'pending';
    visit.signature = 'not done';
    visit.timeOfApproval = null;
    visit.timeOfRejection = null;
    visit.reasonForRejection = null;
    await visit.save();
    const visitStartTime = new Date(visit.startTime);
    const visitEndTime = new Date(visit.endTime);
    const durationInMinutes = (visitEndTime - visitStartTime) / 60000;
    const serviceUnits = durationInMinutes / 15;
    const workedHours = durationInMinutes / 60;

    await hcmVisitHistory.create({
      hcmId: visit.hcmId,
      visitId: visit._id,
      tenantId: visit.tenantId,
      serviceId: visit.serviceId,
      serviceDate: visit.date,
      serviceUnits: serviceUnits,
      workedHours: workedHours,
      status: 'pending',
    });

    return res.status(200).json({
      success: true,
      message: 'Visit withdrawn successfully',
    });
  } catch (error) {
    console.error('Error withdrawing marking visit as rejected:', error);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      response: error.message,
    });
  }
};

export const getAllServiceTypes = async (req, res) => {
  try {
    // Fetch all services from DB
    const services = await Service.find({}).select(
      'service_name service_procedure_code service_modifiers',
    );

    // Format response in the same shape as before
    const formatted = services.map((service) => ({
      serviceType: service.service_name, // display name
      code: service.service_procedure_code,
      modifiers: service.service_modifiers,
      displayName: service.service_name,
      formattedString: `${service.service_name} (${service.service_procedure_code})`,
    }));

    res.status(200).json({
      success: true,
      message: 'Service types fetched successfully',
      response: formatted,
    });
  } catch (error) {
    console.error('Error in getAllServiceTypes:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching service types',
      error: error.message,
    });
  }
};

export const getServiceTypeMapping = async (req, res) => {
  try {
    const { serviceType, methodOfContact } = req.query;

    if (!serviceType) {
      return res.status(400).json({
        success: false,
        message: 'Service type is required',
      });
    }

    const mapping = getProcedureCodeAndModifierFromDB(
      serviceType,
      methodOfContact,
    );

    res.status(200).json({
      success: true,
      message: 'Service type mapping fetched successfully',
      response: mapping,
    });
  } catch (error) {
    console.error('Error fetching service type mapping:', error);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: error.message,
    });
  }
};

export const getPredefinedActivities = async (req, res) => {
  try {
    const activities = [
      '1. Assessment and care planning',
      '2. Medication management and monitoring',
      '3. Health education and counseling',
      '4. Coordination with healthcare providers',
      '5. Emergency response and crisis intervention',
      '6. Personal care assistance',
      '7. Household management support',
      '8. Transportation assistance',
      '9. Social and recreational activities',
      '10. Documentation and reporting',
      '11. Family and caregiver support',
      '12. Community resource coordination',
    ];

    res.status(200).json({
      success: true,
      message: 'Predefined activities fetched successfully',
      response: activities,
    });
  } catch (error) {
    console.error('Error fetching predefined activities:', error);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      error: error.message,
    });
  }
};

export const getVisitById = async (req, res) => {
  const { id } = req.params;

  // Validate ObjectId
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid visit ID',
    });
  }

  try {
    const visit = await Visits.findById(id)
      .populate({
        path: 'creatorId',
        select: 'name email role',
        model: 'causers',
      })
      .populate({
        path: 'hcmId',
        select: 'name email phoneNo',
        model: 'causers',
      })
      .populate({
        path: 'tenantId',
        select: 'name email phoneNo',
        model: 'causers',
      })
      .populate({
        path: 'signedBy',
        select: 'name email',
        model: 'causers',
      })
      .populate({
        path: 'serviceId',
        select: 'service_name service_procedure_code',
        model: 'Service',
      });

    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found',
      });
    }

    // Fetch matching service tracking
    const tracking = await ServiceTracking.findOne({
      tenantId: visit.tenantId?._id,
      serviceId: visit.serviceId?._id || null,
    }).select('unitsRemaining');

    // Convert to old format
    const visitData = {
      ...visit.toObject(),
      serviceType: visit.serviceId?.service_procedure_code || null,
      serviceTypeName: visit.serviceId?.service_name || null,
      unitsRemaining: tracking ? tracking.unitsRemaining : null,
    };

    res.status(200).json({
      success: true,
      message: 'Visit fetched successfully',
      response: {
        visit: visitData,
      },
    });
  } catch (error) {
    console.error('Error in getVisitById:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// Function to create claim-visit mapping
const createClaimVisitMapping = async (
  visitId,
  billId,
  visit,
  procedureCodeInfo,
) => {
  try {
    // Check if there's already a mapping for this visit date, tenant, and service type
    const existingMapping = await ClaimVisitMap.findOne({
      claimId: billId,
      serviceDate: {
        $eq: new Date(visit.date),
      },
      serviceType: visit.serviceType,
      'visitData.tenantId': visit.tenantId.toString(),
    });

    // Calculate units and amount for this visit
    let unitsUsed = 0;
    let billAmount = 0;

    if (visit.serviceType === 'T2038' || visit.serviceType === 'T2024') {
      unitsUsed = 1;
    } else if (visit.startTime && visit.endTime) {
      const durationInMinutes =
        (new Date(visit.endTime) - new Date(visit.startTime)) / 60000;
      unitsUsed = Math.ceil(durationInMinutes / 15);
    }

    // Get service tracking to calculate bill amount
    const service = await ServiceTracking.findOne({
      tenantId: visit.tenantId,
      serviceType: getProcedureCodeFromServiceType(visit.serviceType),
    });

    if (service) {
      billAmount = unitsUsed * service.billRate;
    }

    if (existingMapping) {
      // Update existing mapping with additional visit data
      // Add this visit to the visits array if not already included
      const isNewVisit = !existingMapping.visitIds.includes(visitId.toString());
      if (isNewVisit) {
        existingMapping.visitIds.push(visitId.toString());
      }

      // Update visit data array
      if (!existingMapping.visitData) {
        existingMapping.visitData = [];
      }

      // Check if visit data already exists for this visit ID to prevent duplicates
      const existingVisitData = existingMapping.visitData.find(
        (data) => data.visitId === visitId.toString(),
      );

      if (!existingVisitData) {
        // New visit - add to merged totals and visit data
        existingMapping.mergedUnits += unitsUsed;
        existingMapping.mergedAmount += billAmount;

        existingMapping.visitData.push({
          visitId: visitId.toString(),
          tenantId: visit.tenantId.toString(),
          hcmId: visit.hcmId.toString(),
          serviceType: visit.serviceType,
          units: unitsUsed,
          amount: billAmount,
          startTime: visit.startTime,
          endTime: visit.endTime,
        });
      } else {
        // Existing visit - update merged totals by subtracting old values and adding new ones
        existingMapping.mergedUnits =
          existingMapping.mergedUnits - existingVisitData.units + unitsUsed;
        existingMapping.mergedAmount =
          existingMapping.mergedAmount - existingVisitData.amount + billAmount;

        // Update existing visit data
        existingVisitData.units = unitsUsed;
        existingVisitData.amount = billAmount;
        existingVisitData.startTime = visit.startTime;
        existingVisitData.endTime = visit.endTime;
      }

      existingMapping.updatedAt = new Date();

      await existingMapping.save();
      return {
        success: true,
        mappingId: existingMapping._id,
      };
    } else {
      // Create new mapping
      const claimVisitMap = new ClaimVisitMap({
        claimId: billId,
        visitId: visitId,
        visitIds: [visitId.toString()],
        serviceDate: visit.date,
        mergedUnits: unitsUsed,
        mergedAmount: billAmount,
        serviceType: visit.serviceType,
        procedureCode: procedureCodeInfo.code,
        modifiers: procedureCodeInfo.modifiers || [],
        ref6r: `${visit.serviceType}_${visit.date.toISOString().split('T')[0]}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        visitData: [
          {
            visitId: visitId.toString(),
            tenantId: visit.tenantId.toString(),
            hcmId: visit.hcmId.toString(),
            serviceType: visit.serviceType,
            units: unitsUsed,
            amount: billAmount,
            startTime: visit.startTime,
            endTime: visit.endTime,
          },
        ],
      });

      await claimVisitMap.save();
      return {
        success: true,
        mappingId: claimVisitMap._id,
      };
    }
  } catch (error) {
    console.error('[BACKEND] Error creating claim-visit mapping:', error);
    return {
      success: false,
      error: error.message,
    };
  }
};

// Utility function to get claim mappings for a visit
const getClaimMappingForVisit = async (visitId) => {
  try {
    const claimMapping = await ClaimVisitMap.findOne({ visitId }).populate(
      'claimId',
    );
    return claimMapping;
  } catch (error) {
    console.error('[BACKEND] Error getting claim mapping for visit:', error);
    return null;
  }
};

// Endpoint to get claim mappings for visits
export const getVisitClaimMappings = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { visitId } = req.query;

    let query = {};

    if (visitId) {
      // Get mapping for specific visit
      query.visitId = visitId;
    }

    const claimMappings = await ClaimVisitMap.find(query)
      .populate({
        path: 'visitId',
        select:
          'date startTime endTime serviceType tenantId hcmId companyId status',
        model: 'visits',
        match: companyId ? { companyId } : {},
      })
      .populate({
        path: 'claimId',
        select: 'claimId controlNumber billName serviceDate totalAmount',
      })
      .sort({ serviceDate: -1 });

    // Filter out mappings where visit doesn't match company (due to populate match)
    const filteredMappings = claimMappings.filter((mapping) => mapping.visitId);

    res.status(200).json({
      success: true,
      message: 'Claim mappings retrieved successfully',
      mappings: filteredMappings,
      count: filteredMappings.length,
    });
  } catch (error) {
    console.error('[BACKEND] Error getting visit claim mappings:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

export const getVisitCount = async (req, res) => {
  const { companyId, year } = req.params;

  try {
    // Fetch all visits for the company in the specified year
    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31T23:59:59.999Z`);

    const visits = await Visits.find({
      companyId,
      date: { $gte: startDate, $lte: endDate },
    });

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

    // Initialize counts
    const visitCounts = {};
    monthNames.forEach((month) => {
      visitCounts[month] = {
        direct: 0,
        indirect: 0,
        remote: 0,
      };
    });

    // Count visits per month & method
    visits.forEach((visit) => {
      const visitDate = new Date(visit.date);
      const month = monthNames[visitDate.getMonth()];

      switch (visit.methodOfContact) {
        case 'in-person':
        case 'direct':
          visitCounts[month].direct++;
          break;
        case 'indirect':
          visitCounts[month].indirect++;
          break;
        case 'remote':
          visitCounts[month].remote++;
          break;
        default:
          break; // ignore unknown methods
      }
    });

    res.status(200).json({
      success: true,
      message: `Visit compliance for ${year} fetched successfully`,
      response: {
        year,
        visitCounts, // { Jan: {direct, indirect, remote}, Feb: {...}, ... }
        totalVisits: visits.length,
      },
    });
  } catch (error) {
    console.error('Error fetching visit compliance:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching visit compliance',
      error: error.message,
    });
  }
};
