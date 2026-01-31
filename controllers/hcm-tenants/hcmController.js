import users from '../../models/account/users.js';
import bcrypt from 'bcrypt';
import HcmAppointments from '../../models/appointments-visits/appointments.js';
import Document from '../../models/communication-documents/document.js';
import mongoose from 'mongoose';
import tenantAssignedtoHcm from '../../models/hcm-tenants/tenantAssignedtoHcm.js';
import cloudinary from 'cloudinary';
import hcmInfo from '../../models/hcm-tenants/hcmInfo.js';
import Visits from '../../models/appointments-visits/visits.js';
import hcmAssignedToTenant from '../../models/hcm-tenants/hcmAssignedToTenant.js';
import { generateChatToken } from '../../utils/generateChatToken.js';
import Bills from '../../models/bills/bills.js';
import ServiceTracking from '../../models/bills/serviceTracking.js';
import Service from '../../models/services/services.js';
import { updateBillandEDI } from '../appointments-visits/vistiBillController.js';
//HCM Management Routes
const createHcm = async (req, res) => {
  try {
    const { hcmData, companyId } = req.body;
    const companyObjectId = new mongoose.Types.ObjectId(companyId);

    if (!hcmData.loginInfo || !hcmData.loginInfo.username) {
      return res
        .status(400)
        .json({ success: false, message: 'Email is required.' });
    }

    // Step 1: Check if a user already exists with the same email
    const existingUser = await users.findOne({
      email: hcmData.loginInfo.username,
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email already exists.',
      });
    } else {
      const newInfo = new hcmInfo({
        ...hcmData,
        employmentInfo: {
          ...hcmData.employmentInfo,
        },
        loginInfo: {
          username: hcmData.loginInfo.username,
          password: hcmData.loginInfo.password,
        },
        companyId: companyObjectId,
      });

      const savedInfo = await newInfo.save();

      // Step 3: Create a new user linked to the new info document
      const fullName = `${hcmData.personalInfo.firstName} ${hcmData.personalInfo.middleName} ${hcmData.personalInfo.lastName}`;
      const hashedPassword = await bcrypt.hash(hcmData.loginInfo.password, 10);

      const newUser = new users({
        name: fullName,
        email: hcmData.loginInfo.username,
        password: hashedPassword,
        phoneNo: hcmData.contactInfo.phoneNumber,
        info_id: savedInfo._id,
        role: 1,
        companyId: companyObjectId,
      });
      const hcmRecord = await newUser.save();

      const chatToken = generateChatToken(newUser._id.toString());

      // Step 4: Send success response
      return res.status(200).json({
        success: true,
        message:
          'HCM data recorded, Info record created, and User created successfully.',
        response: {
          hcm: hcmRecord,
          hcmInfo: savedInfo,
        },
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error creating HCM data',
    });
  }
};

const getHcm = async (req, res) => {
  try {
    const { id } = req.params;
    const hcmId = new mongoose.Types.ObjectId(id);
    // Fetch HCM details
    const hcm = await users.findById(hcmId);
    if (!hcm) {
      return res.status(404).json({
        success: false,
        message: 'HCM not found',
      });
    }

    // Fetch additional HCM info
    const hcmInfoRecord = await hcmInfo.findOne({ _id: hcm.info_id });

    const assignment = await tenantAssignedtoHcm.findOne({ hcmId });
    const assignedTenantsCount = assignment ? assignment.tenantIds.length : 0;

    return res.status(200).json({
      success: true,
      message: 'HCM fetched successfully',
      response: { hcm, hcmInfoRecord, assignedTenantsCount },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error fetching HCM data',
    });
  }
};

