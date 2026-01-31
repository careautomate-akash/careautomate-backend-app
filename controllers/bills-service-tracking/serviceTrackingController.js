import ServiceTracking from '../../models/bills/serviceTracking.js';
import hcmInfo from '../../models/hcm-tenants/hcmInfo.js';
import { createNotification } from '../communication-documents/notificationController.js';
import User from '../../models/account/users.js';

export const getUnitsRemaining = async (req, res) => {
  try {
    const { hcmId, tenantId, serviceType } = req.query;

    if (!hcmId || !tenantId || !serviceType) {
      return res.status(400).json({
        success: false,
        message: 'hcmId, tenantId, and serviceType are required',
      });
    }

    const serviceTracking = await ServiceTracking.findOne({
      hcmId,
      tenantId,
      serviceType,
    });

    if (!serviceTracking) {
      return res.status(404).json({
        success: false,
        message: 'Service tracking information not found',
      });
    }

    const costPerUnit = 17.7;
    const totalCost = serviceTracking.unitsRemaining * costPerUnit;

    res.status(200).json({
      success: true,
      message: 'Units remaining fetched successfully',
      response: {
        unitsRemaining: serviceTracking.unitsRemaining,
        totalCost: totalCost.toFixed(2),
      },
    });
  } catch (error) {
    console.error('Error fetching units remaining:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
};

export const getHcmUnitsStats = async (req, res) => {
  try {
    const { tenantId } = req.body;
    const currentYear = new Date().getFullYear();
    const startYear = 2023;
    const serviceTypes = ['Housing Transition', 'Housing Sustaining'];
    const response = {};

    for (const serviceType of serviceTypes) {
      response[serviceType] = {};

      for (let year = startYear; year <= currentYear; year++) {
        const serviceTracking = await ServiceTracking.findOne({
          tenantId,
          serviceType,
          year,
        });

        if (!serviceTracking) {
          response[serviceType][year] = {
            message: 'Service tracking data not found',
          };
        } else {
          const allottedUnits = 600; // Assuming 600 units are allotted for 150 hours
          const workedUnits = allottedUnits - serviceTracking.unitsRemaining;
          const remainingUnits = serviceTracking.unitsRemaining;
          const scheduledUnits = serviceTracking.scheduledUnits || 0; // Use actual scheduled units if available
          const scheduledHours = scheduledUnits / 4; // Convert units to hours

          response[serviceType][year] = {
            allottedUnits,
            allottedHours: allottedUnits / 4,
            workedUnits,
            workedHours: workedUnits / 4,
            remainingUnits,
            remainingHours: remainingUnits / 4,
            scheduledUnits,
            scheduledHours,
          };
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'HCM units stats fetched successfully',
      response: response,
    });
  } catch (error) {
    console.error('Error fetching HCM units stats:', error);
    res.status(500).send('Internal Server Error');
  }
};

export const planUsage = async (req, res) => {
  try {
    const { tenantId } = req.body;

    // Fetch all service tracking records for the given tenant ID
    const serviceTrackings = await ServiceTracking.find({ tenantId });
    if (serviceTrackings.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Service tracking data not found for the given tenant ID',
      });
    }

    const response = await Promise.all(
      serviceTrackings.map(async (serviceTracking) => {
        const hcmDetails = await Promise.all(
          serviceTracking.hcmIds.map(async (hcmEntry) => {
            const user = await users.findOne({ _id: hcmEntry.hcmId });

            // Determine billing model based on service type
            let workedHours = hcmEntry.workedHours;
            let workedUnits = hcmEntry.workedUnits;

            if (serviceTracking.serviceType.toLowerCase().includes('consultation')) {
              // Housing Consultation: Per session billing
              workedUnits = 1; // One session
              workedHours = 0; // Not applicable
            } else if (serviceTracking.serviceType.toLowerCase().includes('moving') ||
              serviceTracking.serviceType.toLowerCase().includes('expense')) {
              // Moving Expenses: One-time billing
              workedUnits = 1; // One-time service
              workedHours = 0; // Not applicable
            } else {
              // Housing Transition/Sustaining: Use actual units/hours
              workedHours = hcmEntry.workedHours || 0;
              workedUnits = hcmEntry.workedUnits || 0;
            }

            return {
              hcm: {
                hcmId: hcmEntry.hcmId,
                hcmName: user.name,
                hcmEmail: user.email,
                hcmPhoneNo: user.phoneNo,
              },
              workedHours: workedHours,
              workedUnits: workedUnits,
              serviceDetails: hcmEntry.serviceDetails,
            };
          })
        );

        return {
          serviceType: serviceTracking.serviceType,
          period: `${serviceTracking.startDate.toISOString().split('T')[0]
            } to ${serviceTracking.endDate.toISOString().split('T')[0]}`,
          totalUnits: serviceTracking.totalUnits,
          unitsRemaining: serviceTracking.unitsRemaining,
          scheduledUnits: serviceTracking.scheduledUnits,
          workedUnits: serviceTracking.workedUnits,
          workedHours: serviceTracking.workedHours,
          hcmDetails: hcmDetails.filter((detail) => detail !== null), // Filter out any null entries
        };
      })
    );

    return res.status(200).json({
      success: true,
      message: 'Plan usage fetched successfully',
      response,
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const updateService = async (req, res) => {
  try {
    const { serviceId, updateData } = req.body;
    const service = await ServiceTracking.findByIdAndUpdate(
      serviceId,
      updateData,
      { new: true }
    );

    // If service status is changed to completed, send notifications to admins
    if (req.body.status === 'completed') {
      // Send notifications to all admin users
      const admins = await User.find({ role: 2 });

      for (const admin of admins) {
        await createNotification({
          recipient: admin._id,
          type: 'service',
          title: 'Service Completed',
          message: `Service "${service.name}" has been marked as completed`,
          data: {
            serviceId: service._id,
            serviceName: service.name
          },
          forWeb: true,
          forMobile: false
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Service updated successfully',
      response: service,
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteService = async (req, res) => {
  try {
    const { serviceId } = req.body;
    const service = await ServiceTracking.findByIdAndDelete(serviceId);
    return res.status(200).json({
      success: true,
      message: 'Service deleted successfully',
      response: service,
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getAllServicesByTenant = async (req, res) => {
  try {
    const { tenantId } = req.body;
    const services = await ServiceTracking.find({ tenantId });
    return res.status(200).json({
      success: true,
      message: 'Services fetched successfully',
      response: services,
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getAllServices = async (req, res) => {
  const { companyId } = req.params;
  try {
    const services = await ServiceTracking.find({ companyId });

    return res.status(200).json({
      success: true,
      message: 'Services fetched successfully',
      response: services,
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getServices = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const services = await ServiceTracking.find({ tenantId }).select(
      'tenantId serviceType startDate endDate totalUnits unitsRemaining  billRate companyId'
    );
    return res.status(200).json({
      success: true,
      message: 'Services fetched successfully',
      response: services,
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const addService = async (req, res) => {
  try {
    const { serviceDetails } = req.body;
    const service = await ServiceTracking.findOne({
      tenantId: serviceDetails.tenantId,
      serviceType: serviceDetails.serviceType,
    });
    if (service) {
      return res
        .status(400)
        .json({ success: false, message: 'Service already exists' });
    }
    const newService = new ServiceTracking({
      tenantId: serviceDetails.tenantId,
      serviceType: serviceDetails.serviceType,
      unitsRemaining: serviceDetails.unitsRemaining,
      startDate: serviceDetails.startDate,
      endDate: serviceDetails.endDate,
      totalUnits: serviceDetails.totalUnits,
      hcms: serviceDetails.hcms,
      billRate: serviceDetails.billRate,
      companyId: serviceDetails.companyId,
      saNumber: serviceDetails.saNumber,
      insurance: serviceDetails.insurance,
    });
    await newService.save();

    // Calculate days until end date
    const today = new Date();
    const endDate = new Date(newService.endDate);
    const daysUntilEnd = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

    // If service is ending within a week (7 days), notify admins
    if (daysUntilEnd <= 7 && daysUntilEnd > 0) {
      // Send notifications to all admin users
      const admins = await User.find({ role: 2 });

      for (const admin of admins) {
        await createNotification({
          recipient: admin._id,
          type: 'service',
          title: 'Service Completing Soon',
          message: `Service "${newService.name}" will be completed in ${daysUntilEnd} day${daysUntilEnd === 1 ? '' : 's'}`,
          data: {
            serviceId: newService._id,
            serviceName: newService.name,
            daysRemaining: daysUntilEnd
          },
          forWeb: true,
          forMobile: false
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Service added successfully',
      response: newService,
    });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

import mongoose, { isValidObjectId } from 'mongoose';

export const editService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { serviceDetails } = req.body;

    // Validate serviceId
    if (!mongoose.isValidObjectId(serviceId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid service ID' });
    }

    // Validate required fields
    const requiredFields = [
      'tenantId',
      'serviceType',
      'unitsRemaining',
      'startDate',
      'endDate',
      'totalUnits',
    ];
    const missingFields = requiredFields.filter(
      (field) => !serviceDetails[field]
    );
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`,
      });
    }

    // Check if service exists
    const service = await ServiceTracking.findById(serviceId);
    if (!service) {
      return res
        .status(404)
        .json({ success: false, message: 'Service not found' });
    }

    // Verify user authorization (example: check if tenantId matches user's tenant)
    // if (req.user.tenantId !== serviceDetails.tenantId) {
    //   return res
    //     .status(403)
    //     .json({ success: false, message: 'Unauthorized to edit this service' });
    // }

    // Check for duplicate service
    const duplicateService = await ServiceTracking.findOne({
      tenantId: serviceDetails.tenantId,
      serviceType: serviceDetails.serviceType,
      _id: { $ne: serviceId },
    });
    if (duplicateService) {
      return res.status(400).json({
        success: false,
        message: 'Another service with same tenant and type already exists',
      });
    }

    const updateFields = {
      tenantId: serviceDetails.tenantId,
      serviceType: serviceDetails.serviceType,
      unitsRemaining: serviceDetails.unitsRemaining,
      startDate: serviceDetails.startDate,
      endDate: serviceDetails.endDate,
      totalUnits: serviceDetails.totalUnits,
      hcms: serviceDetails.hcms || service.hcms,
      billRate: serviceDetails.billRate || service.billRate,
      companyId: serviceDetails.companyId || service.companyId,
      saNumber: serviceDetails.saNumber || service.saNumber,
      insurance: serviceDetails.insurance || service.insurance,
    };

    // Update service
    const updatedService = await ServiceTracking.findByIdAndUpdate(
      serviceId,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Service updated successfully',
      response: updatedService,
    });
  } catch (error) {
    console.error('Error updating service:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error: ' + error.message,
      });
    }
    return res
      .status(500)
      .json({ success: false, message: 'Server error: ' + error.message });
  }
};

export const createServiceTracking = async (req, res) => {
  try {
    const {
      tenantId,
      serviceType,
      startDate,
      endDate,
      insuranceType,
      initialUnits,
      billRate,
      companyId,
      uploadedFile,
    } = req.body;

    // Validate required fields
    if (
      !tenantId ||
      !serviceType ||
      !startDate ||
      !endDate ||
      !initialUnits ||
      !billRate
    ) {
      return res.status(400).json({
        success: false,
        message:
          'tenantId, serviceType, startDate, endDate, initialUnits, and billRate are required fields',
      });
    }

    // Fix timezone issues for startDate and endDate
    const startDateObj = new Date(startDate);
    const startYear = startDateObj.getFullYear();
    const startMonth = startDateObj.getMonth();
    const startDay = startDateObj.getDate();

    const endDateObj = new Date(endDate);
    const endYear = endDateObj.getFullYear();
    const endMonth = endDateObj.getMonth();
    const endDay = endDateObj.getDate();

    // Create date objects with the correct date components
    const formattedStartDate = new Date(startYear, startMonth, startDay);
    const formattedEndDate = new Date(endYear, endMonth, endDay);

    // Check if a service tracking with the same tenant and service type already exists
    const existingService = await ServiceTracking.findOne({
      tenantId,
      serviceType,
    });

    if (existingService) {
      // If it exists, update the units, dates, and other fields
      existingService.startDate = formattedStartDate;
      existingService.endDate = formattedEndDate;
      existingService.insuranceType = insuranceType || existingService.insuranceType;
      existingService.initialUnits = initialUnits;
      existingService.unitsRemaining = initialUnits - existingService.workedUnits - existingService.scheduledUnits;
      existingService.billRate = billRate;
      existingService.uploadedFile = uploadedFile || existingService.uploadedFile;

      await existingService.save();

      return res.status(200).json({
        success: true,
        message: 'Service tracking updated successfully',
        service: existingService,
      });
    }

    // Create new service tracking
    const newService = new ServiceTracking({
      tenantId,
      serviceType,
      startDate: formattedStartDate,
      endDate: formattedEndDate,
      insuranceType,
      initialUnits,
      unitsRemaining: initialUnits,
      workedUnits: 0,
      scheduledUnits: 0,
      billRate,
      companyId,
      uploadedFile,
      hcms: [],
    });

    await newService.save();

    res.status(201).json({
      success: true,
      message: 'Service tracking created successfully',
      service: newService,
    });
  } catch (error) {
    console.error('Error in createServiceTracking:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};
