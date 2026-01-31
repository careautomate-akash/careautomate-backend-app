import users from '../../models/account/users.js';
import tenantInfo from '../../models/hcm-tenants/tenantInfo.js';
import bcrypt from 'bcrypt';
import HcmAppointments from '../../models/appointments-visits/appointments.js';
import mongoose from 'mongoose';
import hcmAssignedToTenant from '../../models/hcm-tenants/hcmAssignedToTenant.js';
import TenantHistory from '../../models/hcm-tenants/tenantHistory.js';
import Visits from '../../models/appointments-visits/visits.js';
import ServiceTracking from '../../models/bills/serviceTracking.js';
import Service from '../../models/services/services.js';
import tenantNotes from '../../models/hcm-tenants/tenantNotes.js';
import Company from '../../models/account/company.js';
import tenantAssignedtoHcm from '../../models/hcm-tenants/tenantAssignedtoHcm.js';
import { generateChatToken } from '../../utils/generateChatToken.js';
import {
  updateBillandEDI,
  updateTenantBillsAndEDI,
} from '../appointments-visits/vistiBillController.js';
import Bills from '../../models/bills/bills.js';
import { enhanceServiceTypes } from '../../utils/serviceTypeEnhancer.js';

function generateControlNumber() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

const groupControlNumber = generateControlNumber();

// Helper function to get service details and calculate units
async function getServiceDetailsAndCalculateUnits(
  serviceType,
  durationInHours = 0
) {
  try {
    const serviceDetails = await Service.findOne({
      $or: [
        { _id: serviceType }, // if serviceType is ObjectId
        { service_name: serviceType }, // if serviceType is service name
        { service_procedure_code: serviceType }, // if serviceType is procedure code
      ],
    });

    if (!serviceDetails) {
      // Return fallback values if service not found
      return {
        serviceRate: 17.17,
        defaultUnits: 600,
        unitsPerHour: 4, // 600/150 = 4
        unitsToAdd: durationInHours * 4,
        serviceId: null,
      };
    }

    const serviceRate = serviceDetails.service_rate || 17.17;
    const defaultUnits = serviceDetails.default_units || 600;
    const unitsPerHour = defaultUnits / 150; // Maintain the ratio: 150 hours = defaultUnits
    const unitsToAdd = durationInHours * unitsPerHour;

    return {
      serviceRate,
      defaultUnits,
      unitsPerHour,
      unitsToAdd: parseFloat(unitsToAdd.toFixed(2)),
      serviceId: serviceDetails._id,
      serviceDetails,
    };
  } catch (error) {
    console.error('Error fetching service details:', error);
    // Return fallback values on error
    return {
      serviceRate: 17.17,
      defaultUnits: 600,
      unitsPerHour: 4,
      unitsToAdd: durationInHours * 4,
      serviceId: null,
    };
  }
}

export const createTenant = async (req, res) => {
  try {
    const { companyId } = req.body;
    const tenantData =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const existingUser = await users.findOne({
      email: tenantData.personalInfo.email,
      companyId,
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email already exists.',
      });
    }

    // Only check loginInfo if password is provided (mobile access enabled)
    let hashedPassword = null;
    if (tenantData.loginInfo && tenantData.loginInfo.password) {
      hashedPassword = await bcrypt.hash(tenantData.loginInfo.password, 10);
    }

    const companyRecord = await Company.findOne({ _id: companyId });

    const newInfo = new tenantInfo(tenantData);
    const savedInfo = await newInfo.save();

    const fullName = `${tenantData.personalInfo.firstName} ${tenantData.personalInfo.middleName} ${tenantData.personalInfo.lastName}`;

    const newUser = new users({
      name: fullName,
      email: tenantData.personalInfo.email,
      password: hashedPassword || 'temp_password', // Use temp password if no mobile access
      phoneNo:
        tenantData.contactInfo?.phoneNumber ||
        tenantData.personalInfo?.phoneNumber ||
        '',
      info_id: savedInfo._id,
      role: 0,
      companyId,
      companyName: companyRecord.companyName,
    });

    await newUser.save();
    const chatToken = generateChatToken(newUser._id.toString());

    res.status(200).json({
      success: true,
      message:
        'Tenant data recorded, Info record created, User created, and Bill created successfully.',
      response: {
        tenantID: newUser._id,
        tenantData: savedInfo,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating tenant data',
    });
  }
};
export const tenantVisitHistory = async (req, res) => {
  try {
    const { tenantId, companyId } = req.body;
    const visits = await Visits.find({ tenantId, companyId })
      .populate({
        path: 'hcmId',
        select: '_id name',
        model: 'causers',
      })
      .populate({
        path: 'tenantId',
        select: '_id name',
        model: 'causers',
      })
      .populate({
        path: 'serviceId',
        select: 'service_name service_procedure_code',
        model: 'Service',
      })
      .select(
        'date startTime endTime status notes response activity methodOfContact serviceId'
      );
    const formattedVisits = visits.map((visit) => {
      const v = visit.toObject();

      const serviceTypeCode = visit.serviceId?.service_procedure_code || null;
      const serviceTypeName = visit.serviceId?.service_name || null;

      if (!visit.serviceId) {
      }

      return {
        hcm: {
          id: visit.hcmId?._id || null,
          name: visit.hcmId?.name || null,
        },
        tenant: {
          id: visit.tenantId?._id || null,
          name: visit.tenantId?.name || null,
        },
        serviceType: serviceTypeName || serviceTypeCode || 'Unknown', // Prefer name, fallback to code
        date: visit.date,
        startTime: visit.startTime,
        endTime: visit.endTime,
        status: visit.status,
        companyId,
        notes: visit.notes,
        response: visit.response,
        activity: visit.activity,
        methodOfContact: visit.methodOfContact,
      };
    });

    res.status(200).json({
      success: true,
      message: 'Visit history fetched successfully',
      response: formattedVisits,
    });
  } catch (error) {
    console.error('Error fetching visit data:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching visit history data.',
      response: error.message,
    });
  }
};