const getHcms = async (req, res) => {
  try {
    const { companyId } = req.params;
    const companyObjectId = new mongoose.Types.ObjectId(companyId);

    const hcms = await users.find({ role: 1, companyId: companyObjectId });
    const hcmsRecords = [];
    const cities = new Set();
    for (const hcm of hcms) {
      const hcmInfoRecord = await hcmInfo.findOne(
        { _id: hcm.info_id },
        {
          'employmentInfo.employmentTitle': 1,
          'addressInfo.city': 1,
        }
      );

      // Only add city if hcmInfoRecord exists and has addressInfo
      if (hcmInfoRecord && hcmInfoRecord.addressInfo?.city) {
        cities.add(hcmInfoRecord.addressInfo.city);
      }

      hcmsRecords.push({
        id: hcm._id,
        name: hcm.name,
        email: hcm.email,
        phoneNo: hcm.phoneNo,
        city: hcmInfoRecord?.addressInfo?.city || '',
        employmentTitle: hcmInfoRecord?.employmentInfo?.employmentTitle || '',
        profileImageUrl: hcm.profileImageUrl || null,
        profileImageKey: hcm.profileImageKey || null,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'HCMs fetched successfully',
      response: {
        hcmsRecords,
        cities: Array.from(cities),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error fetching HCMs',
    });
  }
};

const updateHcm = async (req, res) => {
  try {
    const requestData =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { email, hcmData, companyId, updatedById } = requestData;
    const existingUser = await users.findOne({ email });
    if (!existingUser) {
      return res.status(404).json({ success: false, message: 'HCM not found' });
    }
    const existingInfo = await hcmInfo.findOne({ _id: existingUser.info_id });
    if (!existingInfo) {
      return res
        .status(404)
        .json({ success: false, message: 'HCM info not found' });
    }
    const updatedPersonalInfo = {
      firstName:
        hcmData.personalInfo?.firstName || existingInfo.personalInfo?.firstName,
      middleName:
        hcmData.personalInfo?.middleName ||
        existingInfo.personalInfo?.middleName,
      lastName:
        hcmData.personalInfo?.lastName || existingInfo.personalInfo?.lastName,
      dob: hcmData.personalInfo?.dob || existingInfo.personalInfo?.dob,
      gender: hcmData.personalInfo?.gender || existingInfo.personalInfo?.gender,
    };
    const updatedContactInfo = {
      phoneNumber:
        hcmData.contactInfo?.phoneNumber ||
        existingInfo.contactInfo?.phoneNumber,
      email: hcmData.contactInfo?.email || existingInfo.contactInfo?.email,
      homePhone:
        hcmData.contactInfo?.homePhone || existingInfo.contactInfo?.homePhone,
      cellPhone:
        hcmData.contactInfo?.cellPhone || existingInfo.contactInfo?.cellPhone,
    };
    const updatedAddressInfo = {
      addressLine1:
        hcmData.addressInfo?.addressLine1 ||
        existingInfo.addressInfo?.addressLine1,
      addressLine2:
        hcmData.addressInfo?.addressLine2 ||
        existingInfo.addressInfo?.addressLine2,
      city: hcmData.addressInfo?.city || existingInfo.addressInfo?.city,
      state: hcmData.addressInfo?.state || existingInfo.addressInfo?.state,
      zipCode:
        hcmData.addressInfo?.zipCode || existingInfo.addressInfo?.zipCode,
      mailingAddress:
        hcmData.addressInfo?.mailingAddress ||
        existingInfo.addressInfo?.mailingAddress,
    };
    const updatedEmploymentInfo = {
      employmentTitle:
        hcmData.employmentInfo?.employmentTitle ||
        existingInfo.employmentInfo?.employmentTitle,
      hireDate:
        hcmData.employmentInfo?.hireDate ||
        existingInfo.employmentInfo?.hireDate,
      terminationDate:
        hcmData.employmentInfo?.terminationDate ||
        existingInfo.employmentInfo?.terminationDate,
      rateOfPay:
        hcmData.employmentInfo?.rateOfPay ||
        existingInfo.employmentInfo?.rateOfPay,
      ssn: hcmData.employmentInfo?.ssn || existingInfo.employmentInfo?.ssn,
    };
    const updatedLoginInfo = {
      username: hcmData.loginInfo?.username || existingInfo.loginInfo?.username,
      password: hcmData.loginInfo?.password || existingInfo.loginInfo?.password,
    };
    const updatedHcmInfo = {
      personalInfo: updatedPersonalInfo,
      contactInfo: updatedContactInfo,
      addressInfo: updatedAddressInfo,
      employmentInfo: updatedEmploymentInfo,
      loginInfo: updatedLoginInfo,
      companyId,
    };
    const hcm = await hcmInfo.findByIdAndUpdate(
      existingUser.info_id,
      updatedHcmInfo,
      { new: true }
    );

    const nameParts = [];
    if (updatedHcmInfo.personalInfo?.firstName)
      nameParts.push(
        updatedHcmInfo.personalInfo?.firstName ||
        existingInfo.personalInfo?.firstName
      );
    if (updatedHcmInfo.personalInfo?.middleName)
      nameParts.push(
        updatedHcmInfo.personalInfo?.middleName ||
        existingInfo.personalInfo?.middleName
      );
    if (updatedHcmInfo.personalInfo?.lastName)
      nameParts.push(
        updatedHcmInfo.personalInfo?.lastName ||
        existingInfo.personalInfo?.lastName
      );
    const name = nameParts.join(' ');

    const userUpdateData = {};
    if (name) userUpdateData.name = name;
    if (updatedHcmInfo.loginInfo?.username)
      userUpdateData.email = updatedHcmInfo.loginInfo?.username;
    if (updatedHcmInfo.contactInfo?.phoneNumber)
      userUpdateData.phoneNo = updatedHcmInfo.contactInfo?.phoneNumber;

    const updatedUser = await users.findByIdAndUpdate(
      existingUser._id,
      userUpdateData,
      { new: true }
    );

    // Query bills where this HCM is in the hcms array using the id field
    const bills = await Bills.find({ 'hcms.id': existingUser._id });
    for (const bill of bills) {
      if (bill.visitId) {
        await updateBillandEDI(bill.visitId);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'HCM updated successfully',
      response: {
        updatedHcm: updatedUser,
        updatedHcmInfo: updatedHcmInfo,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error updating HCM',
    });
  }
};

const deleteHcm = async (req, res) => {
  try {
    const { id } = req.params;
    const hcmId = new mongoose.Types.ObjectId(id);
    const deletedHcm = await users.findByIdAndDelete(hcmId);
    const deletedHcmInfo = await hcmInfo.findByIdAndDelete(deletedHcm.info_id);

    return res.status(200).json({
      success: true,
      message: 'HCM deleted successfully',
      response: {
        deletedHcm: deletedHcm,
        deletedHcmInfo: deletedHcmInfo,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error deleting HCM',
    });
  }
};

const getHcmInfo = async (req, res) => {
  try {
    const { id } = req.params;

    const hcmId = new mongoose.Types.ObjectId(id);
    const hcm = await users.findById(hcmId);
    const hcmInfoRecord = await hcmInfo.findById(hcm.info_id);
    hcmInfoRecord.profileImageUrl = hcm.profileImageUrl || null;
    hcmInfoRecord.profileImageKey = hcm.profileImageKey || null;
    return res.status(200).json({
      success: true,
      message: 'HCM info fetched successfully',
      response: {
        hcmInfo: hcmInfoRecord,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Error fetching HCM info',
    });
  }
};
const getHcmChartInfo = async (req, res) => {
  try {
    const { companyId } = req.params;

    // Find all hcms with role 0
    const hcms = await users.find({ role: 1, companyId });

    // Initialize the data structure for the response
    const data = {};

    // Process each tenant
    hcms.forEach((hcm) => {
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

      if (hcm.movedOut) {
        const movedOutDate = new Date(hcm.movedOutDate);
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
      message: 'HCM chart info fetched successfully',
      response: data,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const assignServicesAndDocuments = async (req, res) => {
  try {
    const { hcmId, services } = req.body;

    // Validate hcmId
    if (!mongoose.Types.ObjectId.isValid(hcmId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid HCM ID format',
      });
    }

    // Check if HCM exists
    const hcmExists = await users.findById(hcmId);
    if (!hcmExists) {
      return res.status(404).json({
        success: false,
        message: 'HCM not found',
      });
    }

    // Validate services array
    if (!services || !Array.isArray(services) || services.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Services array is required and cannot be empty',
      });
    }

    const savedServices = [];

    // Process each service
    for (const service of services) {
      const { serviceType, startDate, endDate, units, rate, document } =
        service;

      // Validate required service fields
      if (!serviceType || !startDate || !endDate || !units || !rate) {
        return res.status(400).json({
          success: false,
          message:
            'Missing required service fields: serviceType, startDate, endDate, units, and rate are required',
        });
      }
      // Create new service record
      const newService = new HcmService({
        hcmId,
        serviceType,
        startDate,
        endDate,
        units,
        rate,
        document: document,
        status: 'pending',
        reviewStatus: 'pending',
      });

      const savedService = await newService.save();
      savedServices.push(savedService);
    }

    res.status(200).json({
      success: true,
      message: 'Services assigned successfully',
      response: savedServices,
    });
  } catch (error) {
    console.error('Error in assignServicesAndDocuments:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error assigning services and documents',
    });
  }
};
export const hcmVisitHistory = async (req, res) => {
  try {
    const { hcmId } = req.body;

    if (!hcmId) {
      return res.status(400).json({
        success: false,
        message: 'HCM ID is required',
      });
    }

    // Find visits for the given hcmId and populate all relevant details
    const visits = await Visits.find({ hcmId })
      .populate({
        path: 'hcmId',
        select: '_id name email',
        model: 'causers',
      })
      .populate({
        path: 'tenantId',
        select: '_id name email',
        model: 'causers',
      })
      .populate({
        path: 'approvedBy',
        select: '_id name email role',
        model: 'causers',
      })
      .populate({
        path: 'rejectedBy',
        select: '_id name email role',
        model: 'causers',
      })
      .populate({
        path: 'withdrawnBy',
        select: '_id name email role',
        model: 'causers',
      })
      .sort({ date: -1, startTime: -1 }); // Sort by most recent first

    // Sort visits to find the most recent approved and rejected
    const recentApprovedVisit =
      visits
        .filter((visit) => visit.status === 'approved' && visit.timeOfApproval)
        .sort(
          (a, b) => new Date(b.timeOfApproval) - new Date(a.timeOfApproval)
        )[0] || null;

    const recentRejectedVisit =
      visits
        .filter((visit) => visit.status === 'rejected' && visit.timeOfRejection)
        .sort(
          (a, b) => new Date(b.timeOfRejection) - new Date(a.timeOfRejection)
        )[0] || null;

    // Format the response with complete information
    const formattedVisits = visits.map((visit) => ({
      visitId: visit._id,
      hcm: {
        id: visit.hcmId._id,
        name: visit.hcmId.name,
        email: visit.hcmId.email,
      },
      tenant: {
        id: visit.tenantId._id,
        name: visit.tenantId.name,
        email: visit.tenantId.email,
      },
      serviceType: visit.serviceType,
      serviceTypeName: visit.serviceTypeName,
      date: visit.date,
      startTime: visit.startTime,
      endTime: visit.endTime,
      status: visit.status,
      methodOfContact: visit.methodOfContact,
      activity: visit.activity,
      notes: visit.notes,

      // Approval information
      timeOfApproval: visit.timeOfApproval,
      approvedBy: visit.approvedBy
        ? {
          id: visit.approvedBy._id,
          name: visit.approvedBy.name,
          email: visit.approvedBy.email,
          role: visit.approvedBy.role,
        }
        : null,
      approvalNotes: visit.approvalNotes,

      // Rejection information
      timeOfRejection: visit.timeOfRejection,
      rejectedBy: visit.rejectedBy
        ? {
          id: visit.rejectedBy._id,
          name: visit.rejectedBy.name,
          email: visit.rejectedBy.email,
          role: visit.rejectedBy.role,
        }
        : null,
      reasonForRejection: visit.reasonForRejection,

      // Withdrawal information
      timeOfWithdrawal: visit.timeOfWithdrawal,
      withdrawnBy: visit.withdrawnBy
        ? {
          id: visit.withdrawnBy._id,
          name: visit.withdrawnBy.name,
          email: visit.withdrawnBy.email,
          role: visit.withdrawnBy.role,
        }
        : null,
      withdrawalReason: visit.withdrawalReason,

      // Timestamps
      createdAt: visit.createdAt,
      updatedAt: visit.updatedAt,
    }));

    // Enhanced recent visit information
    const formatRecentVisit = (visit) => {
      if (!visit) return null;

      return {
        visitId: visit._id,
        hcm: {
          id: visit.hcmId._id,
          name: visit.hcmId.name,
          email: visit.hcmId.email,
        },
        tenant: {
          id: visit.tenantId._id,
          name: visit.tenantId.name,
          email: visit.tenantId.email,
        },
        serviceType: visit.serviceType,
        serviceTypeName: visit.serviceTypeName,
        date: visit.date,
        startTime: visit.startTime,
        endTime: visit.endTime,
        status: visit.status,
        timeOfApproval: visit.timeOfApproval,
        timeOfRejection: visit.timeOfRejection,
        approvedBy: visit.approvedBy,
        rejectedBy: visit.rejectedBy,
        reasonForRejection: visit.reasonForRejection,
        approvalNotes: visit.approvalNotes,
      };
    };

    // Calculate statistics
    const stats = {
      total: visits.length,
      pending: visits.filter((v) => v.status === 'pending').length,
      approved: visits.filter((v) => v.status === 'approved').length,
      rejected: visits.filter((v) => v.status === 'rejected').length,
    };

    res.status(200).json({
      success: true,
      message: 'Visit history fetched successfully',
      response: {
        visits: formattedVisits,
        stats,
        recentApproved: formatRecentVisit(recentApprovedVisit),
        recentRejected: formatRecentVisit(recentRejectedVisit),
        totalVisits: visits.length,
      },
    });
  } catch (error) {
    console.error('Error fetching visit history:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching visit history data.',
      error: error.message,
    });
  }
};
const getServicesAndDocuments = async (req, res) => {
  try {
    const { hcmId } = req.body;

    if (!hcmId) {
      return res.status(400).json({
        success: false,
        message: 'HCM ID is required',
      });
    }

    // Find all services for this HCM
    const services = await HcmService.find({ hcmId }).sort({ createdAt: -1 }); // Sort by newest first

    if (!services || services.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No services found for this HCM',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Services fetched successfully',
      response: services,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching services',
    });
  }
};

const createSchedule = async (req, res) => {
  try {
    const {
      hcmId,
      tenantId,
      serviceType,
      date,
      startTime,
      endTime,
      activity,
      methodOfContact,
      reasonForRemote,
      placeOfService,
    } = req.body;

    // Validate required fields
    if (
      !hcmId ||
      !tenantId ||
      !serviceType ||
      !date ||
      !startTime ||
      !endTime
    ) {
      return res.status(400).json({
        success: false,
        message:
          'hcmId, tenantId, serviceType, date, startTime, and endTime are required.',
        response: null,
      });
    }

    // Parse startTime and endTime as Date objects
    const scheduleStartTime = new Date(startTime);
    const scheduleEndTime = new Date(endTime);

    // Ensure startTime is before endTime
    if (scheduleStartTime >= scheduleEndTime) {
      return res.status(400).json({
        success: false,
        message: 'Start time must be before end time.',
        response: null,
      });
    }

    // Create the schedule
    const newSchedule = new HcmAppointments({
      hcmId,
      tenantId,
      serviceType,
      date,
      startTime: scheduleStartTime,
      endTime: scheduleEndTime,
      activity,
      methodOfContact,
      reasonForRemote,
      placeOfService,
    });

    const savedAppointment = await newSchedule.save();

    // Fetch the saved appointment with populated fields
    const populatedAppointment = await HcmAppointments.findById(
      savedAppointment._id
    )
      .populate({
        path: 'hcmId',
        select: 'name email phoneNo',
        model: 'users',
      })
      .populate({
        path: 'tenantId',
        select: 'name email phoneNo',
        model: 'users',
      });

    // Format the response to include user details
    const formattedResponse = {
      ...populatedAppointment.toObject(),
      hcmDetails: populatedAppointment.hcmId,
      tenantDetails: populatedAppointment.tenantId,
    };

    res.status(200).json({
      success: true,
      message: 'Appointment created successfully',
      response: formattedResponse,
    });
  } catch (error) {
    console.error('Error in createSchedule:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating appointment',
    });
  }
};

const getAppointments = async (req, res) => {
  try {
    const { hcmId } = req.body;

    if (!hcmId) {
      return res.status(400).json({
        success: false,
        message: 'HCM ID is required',
      });
    }

    // Validate hcmId format
    if (!mongoose.Types.ObjectId.isValid(hcmId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid HCM ID format',
      });
    }

    // Check if HCM exists
    const hcm = await users.findById(hcmId);
    if (!hcm) {
      return res.status(404).json({
        success: false,
        message: 'HCM not found',
      });
    }

    // Fetch appointments with populated user details
    const appointments = await HcmAppointments.find({ hcmId })
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
      .sort({ date: 1, startTime: 1 }); // Sort by date and time ascending

    // Format the response
    const formattedAppointments = appointments.map((appointment) => ({
      ...appointment.toObject(),
      hcmDetails: appointment.hcmId,
      tenantDetails: appointment.tenantId,
    }));

    res.status(200).json({
      success: true,
      message: 'Appointments fetched successfully',
      response: formattedAppointments,
    });
  } catch (error) {
    console.error('Error in getAppointments:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching appointments',
    });
  }
};

const uploadDocument = async (req, res) => {
  try {
    const file = req.file;
    const { hcmId, folderName } = req.body;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    // Validate hcmId format
    if (!mongoose.Types.ObjectId.isValid(hcmId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid HCM ID format',
      });
    }

    // Check if HCM exists
    const hcm = await users.findById(hcmId);
    if (!hcm) {
      return res.status(404).json({
        success: false,
        message: 'HCM not found',
      });
    }

    // Convert the file buffer to base64
    const fileStr = file.buffer.toString('base64');
    const fileType = file.mimetype;

    // Upload to Cloudinary
    const uploadResponse = await cloudinary.uploader.upload(
      `data:${fileType};base64,${fileStr}`,
      {
        folder: 'hcm-documents', // Different folder for HCM documents
        resource_type: 'auto', // Automatically detect file type
      }
    );

    // Save document reference in database
    const newDocument = new Document({
      hcmId,
      folderName,
      fileName: file.originalname,
      filePath: uploadResponse.secure_url,
      originalName: file.originalname,
      mimeType: file.mimetype,
      cloudinaryId: uploadResponse.public_id,
      year: new Date().getFullYear().toString(),
      reviewComplete: false,
    });

    const savedDocument = await newDocument.save();

    return res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      response: {
        _id: savedDocument._id,
        fileName: savedDocument.fileName,
        filePath: savedDocument.filePath,
        folderName: savedDocument.folderName,
      },
    });
  } catch (error) {
    console.error('Error in uploadDocument:', error);
    return res.status(500).json({
      success: false,
      message: 'Error uploading document',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Upload failed',
    });
  }
};