export const updateTenant = async (req, res) => {
  try {
    const requestData =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { email, updatedById, tenantData, companyId } = requestData;
    const existingUser = await users.findOne({ email, companyId });

    if (existingUser && existingUser.info_id !== '') {
      const existingInfo = await tenantInfo.findById(existingUser.info_id);

      const updatedPersonalInfo = {
        firstName:
          tenantData.personalInfo?.firstName ||
          existingInfo.personalInfo?.firstName,
        middleName:
          tenantData.personalInfo?.middleName ||
          existingInfo.personalInfo?.middleName,
        lastName:
          tenantData.personalInfo?.lastName ||
          existingInfo.personalInfo?.lastName,
        dob: tenantData.personalInfo?.dob || existingInfo.personalInfo?.dob,
        gender:
          tenantData.personalInfo?.gender || existingInfo.personalInfo?.gender,
        maPMINumber:
          tenantData.personalInfo?.maPMINumber ||
          existingInfo.personalInfo?.maPMINumber,
        email:
          tenantData.personalInfo?.email || existingInfo.personalInfo?.email,
        race: tenantData.personalInfo?.race || existingInfo.personalInfo?.race,
        ethnicity:
          tenantData.personalInfo?.ethnicity ||
          existingInfo.personalInfo?.ethnicity,
      };
      const updatedInsuranceData = {
        insurance:
          tenantData.admissionInfo?.insurance ||
          existingInfo.admissionInfo?.insurance,
        insuranceNumber:
          tenantData.admissionInfo?.insuranceNumber ||
          existingInfo.admissionInfo?.insuranceNumber,
        ssn: tenantData.admissionInfo?.ssn || existingInfo.admissionInfo?.ssn,
        intakeDate:
          tenantData.admissionInfo?.intakeDate ||
          existingInfo.admissionInfo?.intakeDate,
        letGoDate:
          tenantData.admissionInfo?.letGoDate ||
          existingInfo.admissionInfo?.letGoDate,
        letGoReason:
          tenantData.admissionInfo?.letGoReason ||
          existingInfo.admissionInfo?.letGoReason,
        diagnosisCode:
          tenantData.admissionInfo?.diagnosisCode ||
          existingInfo.admissionInfo?.diagnosisCode,
      };
      const updatedMailingAddress = {
        line1:
          tenantData.mailingAddress?.line1 ||
          existingInfo.mailingAddress?.line1,
        line2:
          tenantData.mailingAddress?.line2 ||
          existingInfo.mailingAddress?.line2,
        city:
          tenantData.mailingAddress?.city || existingInfo.mailingAddress?.city,
        state:
          tenantData.mailingAddress?.state ||
          existingInfo.mailingAddress?.state,
        zipCode:
          tenantData.mailingAddress?.zipCode ||
          existingInfo.mailingAddress?.zipCode,
      };

      const updatedEmergencyContact = {
        firstName:
          tenantData.emergencyContact?.firstName ||
          existingInfo.emergencyContact?.firstName,
        middleName:
          tenantData.emergencyContact?.middleName ||
          existingInfo.emergencyContact?.middleName,
        lastName:
          tenantData.emergencyContact?.lastName ||
          existingInfo.emergencyContact?.lastName,
        phoneNumber:
          tenantData.emergencyContact?.phoneNumber ||
          existingInfo.emergencyContact?.phoneNumber,
        email:
          tenantData.emergencyContact?.email ||
          existingInfo.emergencyContact?.email,
        relationship:
          tenantData.emergencyContact?.relationship ||
          existingInfo.emergencyContact?.relationship,
      };
      const contactInfo = {
        phoneNumber:
          tenantData.contactInfo?.phoneNumber ||
          existingInfo.contactInfo?.phoneNumber,
        email: tenantData.contactInfo?.email || existingInfo.contactInfo?.email,
        homePhone:
          tenantData.contactInfo?.homePhone ||
          existingInfo.contactInfo?.homePhone,
        cellPhone:
          tenantData.contactInfo?.cellPhone ||
          existingInfo.contactInfo?.cellPhone,
        race: tenantData.contactInfo?.race || existingInfo.contactInfo?.race,
        ethnicity:
          tenantData.contactInfo?.ethnicity ||
          existingInfo.contactInfo?.ethnicity,
      };
      const updatedResponsibleParty = {
        firstName:
          tenantData.responsibleParty?.firstName ||
          existingInfo.responsibleParty?.firstName,
        middleInitial:
          tenantData.responsibleParty?.middleInitial ||
          existingInfo.responsibleParty?.middleInitial,
        lastName:
          tenantData.responsibleParty?.lastName ||
          existingInfo.responsibleParty?.lastName,
        phoneNumber:
          tenantData.responsibleParty?.phoneNumber ||
          existingInfo.responsibleParty?.phoneNumber,
        email:
          tenantData.responsibleParty?.email ||
          existingInfo.responsibleParty?.email,
        relationship:
          tenantData.responsibleParty?.relationship ||
          existingInfo.responsibleParty?.relationship,
      };
      const updatedCaseManager = {
        firstName:
          tenantData.caseManager?.firstName ||
          existingInfo.caseManager?.firstName,
        middleName:
          tenantData.caseManager?.middleName ||
          existingInfo.caseManager?.middleName,
        lastName:
          tenantData.caseManager?.lastName ||
          existingInfo.caseManager?.lastName,
        phoneNumber:
          tenantData.caseManager?.phoneNumber ||
          existingInfo.caseManager?.phoneNumber,
        email: tenantData.caseManager?.email || existingInfo.caseManager?.email,
      };
      const updatedAddress = {
        addressLine1:
          tenantData.address?.addressLine1 ||
          existingInfo.address?.addressLine1,
        addressLine2:
          tenantData.address?.addressLine2 ||
          existingInfo.address?.addressLine2,
        city: tenantData.address?.city || existingInfo.address?.city,
        state: tenantData.address?.state || existingInfo.address?.state,
        zipCode: tenantData.address?.zipCode || existingInfo.address?.zipCode,
        mailingSameAsAbove:
          tenantData.address?.mailingSameAsAbove ||
          existingInfo.address?.mailingSameAsAbove,
        mailingDifferent:
          tenantData.address?.mailingDifferent ||
          existingInfo.address?.mailingDifferent,
      };
      const updatedLoginInfo = {
        userName:
          tenantData.loginInfo?.userName || existingInfo.loginInfo?.userName,
        password:
          tenantData.loginInfo?.password || existingInfo.loginInfo?.password,
      };
      const updatedAssessmentInfo = {
        barriers:
          tenantData.assessment?.barriers || existingInfo.assessment?.barriers,
        supportsNeeded:
          tenantData.assessment?.supportsNeeded ||
          existingInfo.assessment?.supportsNeeded,
      };

      const updatedTenantInfo = {
        personalInfo: updatedPersonalInfo,
        address: updatedAddress,
        contactInfo: contactInfo,
        emergencyContact: updatedEmergencyContact,
        admissionInfo: updatedInsuranceData,
        caseManager: updatedCaseManager,
        mailingAddress: updatedMailingAddress,
        loginInfo: updatedLoginInfo,
        responsibleParty: updatedResponsibleParty,
        assessment: updatedAssessmentInfo,
      };

      const updatedInfo = await tenantInfo.findByIdAndUpdate(
        existingUser.info_id,
        { $set: updatedTenantInfo },
        {
          new: true,
          runValidators: true,
          upsert: false,
        }
      );

      const nameParts = [];
      if (updatedTenantInfo.personalInfo?.firstName)
        nameParts.push(
          updatedTenantInfo.personalInfo?.firstName ||
            existingUser.personalInfo?.firstName
        );
      if (updatedTenantInfo.personalInfo?.middleName)
        nameParts.push(
          updatedTenantInfo.personalInfo?.middleName ||
            existingUser.personalInfo?.middleName
        );
      if (updatedTenantInfo.personalInfo?.lastName)
        nameParts.push(
          updatedTenantInfo.personalInfo?.lastName ||
            existingUser.personalInfo?.lastName
        );
      const name = nameParts.join(' ');

      const userUpdateData = {};
      if (name) userUpdateData.name = name;
      if (updatedTenantInfo.personalInfo?.email)
        userUpdateData.email =
          updatedTenantInfo.personalInfo.email ||
          existingUser.personalInfo.email;
      if (updatedTenantInfo.contactInfo?.phoneNumber)
        userUpdateData.phoneNo =
          updatedTenantInfo.contactInfo.phoneNumber ||
          existingUser.contactInfo.phoneNumber;
      if (updatedTenantInfo.contactInfo?.email)
        userUpdateData.email =
          updatedTenantInfo.contactInfo.email || existingUser.contactInfo.email;

      const updatedUser = await users.findByIdAndUpdate(
        existingUser._id,
        { $set: userUpdateData },
        {
          new: true,
          runValidators: true,
        }
      );
      // Update all EDI files that contain this tenant's information
      const ediUpdateResult = await updateTenantBillsAndEDI(existingUser._id);
      if (!ediUpdateResult.success) {
        console.error('Failed to update EDI files:', ediUpdateResult.message);
      }

      return res.status(200).json({
        success: true,
        message: 'Existing tenant data updated successfully.',
        response: {
          tenantID: existingUser._id,
          tenantData: updatedInfo,
          userData: updatedUser,
        },
      });
    } else {
      res
        .status(400)
        .json({ success: false, message: 'Tenant not found.', response: null });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error updating tenant data',
      response: error.message,
    });
  }
};

export const deleteTenant = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedTenant = await users.findByIdAndDelete(id);
    const deletedTenantInfo = await tenantInfo.findByIdAndDelete(
      deletedTenant.info_id
    );
    res.status(200).json({
      success: true,
      message: 'Tenant deleted successfully',
      response: {
        'deleted tenant': deletedTenant,
        'deleted tenant info': deletedTenantInfo,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error deleting tenant',
      response: error.message,
    });
  }
};

export const tenantProfileEditHistory = async (req, res) => {
  try {
    const { tenantId } = req.body;
    const history = await TenantHistory.find({ tenantId });
    res.status(200).json({
      success: true,
      message: 'Tenant profile edit history fetched successfully',
      response: history,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching tenant profile edit history',
      response: error.message,
    });
  }
};

export const assignServicesAndDocuments = async (req, res) => {
  try {
    const { companyId, services } = req.body;
    if (!companyId || !Array.isArray(services) || services.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Company ID and services list are required',
      });
    }

    const serviceRecords = [];

    for (const serviceData of services) {
      const {
        tenantId,
        serviceId,
        serviceType,
        serviceName,
        startDate,
        endDate,
        unitsRemaining,
        totalUnits,
        billRate,
        saNumber,
        insurance,
      } = serviceData;

      if (
        !tenantId ||
        !serviceType ||
        !startDate ||
        !endDate ||
        !unitsRemaining ||
        !totalUnits ||
        !billRate
      ) {
        return res.status(400).json({
          success: false,
          message: 'All service fields are required',
        });
      }

      if (!mongoose.Types.ObjectId.isValid(tenantId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid tenant ID format',
        });
      }

      const tenant = await users.findById(tenantId);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          message: 'Tenant not found',
        });
      }

      try {
        const newServiceTracking = new ServiceTracking({
          tenantId,
          serviceId,
          serviceType: serviceType,
          serviceTypeName: serviceName,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          unitsRemaining: Number(unitsRemaining),
          totalUnits: Number(totalUnits),
          billRate: Number(billRate),
          saNumber: saNumber || '',
          insurance: insurance || '',
          hcms: [], // Initialize as empty array
          companyId, // Include companyId in each service record
        });

        serviceRecords.push(newServiceTracking);
      } catch (mappingError) {
        console.error('Error mapping service type:', mappingError);
        return res.status(400).json({
          success: false,
          message: `Service type mapping error: ${mappingError.message}`,
        });
      }
    }
    // Save all services in one go for efficiency
    await ServiceTracking.insertMany(serviceRecords);

    res.status(200).json({
      success: true,
      message: 'Services assigned successfully',
      response: serviceRecords,
    });
  } catch (error) {
    console.error('Error in assignServicesAndDocuments:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error assigning services',
    });
  }
};

// Add a new controller to update service status
export const updateServiceStatus = async (req, res) => {
  try {
    const { serviceId, status, reviewStatus } = req.body;

    // Validate serviceId presence
    if (!serviceId) {
      return res.status(400).json({
        success: false,
        message: 'Service ID is required',
      });
    }

    // Validate serviceId format
    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid service ID format',
      });
    }

    // Validate at least one status is being updated
    if (!status && !reviewStatus) {
      return res.status(400).json({
        success: false,
        message: 'Either status or reviewStatus must be provided',
      });
    }

    // Validate status values if provided
    if (
      status &&
      !['pending', 'active', 'completed', 'cancelled'].includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value',
      });
    }

    // Validate reviewStatus values if provided
    if (
      reviewStatus &&
      !['pending', 'approved', 'rejected'].includes(reviewStatus)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid reviewStatus value',
      });
    }

    // Rest of your existing implementation...
    const service = await TenantService.findById(serviceId);
    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found',
      });
    }

    if (status) service.status = status;
    if (reviewStatus) service.reviewStatus = reviewStatus;

    const updatedService = await service.save();

    res.status(200).json({
      success: true,
      message: 'Service status updated successfully',
      response: updatedService,
    });
  } catch (error) {
    console.error('Error in updateServiceStatus:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error updating service status',
    });
  }
};

// Get all services and documents for a tenant
export const getServicesAndDocuments = async (req, res) => {
  try {
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(303).json({
        success: false,
        message: 'Tenant ID is required',
      });
    }

    // Validate tenantId format
    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(303).json({
        success: false,
        message: 'Invalid tenant ID format',
      });
    }

    // Check if tenant exists
    const tenant = await users.findById(tenantId);
    if (!tenant) {
      return res.status(303).json({
        success: false,
        message: 'Tenant not found',
      });
    }

    // Find all services for this tenant with populated tenant details
    const services = await serviceTracking
      .find({ tenantId })
      .populate({
        path: 'tenantId',
        select: 'name email phoneNo',
        model: 'users',
      })
      .sort({ createdAt: -1 }); // Sort by newest first

    // Format the response
    const formattedServices = services.map((service) => ({
      ...service.toObject(),
      tenantDetails: service.tenantId,
    }));

    if (!services || services.length === 0) {
      return res.status(303).json({
        success: false,
        message: 'No services found for this tenant',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Services fetched successfully',
      response: formattedServices,
    });
  } catch (error) {
    console.error('Error in getServicesAndDocuments:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching services',
    });
  }
};