// Fetch documents
const fetchDocuments = async (req, res) => {
  try {
    const { hcmId } = req.body;

    if (!hcmId) {
      return res.status(400).json({
        success: false,
        message: 'HCM ID is required',
      });
    }

    // Validate hcmId format
    if (!mongoose.Types.ObjectId.isValid(hcmId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid HCM ID format',
      });
    }

    // Check if HCM exists
    const hcm = await users.findById(hcmId);
    if (!hcm) {
      return res.status(404).json({
        success: false,
        message: 'HCM not found',
      });
    }

    // Find all documents for this HCM with populated HCM details
    const documents = await Document.find({ hcmId })
      .populate({
        path: 'hcmId',
        select: 'name email phoneNo',
        model: 'users',
      })
      .sort({ createdAt: -1 }); // Sort by newest first

    // Format the response
    const formattedDocuments = documents.map((doc) => ({
      ...doc.toObject(),
      hcmDetails: doc.hcmId,
    }));

    res.status(200).json({
      success: true,
      message: 'Documents fetched successfully',
      documents: formattedDocuments,
    });
  } catch (error) {
    console.error('Error in fetchDocuments:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching documents',
    });
  }
};

const updateAppointmentStatus = async (req, res) => {
  try {
    const { appointmentId, status, approved } = req.body;

    if (!appointmentId) {
      return res.status(400).json({
        success: false,
        message: 'Appointment ID is required',
      });
    }

    const updatedAppointment = await HcmAppointments.findByIdAndUpdate(
      appointmentId,
      {
        status: status,
        approved: approved,
      },
      { new: true }
    );

    if (!updatedAppointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Appointment status updated successfully',
      response: updatedAppointment,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error updating appointment status',
    });
  }
};