export const createAppointment = async (req, res) => {
  try {
    const appointmentData =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const {
      tenantId,
      hcmId,
      date,
      startTime,
      endTime,
      activity,
      methodOfContact,
      reasonForRemote,
      placeOfService,
      serviceType,
      companyId,
    } = appointmentData;

    // Validate required fields
    if (
      !tenantId ||
      !hcmId ||
      !date ||
      !startTime ||
      !endTime ||
      !activity ||
      !methodOfContact ||
      !placeOfService ||
      !serviceType
    ) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    // Validate IDs
    if (
      !mongoose.Types.ObjectId.isValid(tenantId) ||
      !mongoose.Types.ObjectId.isValid(hcmId)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tenant ID or HCM ID format',
      });
    }

    // Check if tenant and HCM exist
    const [tenant, hcm] = await Promise.all([
      users.findById(tenantId),
      users.findById(hcmId),
    ]);

    if (!tenant || !hcm) {
      return res.status(404).json({
        success: false,
        message: 'Tenant or HCM not found',
      });
    }

    // Validate methodOfContact and reasonForRemote
    if (methodOfContact === 'remote' && !reasonForRemote) {
      return res.status(400).json({
        success: false,
        message: 'Reason for remote contact is required when method is remote',
      });
    }

    // Validate date format and ensure it's not in the past
    const appointmentDate = new Date(date);
    if (isNaN(appointmentDate) || appointmentDate < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date or date is in the past',
      });
    }

    // Parse startTime and endTime as Date objects
    const appointmentStartTime = new Date(startTime);
    const appointmentEndTime = new Date(endTime);

    // Ensure startTime is before endTime
    if (appointmentStartTime >= appointmentEndTime) {
      return res.status(400).json({
        success: false,
        message: 'Start time must be before end time.',
        response: null,
      });
    }

    // Calculate the duration in hours
    const durationInHours =
      (appointmentEndTime - appointmentStartTime) / (1000 * 60 * 60);

    // Get service details and calculate units dynamically
    const { serviceRate, defaultUnits, unitsToAdd, serviceId } =
      await getServiceDetailsAndCalculateUnits(serviceType, durationInHours);

    if (!serviceId) {
      console.warn(
        `Service not found in database for serviceType: ${serviceType}, using fallback values`
      );
    }

    // Find the service tracking record
    let serviceTracking = await ServiceTracking.findOne({
      tenantId,
      serviceType,
    });
    if (!serviceTracking) {
      // Create a new service tracking record with default values
      const startDate = new Date();
      const endDate = new Date();
      endDate.setFullYear(endDate.getFullYear() + 1); // Set end date to one year from now

      serviceTracking = new ServiceTracking({
        tenantId,
        serviceType,
        serviceId: serviceId, // Store the actual service ID
        startDate,
        endDate,
        unitsRemaining: defaultUnits - unitsToAdd,
        totalUnits: defaultUnits,
        billRate: serviceRate,
        scheduledUnits: unitsToAdd,
        hcmIds: [
          {
            hcmId,
            serviceDetails: [
              {
                dateOfService: appointmentDate,
                scheduledUnits: unitsToAdd,
                workedUnits: 0, // Initially 0, will be updated after the appointment
                methodOfContact,
                placeOfService,
              },
            ],
          },
        ],
        companyId,
      });

      await serviceTracking.save();
    } else {
      // Check if there are enough units available
      if (
        serviceTracking.scheduledUnits + unitsToAdd >
        serviceTracking.unitsRemaining
      ) {
        return res.status(400).json({
          success: false,
          message: 'Not enough units available to schedule this appointment.',
          response: serviceTracking,
        });
      }

      // Update scheduledUnits
      serviceTracking.scheduledUnits += unitsToAdd;
      serviceTracking.unitsRemaining -= unitsToAdd;

      // Find the HCM entry and add the service detail
      const hcmEntry = serviceTracking.hcmIds.find(
        (hcm) => hcm.hcmId && hcm.hcmId.toString() === hcmId
      );
      if (hcmEntry) {
        hcmEntry.serviceDetails.push({
          dateOfService: appointmentDate,
          scheduledUnits: unitsToAdd,
          workedUnits: 0, // Initially 0, will be updated after the appointment
          methodOfContact,
          placeOfService,
        });
      } else {
        // If HCM entry doesn't exist, create a new one
        serviceTracking.hcmIds.push({
          hcmId,
          serviceDetails: [
            {
              dateOfService: appointmentDate,
              scheduledUnits: unitsToAdd,
              workedUnits: 0, // Initially 0, will be updated after the appointment
              methodOfContact,
              placeOfService,
            },
          ],
        });
      }

      await serviceTracking.save();
    }

    // Create appointment data only if units are available
    const newAppointment = new HcmAppointments({
      tenantId,
      hcmId,
      date: appointmentDate,
      startTime: appointmentStartTime,
      endTime: appointmentEndTime,
      activity,
      methodOfContact,
      reasonForRemote:
        methodOfContact === 'remote' ? reasonForRemote : undefined,
      placeOfService,
      serviceType,
      approved: false,
      status: 'pending',
      companyId,
    });

    // Save the appointment
    const savedAppointment = await newAppointment.save();

    // Fetch the saved appointment with populated fields
    const populatedAppointment = await HcmAppointments.findById(
      savedAppointment._id
    )
      .populate({
        path: 'hcmId',
        select: 'name email phoneNo',
        model: 'causers',
      })
      .populate({
        path: 'tenantId',
        select: 'name email phoneNo',
        model: 'causers',
      });

    // Format the response to include user details and service tracking
    const formattedResponse = {
      appointmentData: populatedAppointment.toObject(),
      hcmDetails: populatedAppointment.hcmId,
      tenantDetails: populatedAppointment.tenantId,
      serviceTracking: serviceTracking,
    };

    res.status(200).json({
      success: true,
      message: 'Appointment created successfully',
      response: formattedResponse,
    });
  } catch (error) {
    console.error('Error in createAppointment:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating appointment',
    });
  }
};

export const getAllTenants = async (req, res) => {
  try {
    const { companyId } = req.params;
    let { serviceType, insuranceType, city, movedOut } = req.query;

    const companyObjectId = new mongoose.Types.ObjectId(companyId);

    /* ---------------- movedOut filter ---------------- */
    let movedOutFilter = {};
    if (movedOut) {
      const values = movedOut.split(',').map((v) => v.trim().toLowerCase());
      if (!values.includes('true')) movedOutFilter.movedOut = false;
      if (!values.includes('false')) movedOutFilter.movedOut = true;
    } else {
      movedOutFilter.movedOut = false;
    }

    /* ---------------- base query ---------------- */
    const baseQuery = {
      role: 0,
      companyId: companyObjectId,
      ...movedOutFilter,
    };

    const serviceTypesArray = serviceType
      ? serviceType.split(',').map((s) => s.trim().toLowerCase())
      : [];

    const insuranceTypesArray = insuranceType
      ? insuranceType.split(',').map((i) => i.trim().toLowerCase())
      : [];

    /* ---------------- fetch tenants ---------------- */
    const tenants = await users.find(baseQuery).lean();
    if (!tenants.length) {
      return res.status(200).json({
        success: true,
        message: 'Tenants fetched successfully',
        response: { tenantsRecords: [], cities: [] },
      });
    }

    const tenantIds = tenants.map((t) => t._id);
    const infoIds = tenants.map((t) => t.info_id).filter(Boolean);

    /* ---------------- fetch tenantInfo in bulk ---------------- */
    const tenantInfos = await tenantInfo
      .find(
        { _id: { $in: infoIds } },
        {
          'admissionInfo.insurance': 1,
          'admissionInfo.insuranceNumber': 1,
          'personalInfo.maPMINumber': 1,
          'address.city': 1,
        }
      )
      .lean();

    const tenantInfoMap = new Map(
      tenantInfos.map((info) => [info._id.toString(), info])
    );

    /* ---------------- fetch serviceTracking in bulk ---------------- */
    const serviceTrackingDocs = await ServiceTracking.find(
      { tenantId: { $in: tenantIds } },
      { tenantId: 1, serviceTypeName: 1 }
    ).lean();

    /* ---------------- group services by tenant ---------------- */
    const tenantServicesMap = new Map();

    for (const s of serviceTrackingDocs) {
      if (!s.serviceTypeName) continue;

      const tenantId = s.tenantId.toString();
      const serviceName = s.serviceTypeName.toLowerCase();

      if (!tenantServicesMap.has(tenantId)) {
        tenantServicesMap.set(tenantId, new Set());
      }

      tenantServicesMap.get(tenantId).add(serviceName);
    }

    /* ---------------- build response ---------------- */
    const tenantsRecords = [];
    const cities = new Set();

    for (const tenant of tenants) {
      const info = tenantInfoMap.get(tenant.info_id?.toString());
      if (!info) continue;

      const tenantCity = info?.address?.city || '';
      const tenantInsurance =
        info?.admissionInfo?.insurance?.toLowerCase() || '';

      /* city filter */
      if (city && tenantCity.toLowerCase() !== city.toLowerCase()) continue;

      /* insurance filter */
      if (
        insuranceTypesArray.length &&
        !insuranceTypesArray.includes(tenantInsurance)
      )
        continue;

      const servicesSet =
        tenantServicesMap.get(tenant._id.toString()) || new Set();

      /* service type filter */
      if (
        serviceTypesArray.length &&
        !serviceTypesArray.some((type) => servicesSet.has(type))
      )
        continue;

      cities.add(tenantCity);

      tenantsRecords.push({
        id: tenant._id,
        name: tenant.name,
        email: tenant.email,
        phoneNo: tenant.phoneNo,
        city: tenantCity,
        insurance: tenantInsurance,
        insuranceNumber: info?.admissionInfo?.insuranceNumber || '',
        maPMINumber: info?.personalInfo?.maPMINumber || '',
        services: Array.from(servicesSet),
        movedOut: tenant.movedOut,
        profileImageUrl: tenant.profileImageUrl || null,
        profileImageKey: tenant.profileImageKey || null,
      });
    }

    /* ---------------- response ---------------- */
    return res.status(200).json({
      success: true,
      message: 'Tenants fetched successfully',
      response: {
        tenantsRecords,
        cities: Array.from(cities),
      },
    });
  } catch (error) {
    console.error('Error in getAllTenants:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching tenants',
    });
  }
};

export const getTenantNamesByCompany = async (req, res) => {
  const { companyId } = req.params;

  try {
    // Step 1: Validate companyId
    if (!companyId) {
      return res
        .status(400)
        .json({ success: false, message: 'Company ID is required.' });
    }

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid Company ID format.' });
    }

    const companyObjectId = new mongoose.Types.ObjectId(companyId);

    // Step 2: Fetch tenants belonging to the company
    const tenants = await users
      .find({ role: 0, companyId: companyObjectId, movedOut: false })
      .select('_id name info_id email');

    if (!tenants.length) {
      return res.status(200).json({
        success: true,
        message: 'No tenants found for this company',
        response: [],
      });
    }

    const tenantIds = tenants.map((t) => t._id);

    // Step 3: Fetch all ServiceTracking docs for these tenants
    const serviceTrackings = await ServiceTracking.find({
      tenantId: { $in: tenantIds },
    }).select(
      'tenantId serviceId startDate endDate methodOfContact coveredParentActivities'
    );

    if (!serviceTrackings.length) {
      const response = tenants.map((tenant) => ({
        _id: tenant._id,
        name: tenant.name,
        email: tenant.email,
        info_id: tenant.info_id,
        services: [],
      }));

      return res.status(200).json({
        success: true,
        message: 'No services found for these tenants.',
        response,
      });
    }

    // Step 4: Extract unique serviceIds
    const serviceIds = [
      ...new Set(serviceTrackings.map((tracking) => tracking.serviceId)),
    ];

    // Step 5: Fetch service details from Services collection
    const serviceDetails = await Service.find({
      _id: { $in: serviceIds },
    })
      .select(
        'service_name service_type service_duration service_procedure_code service_modifiers service_rate visit_frequency covered_parent_activities place_of_service'
      )
      .lean();

    // Step 6: Map tenants to their enriched services
    const tenantsWithServices = tenants.map((tenant) => {
      // Find all serviceTrackings for this tenant
      const tenantTrackings = serviceTrackings.filter(
        (tracking) => tracking.tenantId.toString() === tenant._id.toString()
      );

      // Merge service info for each tracking
      const mappedServices = tenantTrackings.map((tracking) => {
        const service = serviceDetails.find(
          (s) => s?._id?.toString() === tracking?.serviceId?.toString()
        );

        return {
          serviceId: tracking.serviceId,
          startDate: tracking.startDate,
          endDate: tracking.endDate,
          serviceTypeName: service?.service_name || null,
          coveredParentActivities: service?.covered_parent_activities || null,
          visitFrequency: service?.visit_frequency || null,
          placeOfService: service?.place_of_service || null,
        };
      });

      return {
        _id: tenant._id,
        name: tenant.name,
        email: tenant.email,
        info_id: tenant.info_id,
        services: mappedServices,
      };
    });

    // Step 7: Sort tenants alphabetically
    tenantsWithServices.sort((a, b) => a.name.localeCompare(b.name));

    // Step 8: Send response
    return res.status(200).json({
      success: true,
      message: 'Tenants with services fetched successfully for this company.',
      response: tenantsWithServices,
    });
  } catch (error) {
    console.error('Error in getTenantNamesByCompany:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching tenants and services.',
      error: error.message || error,
    });
  }
};

export const getTenant = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate if id exists
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required',
      });
    }

    // Validate if id is a valid ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tenant ID format',
      });
    }

    const tenantId = new mongoose.Types.ObjectId(id);
    const tenant = await users.findById(tenantId);

    // Check if tenant exists
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found',
      });
    }

    const tenantInfoRecord = await tenantInfo.findOne({ _id: tenant.info_id });

    return res.status(200).json({
      success: true,
      message: 'Tenant fetched successfully',
      response: {
        tenant: tenant,
        tenantInfo: tenantInfoRecord,
      },
    });
  } catch (error) {
    console.error('Error in getTenant:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching tenant',
      error: error.message || error,
    });
  }
};