// Add a new controller to update service status
const updateServiceStatus = async (req, res) => {
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

    const service = await HcmService.findById(serviceId);
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

const getAllHcms = async (req, res) => {
  try {
    // Find all users with role 1 (HCMs) and select only _id and name fields
    const hcms = await users.find({ role: 1 }).select('_id name').lean();
    hcms.sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({
      success: true,
      message: 'HCMs fetched successfully',
      response: hcms,
    });
  } catch (error) {
    console.error('Error in getAllHcms:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching HCMs',
    });
  }
};

const getHCMNamesByCompany = async (req, res) => {
  const { companyId } = req.params;
  const companyObjectId = new mongoose.Types.ObjectId(companyId);

  try {
    // Fetch tenants with only the required fields (name and _id)
    const hcms = await users
      .find({ role: 1, companyId: companyObjectId })
      .select('_id name info_id email');
    hcms.sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({
      success: true,
      message: 'HCM names and IDs fetched successfully',
      response: hcms,
    });
  } catch (error) {
    console.error('Error in getHCMNamesAndIds:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching HCM names and IDs',
    });
  }
};

const getAssignedTenantsToHcm = async (req, res) => {
  try {
    const { hcmId } = req.body;

    // Validate hcmId
    if (!hcmId) {
      return res
        .status(400)
        .json({ success: false, message: 'HCM ID is required.' });
    }

    // Validate hcmId format
    if (!mongoose.Types.ObjectId.isValid(hcmId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid HCM ID format.' });
    }

    // Find the assignment for the given hcmId and populate complete tenant details
    const assignment = await tenantAssignedtoHcm.findOne({ hcmId }).populate({
      path: 'tenantIds',
      model: 'causers',
      match: { movedOut: false },
    });

    if (!assignment) {
      return res
        .status(200)
        .json({ success: false, message: 'No tenants assigned to this HCM.' });
    }

    // Return the complete user details
    return res.status(200).json({
      success: true,
      message: 'Tenants assigned to HCM fetched successfully',
      response: assignment.tenantIds,
    });
  } catch (error) {
    console.error('Error fetching assigned tenants:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching assigned tenants.',
      error: error.message || error,
    });
  }
};