export const getTenantChartInfo = async (req, res) => {
  try {
    const { companyId } = req.params;

    // Find all tenants with role 0
    const tenants = await users.find({ role: 0, companyId });
    // Initialize the data structure for the response
    const data = {};

    // Process each tenant
    tenants.forEach((tenant) => {
      const year = new Date().getFullYear().toString();
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

      if (tenant.movedOut) {
        const movedOutDate = new Date(tenant.movedOutDate);
        const month = monthNames[movedOutDate.getMonth()];
        const year = movedOutDate.getFullYear().toString();

        if (!data[year]) {
          data[year] = {};
        }
        if (!data[year][month]) {
          data[year][month] = { movedOut: 0, receivingServices: 0 };
        }
        data[year][month].movedOut++;
      } else {
        const currentMonth = monthNames[new Date().getMonth()];
        if (!data[year]) {
          data[year] = {};
        }
        if (!data[year][currentMonth]) {
          data[year][currentMonth] = { movedOut: 0, receivingServices: 0 };
        }
        data[year][currentMonth].receivingServices++;
      }
    });

    res.status(200).json({
      success: true,
      message: 'Tenant info fetched successfully',
      response: data,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const tenantReassessments = async (req, res) => {
  try {
    const { companyId } = req.params;

    const tenants = await ServiceTracking.find({ companyId })
      .populate({
        path: 'tenantId',
        select: '_id name email',
        model: 'causers',
      })
      .populate({
        path: 'hcms.hcmId',
        select: '_id name email',
        model: 'causers',
      });

    const today = new Date();
    const dayCounts = { 90: 0, 60: 0, 30: 0, 15: 0, 5: 0 };
    const reassessmentData = { 90: [], 60: [], 30: [], 15: [], 5: [] };

    tenants.forEach((tenant) => {
      if (tenant.endDate) {
        const endDate = new Date(tenant.endDate);
        const diffTime = endDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= 90) {
          dayCounts['90']++;
          reassessmentData['90'].push(
            createReassessmentDetail(tenant, diffDays)
          );
        }
        if (diffDays <= 60) {
          dayCounts['60']++;
          reassessmentData['60'].push(
            createReassessmentDetail(tenant, diffDays)
          );
        }
        if (diffDays <= 30) {
          dayCounts['30']++;
          reassessmentData['30'].push(
            createReassessmentDetail(tenant, diffDays)
          );
        }
        if (diffDays <= 15) {
          dayCounts['15']++;
          reassessmentData['15'].push(
            createReassessmentDetail(tenant, diffDays)
          );
        }
        if (diffDays <= 5) {
          dayCounts['5']++;
          reassessmentData['5'].push(
            createReassessmentDetail(tenant, diffDays)
          );
        }
      } else {
        console.warn(`End date is undefined for tenant with ID: ${tenant._id}`);
      }
    });

    res.status(200).json({
      success: true,
      message: 'Tenant reassessments fetched successfully',
      response: {
        reassessmentData,
        dayCounts,
      },
    });
  } catch (error) {
    console.error('Error in tenantReassessments:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

function createReassessmentDetail(tenant, diffDays) {
  return {
    tenantId: tenant.tenantId ? tenant.tenantId._id : '-',
    tenantName: tenant.tenantId ? tenant.tenantId.name : '-',
    tenantEmail: tenant.tenantId ? tenant.tenantId.email : '-',
    serviceType: tenant.serviceType,
    serviceTypeName: tenant.serviceTypeName || '-',
    daysLeft: diffDays,
    period:
      tenant.startDate && tenant.endDate
        ? `${tenant.startDate.toISOString().split('T')[0]} to ${
            tenant.endDate.toISOString().split('T')[0]
          }`
        : '-',
    hcmDetails: tenant.hcms.map((hcm) => ({
      hcmId: hcm.hcmId ? hcm.hcmId._id : '-',
      hcmName: hcm.hcmId ? hcm.hcmId.name : '-',
      hcmEmail: hcm.hcmId ? hcm.hcmId.email : '-',
    })),
    unitsLeft: tenant.unitsRemaining || 0,
    scheduledUnits: tenant.scheduledUnits || 0,
  };
}

// Assign or Unassign HCMs to a Tenant
export const assignHcmsToTenant = async (req, res) => {
  try {
    const { tenantId, hcmIds, companyId, action = 'assign' } = req.body;
    // Validate input
    if (!tenantId || !hcmIds || !Array.isArray(hcmIds) || !companyId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID, an array of HCM IDs, and company ID are required',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Tenant ID format',
      });
    }

    for (const hcmId of hcmIds) {
      if (!mongoose.Types.ObjectId.isValid(hcmId)) {
        return res.status(400).json({
          success: false,
          message: `Invalid HCM ID format: ${hcmId}`,
        });
      }
    }

    let assignment = await hcmAssignedToTenant.findOne({ tenantId, companyId });

    if (action === 'assign') {
      // Assign HCMs to Tenant
      if (assignment) {
        const hcmIdStrings = hcmIds.map((id) => id.toString());
        let addedCount = 0;
        hcmIds.forEach((hcmId) => {
          if (
            !assignment.hcmIds.some((id) => id.toString() === hcmId.toString())
          ) {
            assignment.hcmIds.push(hcmId);
            addedCount++;
          }
        });
        if (addedCount > 0) {
          await assignment.save();
        }
      } else {
        assignment = new hcmAssignedToTenant({
          tenantId,
          hcmIds,
          companyId,
        });
        await assignment.save();
      }

      // Bulk update tenantAssignedtoHcm
      for (const hcmId of hcmIds) {
        let hcmAssignment = await tenantAssignedtoHcm.findOne({ hcmId });
        if (hcmAssignment) {
          if (
            !hcmAssignment.tenantIds.some(
              (id) => id.toString() === tenantId.toString()
            )
          ) {
            hcmAssignment.tenantIds.push(tenantId);
            await hcmAssignment.save();
          }
        } else {
          hcmAssignment = new tenantAssignedtoHcm({
            hcmId,
            tenantIds: [tenantId],
          });
          await hcmAssignment.save();
        }
      }

      return res.status(200).json({
        success: true,
        message: 'HCMs assigned to tenant successfully',
        response: assignment,
      });
    } else if (action === 'unassign') {
      // Unassign HCMs from Tenant
      if (!assignment) {
        return res.status(404).json({
          success: false,
          message: 'No HCM assignments found for this tenant',
        });
      }

      const hcmIdStrings = hcmIds.map((id) => id.toString());
      const initialCount = assignment.hcmIds.length;
      assignment.hcmIds = assignment.hcmIds.filter(
        (hcmId) => !hcmIdStrings.includes(hcmId.toString())
      );

      if (assignment.hcmIds.length === initialCount) {
        return res.status(400).json({
          success: false,
          message: 'No matching HCMs found to unassign',
        });
      }

      await assignment.save();

      // Bulk update tenantAssignedtoHcm
      for (const hcmId of hcmIds) {
        let hcmAssignment = await tenantAssignedtoHcm.findOne({ hcmId });
        if (hcmAssignment) {
          hcmAssignment.tenantIds = hcmAssignment.tenantIds.filter(
            (id) => id.toString() !== tenantId.toString()
          );
          await hcmAssignment.save();
        }
      }

      return res.status(200).json({
        success: true,
        message: 'HCMs unassigned from tenant successfully',
        response: assignment,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "assign" or "unassign".',
      });
    }
  } catch (error) {
    console.error('Error in assignHcmsToTenant:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: 'Error processing HCM assignment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// Get Assigned HCMs to a Tenant
export const getAssignedHcmsToTenant = async (req, res) => {
  try {
    const { tenantId } = req.body;

    // Validate tenantId
    if (!tenantId) {
      return res
        .status(400)
        .json({ success: false, message: 'Tenant ID is required.' });
    }

    // Validate tenantId format
    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid Tenant ID format.' });
    }

    // Find the assignment for the given tenantId and populate complete HCM details
    const assignment = await hcmAssignedToTenant
      .findOne({ tenantId })
      .populate({
        path: 'hcmIds',
        model: 'causers',
      });

    if (!assignment) {
      return res
        .status(200)
        .json({ success: false, message: 'No HCMs assigned to this tenant.' });
    }

    // Return the complete user details
    return res.status(200).json({
      success: true,
      message: 'HCMs assigned to tenant fetched successfully',
      response: assignment.hcmIds,
    });
  } catch (error) {
    console.error('Error fetching assigned HCMs:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching assigned HCMs.',
      error: error.message || error,
    });
  }
};

export const getAssignedHcmsServices = async (req, res) => {
  try {
    const { tenantId } = req.body;
    const assignedHcms = await hcmAssignedToTenant
      .findOne({ tenantId })
      .populate({
        path: 'hcmIds',
        model: 'causers',
      });

    const services = await ServiceTracking.find({ tenantId });

    res.status(200).json({
      success: true,
      message: 'Assigned HCMs fetched successfully',
      response: { hcms: assignedHcms.hcmIds, services: services },
    });
  } catch (error) {
    console.error('Error in getAssignedHcmsServices:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching assigned HCMs services',
      error: error.message || error,
    });
  }
};

export const getTenantInfoById = async (req, res) => {
  try {
    const { tenantInfoId, companyId } = req.body;
    const tenantInformation = await tenantInfo.findById(tenantInfoId);
    return res.status(200).json({
      success: true,
      message: 'Tenant info fetched successfully',
      response: tenantInformation,
    });
  } catch (error) {
    console.error('Error in getTenantInfoById:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching tenant info',
      error: error.message || error,
    });
  }
};

export const createOrUpdateServiceTracking = async (
  tenantId,
  hcmId,
  serviceType,
  unitsToAdd,
  durationInHours,
  companyId
) => {
  // Get service details and dynamic values using helper function
  const { serviceRate, defaultUnits, serviceId } =
    await getServiceDetailsAndCalculateUnits(serviceType, durationInHours);

  // Find the service tracking record
  let serviceTracking = await ServiceTracking.findOne({
    tenantId,
    serviceType,
    companyId,
  });

  if (!serviceTracking) {
    // Create a new service tracking record with database values
    const startDate = new Date();
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 1); // Set end date to one year from now

    serviceTracking = new ServiceTracking({
      tenantId,
      serviceType,
      serviceId: serviceId, // Store the actual service ID
      startDate,
      endDate,
      unitsRemaining: defaultUnits - unitsToAdd,
      totalUnits: defaultUnits,
      billRate: serviceRate,
      scheduledUnits: unitsToAdd,
      workedUnits: unitsToAdd,
      workedHours: durationInHours,
      hcmIds: [
        { hcmId, workedUnits: unitsToAdd, workedHours: durationInHours },
      ],
    });

    await serviceTracking.save();
  } else {
    // Update scheduledUnits, workedUnits, and workedHours
    serviceTracking.scheduledUnits += unitsToAdd;
    serviceTracking.unitsRemaining -= unitsToAdd;
    serviceTracking.workedUnits += unitsToAdd;
    serviceTracking.workedHours += durationInHours;

    // Merge existing hcmIds with the new one
    const hcmEntry =
      serviceTracking.hcmIds.length === 1 ? serviceTracking.hcmIds[0] : null;
    if (hcmEntry && hcmEntry.hcmId === hcmId) {
      hcmEntry.workedUnits += unitsToAdd;
      hcmEntry.workedHours += durationInHours;
    } else {
      serviceTracking.hcmIds.push({
        hcmId,
        workedUnits: unitsToAdd,
        workedHours: durationInHours,
      });
    }

    await serviceTracking.save();
  }
};

export const addTenantNote = async (req, res) => {
  try {
    const { tenantId, content, notedBy, title } = req.body;

    // Find the tenant notes document
    let TenantNotes = await tenantNotes.findOne({ tenantId });

    if (!TenantNotes) {
      // If no document exists, create a new one
      TenantNotes = new tenantNotes({
        tenantId,
        notes: [
          {
            noteId: 1,
            content,
            notedBy,
            title,
          },
        ],
        noteCounter: 1,
      });
    } else {
      // Increment the note counter and add the new note
      const newNoteId = TenantNotes.noteCounter + 1;
      TenantNotes.notes.push({
        noteId: newNoteId,
        content,
        notedBy,
        title,
      });
      TenantNotes.noteCounter = newNoteId;
    }

    await TenantNotes.save();

    res.status(200).json({
      success: true,
      message: 'Note added successfully',
      response: {
        tenantNotes: TenantNotes,
      },
    });
  } catch (error) {
    console.error('Error adding note:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      response: error.message,
    });
  }
};

export const getTenantNotes = async (req, res) => {
  try {
    const { tenantId } = req.body;
    const tenantNotesDocument = await tenantNotes
      .findOne({ tenantId })
      .populate({
        path: 'notes.notedBy',
        select: '-accountSetup -passwordChangedAt',
      });

    if (!tenantNotesDocument) {
      return res
        .status(404)
        .json({ success: false, message: 'Tenant notes not found' });
    }

    // Refine the response to exclude _id, tenantId, noteCounter, and _id inside notes
    const refinedNotes = tenantNotesDocument.notes.map((note) => ({
      noteId: note.noteId,
      content: note.content,
      title: note.title,
      notedBy: note.notedBy,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }));

    return res.status(200).json({
      success: true,
      message: 'Tenant notes fetched successfully',
      response: {
        tenantNotes: refinedNotes,
      },
    });
  } catch (error) {
    console.error('Error fetching tenant notes:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching tenant notes',
      error: error.message || error,
    });
  }
};

export const deleteTenantNote = async (req, res) => {
  try {
    const { tenantId, noteId } = req.body;

    // Find the tenant notes document
    const TenantNotes = await tenantNotes.findOne({ tenantId });

    if (!TenantNotes) {
      return res
        .status(400)
        .json({ success: false, message: 'Tenant notes not found' });
    }

    // Find the index of the note to be deleted
    const noteIndex = TenantNotes.notes.findIndex(
      (note) => note.noteId === noteId
    );

    // Check if the note exists
    if (noteIndex === -1) {
      return res
        .status(400)
        .json({ success: false, message: 'Note not found' });
    }

    // Remove the note from the array
    TenantNotes.notes.splice(noteIndex, 1);

    // Save the updated document
    await TenantNotes.save();

    return res.status(200).json({
      success: true,
      message: 'Tenant note deleted successfully',
      response: {
        'deleted Note': TenantNotes,
      },
    });
  } catch (error) {
    console.error('Error deleting tenant note:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      response: error.message,
    });
  }
};

export const updateTenantNote = async (req, res) => {
  try {
    const { tenantId, noteId, content, notedBy, title } = req.body;

    // Convert noteId to a number
    const noteIdNumber = Number(noteId);

    // Find the tenant notes document
    const TenantNotes = await tenantNotes.findOne({ tenantId });

    if (!TenantNotes) {
      return res
        .status(400)
        .json({ success: false, message: 'Tenant notes not found' });
    }

    // Find the index of the note to be updated
    const noteIndex = TenantNotes.notes.findIndex(
      (note) => note.noteId === noteIdNumber
    );

    // Check if the note exists
    if (noteIndex === -1) {
      return res
        .status(400)
        .json({ success: false, message: 'Note not found' });
    }

    // Retrieve the existing note
    const existingNote = TenantNotes.notes[noteIndex];

    // Update the note content, notedBy, and title if provided
    existingNote.content = content || existingNote.content;
    existingNote.notedBy = notedBy || existingNote.notedBy;
    existingNote.title = title || existingNote.title;
    existingNote.updatedAt = new Date();
    // Save the updated document
    await TenantNotes.save();

    return res.status(200).json({
      success: true,
      message: 'Tenant note updated successfully',
      response: {
        'updated Note': existingNote,
      },
    });
  } catch (error) {
    console.error('Error updating tenant note:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      response: error.message,
    });
  }
};