const assignTenantsToHcm = async (req, res) => {
  try {
    const { hcmId, tenantIds, action = 'assign' } = req.body;
    // Validate input
    if (!hcmId || !tenantIds || !Array.isArray(tenantIds)) {
      return res.status(400).json({
        success: false,
        message: 'HCM ID and an array of Tenant IDs are required',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(hcmId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid HCM ID format',
      });
    }

    for (const tenantId of tenantIds) {
      if (!mongoose.Types.ObjectId.isValid(tenantId)) {
        return res.status(400).json({
          success: false,
          message: `Invalid Tenant ID format: ${tenantId}`,
        });
      }
    }

    let assignment = await tenantAssignedtoHcm.findOne({ hcmId });

    if (action === 'assign') {
      if (assignment) {
        const tenantIdStrings = tenantIds.map((id) => id.toString());
        let addedCount = 0;
        tenantIds.forEach((tenantId) => {
          if (
            !assignment.tenantIds.some(
              (id) => id.toString() === tenantId.toString()
            )
          ) {
            assignment.tenantIds.push(tenantId);
            addedCount++;
          }
        });
        if (addedCount > 0) {
          await assignment.save();
        }
      } else {
        assignment = new tenantAssignedtoHcm({
          hcmId,
          tenantIds,
        });
        await assignment.save();
      }

      // Bulk update hcmAssignedToTenant
      for (const tenantId of tenantIds) {
        let tenantAssignment = await hcmAssignedToTenant.findOne({ tenantId });
        if (tenantAssignment) {
          if (
            !tenantAssignment.hcmIds.some(
              (id) => id.toString() === hcmId.toString()
            )
          ) {
            tenantAssignment.hcmIds.push(hcmId);
            await tenantAssignment.save();
          }
        } else {
          tenantAssignment = new hcmAssignedToTenant({
            tenantId,
            hcmIds: [hcmId],
          });
          await tenantAssignment.save();
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Tenants assigned to HCM successfully',
        response: assignment,
      });
    } else if (action === 'unassign') {
      if (!assignment) {
        return res.status(404).json({
          success: false,
          message: 'No tenant assignments found for this HCM',
        });
      }

      const tenantIdStrings = tenantIds.map((id) => id.toString());
      const initialCount = assignment.tenantIds.length;
      assignment.tenantIds = assignment.tenantIds.filter(
        (tenantId) => !tenantIdStrings.includes(tenantId.toString())
      );

      if (assignment.tenantIds.length === initialCount) {
        return res.status(400).json({
          success: false,
          message: 'No matching tenants found to unassign',
        });
      }

      await assignment.save();

      // Bulk update hcmAssignedToTenant
      for (const tenantId of tenantIds) {
        let tenantAssignment = await hcmAssignedToTenant.findOne({ tenantId });
        if (tenantAssignment) {
          tenantAssignment.hcmIds = tenantAssignment.hcmIds.filter(
            (id) => id.toString() !== hcmId.toString()
          );
          await tenantAssignment.save();
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Tenants unassigned from HCM successfully',
        response: assignment,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "assign" or "unassign".',
      });
    }
  } catch (error) {
    console.error('Error in assignTenantsToHcm:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: 'Error processing tenant assignment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

export const getAssignedTenantsWithServices = async (req, res) => {
  const { hcmId } = req.body;

  try {
    // Step 1: Validate hcmId
    if (!hcmId) {
      return res
        .status(400)
        .json({ success: false, message: 'HCM ID is required.' });
    }

    if (!mongoose.Types.ObjectId.isValid(hcmId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid HCM ID format.' });
    }

    // Step 2: Fetch assigned tenants
    const assignment = await tenantAssignedtoHcm.findOne({ hcmId }).populate({
      path: 'tenantIds',
      model: 'causers',
      select: 'name _id',
      match: { movedOut: false },
    });

    if (!assignment) {
      return res
        .status(200)
        .json({ success: false, message: 'No tenants assigned to this HCM.' });
    }

    const tenantIds = assignment.tenantIds.map((tenant) => tenant._id);

    // Step 3: Fetch all ServiceTracking docs for these tenants
    const serviceTrackings = await ServiceTracking.find({
      tenantId: { $in: tenantIds },
    }).select(
      'tenantId serviceId startDate endDate methodOfContact coveredParentActivities'
    );

    if (!serviceTrackings.length) {
      const response = assignment.tenantIds.map((tenant) => ({
        _id: tenant._id,
        name: tenant.name,
        services: [],
      }));

      return res.status(200).json({
        success: true,
        message: 'No services found for the assigned tenants.',
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
    const tenantsWithServices = assignment.tenantIds.map((tenant) => {
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
          // methodOfContact: tracking.methodOfContact,
          // coveredParentActivities: tracking.coveredParentActivities,

          // Enriched fields
          serviceTypeName: service?.service_name || null,
          procedureCode: service?.service_procedure_code || null,
          // identifier: service?.service_type || null,
          // serviceStartDate: service?.service_duration || null,
          // serviceEndDate: service?.service_rate || null,
          coveredParentActivities: service?.covered_parent_activities || null,
          visitFrequency: service?.visit_frequency || null,
          placeOfService: service?.place_of_service || null,
        };
      });

      return {
        _id: tenant._id,
        name: tenant.name,
        services: mappedServices,
      };
    });

    // Step 7: Sort tenants alphabetically
    tenantsWithServices.sort((a, b) => a.name.localeCompare(b.name));

    // Step 8: Send response
    return res.status(200).json({
      success: true,
      message: 'Assigned tenants with services fetched successfully',
      response: tenantsWithServices,
    });
  } catch (error) {
    console.error('Error fetching assigned tenants with services:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching assigned tenants with services.',
      error: error.message || error,
    });
  }
};

export const oldhcmVisitHistory = async (req, res) => {
  try {
    const { hcmId } = req.body;
    const visits = await Visits.find({ hcmId })
      .populate({
        path: 'hcmId',
        select: '_id name email',
        model: 'causers',
      })
      .populate({
        path: 'tenantId',
        select: '_id name email',
        model: 'causers',
      })
      .populate({
        path: 'serviceId',
        select: 'service_name service_procedure_code',
        model: 'Service',
      });
    // Sort visits to find recent approved/rejected
    const recentApprovedVisits = visits
      .filter((v) => v.status === 'approved' && v.timeOfApproval)
      .sort((a, b) => new Date(b.timeOfApproval) - new Date(a.timeOfApproval))
      .slice(0, 2);

    const recentRejectedVisits = visits
      .filter((v) => v.status === 'rejected' && v.timeOfRejection)
      .sort((a, b) => new Date(b.timeOfRejection) - new Date(a.timeOfRejection))
      .slice(0, 2);

    // Helper to format visit
    const formatVisit = (visit) => {
      const serviceTypeCode = visit.serviceId?.service_procedure_code || null;
      const serviceTypeName = visit.serviceId?.service_name || null;

      if (!visit.serviceId) {
      }

      return {
        hcm: {
          id: visit.hcmId?._id || null,
          name: visit.hcmId?.name || null,
          ...(visit.hcmId?.email && { email: visit.hcmId.email }),
        },
        tenant: {
          id: visit.tenantId?._id || null,
          name: visit.tenantId?.name || null,
          ...(visit.tenantId?.email && { email: visit.tenantId.email }),
        },
        serviceType: serviceTypeName || serviceTypeCode || 'Unknown',
        date: visit.date,
        startTime: visit.startTime,
        endTime: visit.endTime,
        status: visit.status,
        updatedAt: visit.updatedAt,
        ...(visit.reasonForRejection && {
          reasonForRejection: visit.reasonForRejection,
        }),
        ...(visit.timeOfRejection && {
          timeOfRejection: visit.timeOfRejection,
        }),
        ...(visit.timeOfApproval && { timeOfApproval: visit.timeOfApproval }),
      };
    };

    const formattedVisits = visits.map(formatVisit);
    const formattedApproved = recentApprovedVisits.map(formatVisit);
    const formattedRejected = recentRejectedVisits.map(formatVisit);

    res.status(200).json({
      success: true,
      message: 'Visit history fetched successfully',
      response: {
        visits: formattedVisits,
        recentApproved: formattedApproved,
        recentRejected: formattedRejected,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching visit data:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching visit history data.',
      response: error.message,
    });
  }
};

// NEW: Visit approval/rejection functions for HCM
export const approveHcmVisit = async (req, res) => {
  try {
    const { visitId, hcmId, approvalNotes } = req.body;

    if (!visitId) {
      return res.status(400).json({
        success: false,
        message: 'Visit ID is required',
      });
    }

    if (!hcmId) {
      return res.status(400).json({
        success: false,
        message: 'HCM ID is required',
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

    // Update visit status to approved
    visit.status = 'approved';
    visit.timeOfApproval = new Date();
    visit.approvedBy = hcmId;
    visit.approvalNotes = approvalNotes || null;

    // Clear rejection fields
    visit.timeOfRejection = null;
    visit.reasonForRejection = null;
    visit.rejectedBy = null;

    // Clear withdrawal fields
    visit.timeOfWithdrawal = null;
    visit.withdrawalReason = null;
    visit.withdrawnBy = null;

    await visit.save();

    // Trigger EDI regeneration for this visit
    try {
      const { regenerateEdiForVisit } = await import(
        '../../utils/dynamicEdiUpdater.js'
      );
      await regenerateEdiForVisit(visitId);
    } catch (ediError) {
      console.error('Error regenerating EDI after visit approval:', ediError);
    }

    // Populate the approvedBy field for response
    await visit.populate('approvedBy', '_id name email role');

    res.status(200).json({
      success: true,
      message: 'Visit approved successfully',
      response: {
        visitId: visit._id,
        status: visit.status,
        timeOfApproval: visit.timeOfApproval,
        approvedBy: {
          id: visit.approvedBy._id,
          name: visit.approvedBy.name,
          email: visit.approvedBy.email,
          role: visit.approvedBy.role,
        },
        approvalNotes: visit.approvalNotes,
      },
    });
  } catch (error) {
    console.error('Error approving visit:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while approving the visit',
      error: error.message,
    });
  }
};

export const rejectHcmVisit = async (req, res) => {
  try {
    const { visitId, hcmId, reasonForRejection } = req.body;

    if (!visitId || !reasonForRejection) {
      return res.status(400).json({
        success: false,
        message: 'Visit ID and reason for rejection are required',
      });
    }

    if (!hcmId) {
      return res.status(400).json({
        success: false,
        message: 'HCM ID is required',
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

    // Update visit status to rejected
    visit.status = 'rejected';
    visit.timeOfRejection = new Date();
    visit.rejectedBy = hcmId;
    visit.reasonForRejection = reasonForRejection;

    // Clear approval fields
    visit.timeOfApproval = null;
    visit.approvedBy = null;
    visit.approvalNotes = null;

    // Clear withdrawal fields
    visit.timeOfWithdrawal = null;
    visit.withdrawalReason = null;
    visit.withdrawnBy = null;

    await visit.save();

    // Trigger EDI regeneration for this visit
    try {
      const { regenerateEdiForVisit } = await import(
        '../../utils/dynamicEdiUpdater.js'
      );
      await regenerateEdiForVisit(visitId);
    } catch (ediError) {
      console.error('Error regenerating EDI after visit rejection:', ediError);
    }

    // Populate the rejectedBy field for response
    await visit.populate('rejectedBy', '_id name email role');

    res.status(200).json({
      success: true,
      message: 'Visit rejected successfully',
      response: {
        visitId: visit._id,
        status: visit.status,
        timeOfRejection: visit.timeOfRejection,
        rejectedBy: {
          id: visit.rejectedBy._id,
          name: visit.rejectedBy.name,
          email: visit.rejectedBy.email,
          role: visit.rejectedBy.role,
        },
        reasonForRejection: visit.reasonForRejection,
      },
    });
  } catch (error) {
    console.error('Error rejecting visit:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while rejecting the visit',
      error: error.message,
    });
  }
};

export const withdrawApprovalHcmVisit = async (req, res) => {
  try {
    const { visitId, hcmId, withdrawalReason } = req.body;

    if (!visitId) {
      return res.status(400).json({
        success: false,
        message: 'Visit ID is required',
      });
    }

    if (!hcmId) {
      return res.status(400).json({
        success: false,
        message: 'HCM ID is required',
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

    if (visit.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Visit is not currently approved',
      });
    }

    // Update visit status back to pending
    visit.status = 'pending';
    visit.timeOfApproval = null;
    visit.approvedBy = null;
    visit.approvalNotes = null;
    visit.withdrawalReason = withdrawalReason || 'Approval withdrawn';
    visit.withdrawnBy = hcmId;
    visit.timeOfWithdrawal = new Date();

    await visit.save();

    // Trigger EDI regeneration for this visit
    try {
      const { regenerateEdiForVisit } = await import(
        '../../utils/dynamicEdiUpdater.js'
      );
      await regenerateEdiForVisit(visitId);
    } catch (ediError) {
      console.error(
        'Error regenerating EDI after withdrawal of approval:',
        ediError
      );
    }

    // Populate the withdrawnBy field for response
    await visit.populate('withdrawnBy', '_id name email role');

    res.status(200).json({
      success: true,
      message: 'Visit approval withdrawn successfully',
      response: {
        visitId: visit._id,
        status: visit.status,
        timeOfWithdrawal: visit.timeOfWithdrawal,
        withdrawnBy: {
          id: visit.withdrawnBy._id,
          name: visit.withdrawnBy.name,
          email: visit.withdrawnBy.email,
          role: visit.withdrawnBy.role,
        },
        withdrawalReason: visit.withdrawalReason,
      },
    });
  } catch (error) {
    console.error('Error withdrawing visit approval:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while withdrawing visit approval',
      error: error.message,
    });
  }
};

export const withdrawRejectionHcmVisit = async (req, res) => {
  try {
    const { visitId, hcmId, withdrawalReason } = req.body;

    if (!visitId) {
      return res.status(400).json({
        success: false,
        message: 'Visit ID is required',
      });
    }

    if (!hcmId) {
      return res.status(400).json({
        success: false,
        message: 'HCM ID is required',
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

    if (visit.status !== 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'Visit is not currently rejected',
      });
    }

    // Update visit status back to pending
    visit.status = 'pending';
    visit.timeOfRejection = null;
    visit.rejectedBy = null;
    visit.reasonForRejection = null;
    visit.withdrawalReason = withdrawalReason || 'Rejection withdrawn';
    visit.withdrawnBy = hcmId;
    visit.timeOfWithdrawal = new Date();

    await visit.save();

    // Trigger EDI regeneration for this visit
    try {
      const { regenerateEdiForVisit } = await import(
        '../../utils/dynamicEdiUpdater.js'
      );
      await regenerateEdiForVisit(visitId);
    } catch (ediError) {
      console.error(
        'Error regenerating EDI after withdrawal of rejection:',
        ediError
      );
    }

    // Populate the withdrawnBy field for response
    await visit.populate('withdrawnBy', '_id name email role');

    res.status(200).json({
      success: true,
      message: 'Visit rejection withdrawn successfully',
      response: {
        visitId: visit._id,
        status: visit.status,
        timeOfWithdrawal: visit.timeOfWithdrawal,
        withdrawnBy: {
          id: visit.withdrawnBy._id,
          name: visit.withdrawnBy.name,
          email: visit.withdrawnBy.email,
          role: visit.withdrawnBy.role,
        },
        withdrawalReason: visit.withdrawalReason,
      },
    });
  } catch (error) {
    console.error('Error withdrawing visit rejection:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while withdrawing visit rejection',
      error: error.message,
    });
  }
};

export {
  createHcm,
  getHcm,
  getHcms,
  assignServicesAndDocuments,
  getServicesAndDocuments,
  updateServiceStatus,
  createSchedule,
  getAppointments,
  uploadDocument,
  fetchDocuments,
  updateAppointmentStatus,
  getAllHcms,
  getHCMNamesByCompany,
  getAssignedTenantsToHcm,
  getHcmInfo,
  assignTenantsToHcm,
  updateHcm,
  deleteHcm,
  getHcmChartInfo,
};