export const tenantsRunningOutOfUnits = async (req, res) => {
  try {
    const { companyId } = req.params;
    const tenants = await ServiceTracking.find({
      companyId,
      unitsRemaining: { $lt: 100 },
    }).populate('tenantId', 'name'); // ✅ only fetch tenant name fields

    const filteredTenants = tenants.map((t) => ({
      tenantName: t.tenantId?.name || 'Unknown',
      serviceType: t.serviceType,
      serviceTypeName: t.serviceTypeName,
      unitsRemaining: t.unitsRemaining,
      insurance: t.insurance,
    }));

    res.status(200).json({
      success: true,
      message: 'Tenants running out of units fetched successfully',
      response: {
        tenants: filteredTenants,
        count: filteredTenants.length,
      },
    });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, response: error });
  }
};

// Moved Out Tenants
export const getAllMovedOutTenantsOfACompany = async (req, res) => {
  try {
    const { companyId } = req.params;

    const movedOutTenants = await users.find({ companyId, movedOut: true });
    res.status(200).json({
      success: true,
      message: 'Moved out tenants fetched successfully',
      response: movedOutTenants,
    });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, response: error });
  }
};
export const getAllMovedOutTenants = async (req, res) => {
  try {
    const movedOutTenants = await users.find({ movedOut: true });
    res.status(200).json({
      success: true,
      message: 'Moved out tenants fetched successfully',
      response: movedOutTenants,
    });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, response: error });
  }
};

export const moveTenantOut = async (req, res) => {
  try {
    const { tenantId, reason } = req.body;
    const tenant = await users.findById(tenantId);
    tenant.movedOut = true;
    tenant.movedOutDate = new Date();
    tenant.movedOutReason = reason;
    await tenant.save();
    res.status(200).json({
      success: true,
      message: 'Tenant moved out successfully',
      response: tenant,
    });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, response: error });
  }
};

export const isTenantMovedOut = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const tenant = await users.findById(tenantId);
    res.status(200).json({
      success: true,
      message: tenant.movedOut ? 'Tenant moved out' : 'Tenant not moved out',
      response: tenant.movedOut,
    });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, response: error });
  }
};

export const getAssignedHcmsWithServices = async (req, res) => {
  const { tenantId } = req.body;

  try {
    // Validate tenantId
    if (!tenantId) {
      return res
        .status(400)
        .json({ success: false, message: 'Tenant ID is required.' });
    }

    // Validate tenantId format
    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid Tenant ID format.' });
    }

    // Fetch assigned HCMs for the tenant
    const assignment = await hcmAssignedToTenant
      .findOne({ tenantId })
      .populate({
        path: 'hcmIds',
        model: 'causers',
        select: 'name _id', // Fetch only required fields
      });

    if (!assignment) {
      return res
        .status(200)
        .json({ success: false, message: 'No HCMs assigned to this tenant.' });
    }

    // Fetch services for the tenant and populate service details
    const services = await ServiceTracking.find({ tenantId })
      .populate({
        path: 'serviceId',
        model: 'Service',
        select:
          'service_name covered_parent_activities place_of_service serviceType state',
      })
      .select(
        'serviceType startDate serviceTypeName serviceId endDate methodOfContact'
      );
    // Enhance service types with additional metadata including covered_parent_activities and place_of_service
    const enhancedServices = services.map((service) => ({
      serviceType: service.serviceType,
      startDate: service.startDate,
      endDate: service.endDate,
      methodOfContact: service.methodOfContact,
      serviceId: service?.serviceId._id,
      serviceName: service.serviceTypeName,
      // Add the populated service details
      serviceDetails: service.serviceId
        ? {
            service_name: service.serviceId.service_name,
            covered_parent_activities:
              service.serviceId.covered_parent_activities || [],
            place_of_service: service.serviceId.place_of_service || [],
            serviceType: service.serviceId.serviceType,
            state: service.serviceId.state,
          }
        : null,
    }));

    // Map HCMs and enhanced services to the tenant
    const tenantWithHcmsAndServices = {
      _id: tenantId,
      hcms: assignment.hcmIds.map((hcm) => ({
        _id: hcm._id,
        name: hcm.name,
      })),
      services: enhancedServices,
    };

    return res.status(200).json({
      success: true,
      message:
        'Assigned HCMs and services with activities and place of service fetched successfully',
      response: tenantWithHcmsAndServices,
    });
  } catch (error) {
    console.error('Error fetching assigned HCMs and services:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching assigned HCMs and services.',
      error: error.message || error,
    });
  }
};

export const getAllServicesForTenant = async (req, res) => {
  try {
    const { tenantId } = req.params;

    // Fetch all service tracking documents for the given tenantId
    const services = await ServiceTracking.find({ tenantId });

    if (!services.length) {
      return res.status(200).json({
        success: true,
        message: 'No service records found for this tenant',
        response: [],
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Service records fetched successfully',
      response: services,
    });
  } catch (error) {
    console.error('Error in getServicesByTenant:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching service records',
    });
  }
};
