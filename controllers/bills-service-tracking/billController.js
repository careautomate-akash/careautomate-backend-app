import serviceTracking from '../../models/bills/serviceTracking.js';
import ServiceTracking from '../../models/bills/serviceTracking.js';
import billingPending from '../../models/bills/billsPending.js';
import billingDone from '../../models/bills/billsDone.js';
import Bills from '../../models/bills/bills.js';
import users from '../../models/account/users.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Visits from '../../models/appointments-visits/visits.js';
import { generateEDI } from '../../tasks/generateEdiFile.js';
import { setupUploadDirectories } from '../../utils/setupDirectories.js';
import { createNotification } from '../communication-documents/notificationController.js';
import User from '../../models/account/users.js';
import ClaimVisitMap from '../../models/bills/claimVisitMap.js';
import Bill from '../../models/bills/bills.js';
import BillDone from '../../models/bills/billsDone.js';

// Get the current directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { uploadsDir } = setupUploadDirectories();
const ediFilesDir = path.join(uploadsDir, 'ediFiles');
if (!fs.existsSync(ediFilesDir)) {
  fs.mkdirSync(ediFilesDir, { recursive: true });
}

export const getPendingEdis = async (req, res) => {
  const { companyId } = req.params;
  const { startDate, endDate } = req.body;

  if (!companyId) {
    return res.status(400).json({
      success: false,
      message: 'Company ID is required',
    });
  }

  try {
    // Create date filter object for serviceDate (which is the main service date field)
    const dateFilter = {};
    if (startDate) {
      // Parse the date and set to beginning of day (use local time, not UTC)
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      dateFilter.$gte = start;
    }
    if (endDate) {
      // Parse the date and set to end of day (use local time, not UTC)
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }

    // Use serviceDate for filtering since that's what the frontend expects
    const queryFilter = {
      companyId,
    };

    // If we have date filters, apply them to serviceDate
    if (Object.keys(dateFilter).length > 0) {
      queryFilter.serviceDate = dateFilter;
    }

    console.log(
      'Filtering bills with query:',
      JSON.stringify(queryFilter, null, 2)
    );
    const pendingEdis = await Bills.find(queryFilter);

    const populatedEdis = await Promise.all(
      pendingEdis.map(async (edi) => {
        const visit = await Visits.findOne({ _id: edi.visitId });
        const ediObject = edi.toObject();

        // Ensure ediContent and ediFileName are included
        if (!ediObject.ediContent || !ediObject.ediFileName) {
          try {
            const { generateEDI } = await import(
              '../../tasks/generateEdiFile.js'
            );
            const ediResult = await generateEDI(ediObject);
            if (ediResult.ediContent) {
              edi.ediContent = ediResult.ediContent;
              edi.ediFileName = ediResult.ediFileName;
              await edi.save();
              ediObject.ediContent = ediResult.ediContent;
              ediObject.ediFileName = ediResult.ediFileName;
            }
          } catch (ediError) {
            console.error(
              `[GET PENDING EDIS] Error regenerating EDI for bill ${edi._id}:`,
              ediError
            );
          }
        }

        // Ensure insurance information is included
        if (!ediObject.insurance || !ediObject.insurance.name) {
          ediObject.insurance = ediObject.insurance || {
            name: 'Unknown Insurance',
            identifier: '0000000000',
            type: 'Unknown Insurance',
            memberNumber: '0000000000',
          };
        }

        return { ...ediObject, visit };
      })
    );

    res.status(200).json({
      success: true,
      message: 'Pending EDI files fetched successfully',
      response: populatedEdis,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getHcmClaims = async (req, res) => {
  const { hcmId } = req.params;
  if (!hcmId) {
    return res.status(400).json({
      success: false,
      message: 'HCM ID is required',
    });
  }

  try {
    const { startDate, endDate } = req.body;

    const dateFilter = {};
    if (startDate) {
      dateFilter.$gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.$lte = new Date(endDate);
    }

    const pendingEdis = await Bills.find({
      hcms: { $elemMatch: { _id: hcmId } },
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
    })
      .populate({
        path: 'visitId',
        select:
          '_id tenantId hcmId serviceType activity date startTime endTime place methodOfContact status signature notes',
        populate: [
          { path: 'tenantId', select: '_id name email', model: 'causers' },
          { path: 'hcmId', select: '_id name email', model: 'causers' },
        ],
      })
      .populate('tenantId', '_id name email')
      .lean();

    const groupedByTenant = pendingEdis.reduce((acc, edi) => {
      const tenantId = edi.tenantId._id.toString();

      if (!acc[tenantId]) {
        acc[tenantId] = {
          tenantId: tenantId,
          tenantName: edi.tenantId.name || 'Unknown',
          tenantEmail: edi.tenantId.email || '',
          edis: [],
        };
      }

      // Restructure for consistency with previous approach
      const ediWithVisit = {
        ...edi,
        visit: edi.visitId,
        tenant: edi.tenantId,
      };

      // Remove the populated fields to avoid duplication
      delete ediWithVisit.visitId;
      delete ediWithVisit.tenantId;

      acc[tenantId].edis.push(ediWithVisit);
      return acc;
    }, {});

    // Convert to array
    const response = Object.values(groupedByTenant);

    res.status(200).json({
      success: true,
      message: 'HCM pending EDI files fetched successfully',
      count: pendingEdis.length,
      tenantCount: response.length,
      response: response,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateBillStatus = async (req, res) => {
  const { billIds } = req.body;
  const { status, reschedule } = req.body;

  if (!billIds || !Array.isArray(billIds) || billIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Please provide an array of bill IDs',
    });
  }

  try {
    const updatePromises = billIds.map(async (billId) => {
      const bill = await Bills.findById(billId);
      if (!bill) {
        return { billId, success: false, message: 'Bill not found' };
      }

      if (status) {
        bill.status = status;
      }
      if (reschedule) {
        bill.scheduledFor = reschedule;
      }
      await bill.save();
      return { billId, success: true, bill };
    });

    const results = await Promise.all(updatePromises);
    const successfulUpdates = results.filter((result) => result.success);
    const failedUpdates = results.filter((result) => !result.success);

    res.status(200).json({
      success: true,
      message: `Successfully updated ${successfulUpdates.length} bills${
        failedUpdates.length > 0 ? `, ${failedUpdates.length} failed` : ''
      }`,
      response: {
        successful: successfulUpdates,
        failed: failedUpdates,
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getTenantsRunningByUnits = async (req, res) => {
  const { companyId } = req.params;
  try {
    const count = await serviceTracking.countDocuments({
      unitsRemaining: { $lte: 50 },
      companyId,
    });
    res.status(200).json({
      success: true,
      message: 'Tenants running by units fetched successfully',
      response: {
        count,
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const planUsage = async (req, res) => {
  try {
    const { tenantId } = req.body;

    // Validate tenantId
    if (!tenantId) {
      return res
        .status(200)
        .json({ success: false, message: 'Tenant ID is required' });
    }
    // Fetch all service tracking records for the given tenant ID
    const services = await serviceTracking.find({ tenantId }).populate({
      path: 'tenantId',
      select: '_id name',
      model: 'causers',
    });

    if (services.length === 0) {
      return res.status(200).json({
        success: false,
        message: 'Service tracking data not found for the given tenant ID',
      });
    }

    const response = await Promise.all(
      services.map(async (service) => {
        const assignedHCMs =
          service.hcms && service.hcms.length > 0
            ? await Promise.all(
                service.hcms.map(async (hcm) => {
                  try {
                    const hcmInfoRecord = await users
                      .findById(hcm.hcmId)
                      .select('_id name email phoneNo')
                      .lean();
                    if (!hcmInfoRecord) {
                      console.warn(`HCM info not found for ID ${hcm.hcmId}`);
                      return null;
                    }

                    // Determine billing model based on service type
                    let workedHours = hcm.workedHours;
                    let workedUnits = hcm.workedUnits;
                    let scheduledUnits = hcm.scheduledUnits;

                    if (
                      service.serviceType.toLowerCase().includes('consultation')
                    ) {
                      // Housing Consultation: Per session billing
                      workedUnits = 1; // One session
                      workedHours = 0; // Not applicable
                      scheduledUnits = hcm.scheduledUnits || 0; // Keep scheduled sessions
                    } else if (
                      service.serviceType.toLowerCase().includes('moving') ||
                      service.serviceType.toLowerCase().includes('expense')
                    ) {
                      // Moving Expenses: One-time billing
                      workedUnits = 1; // One-time service
                      workedHours = 0; // Not applicable
                      scheduledUnits = 0; // Not applicable for moving expenses
                    } else {
                      // Housing Transition/Sustaining: Use actual units/hours
                      workedHours = hcm.workedHours || 0;
                      workedUnits = hcm.workedUnits || 0;
                      scheduledUnits = hcm.scheduledUnits || 0;
                    }

                    return {
                      hcmId: hcm.hcmId,
                      hcmName: hcmInfoRecord.name,
                      hcmEmail: hcmInfoRecord.email,
                      hcmPhoneNo: hcmInfoRecord.phoneNo,
                      workedUnits: workedUnits,
                      serviceDetails: hcm.serviceDetails,
                      billAmount: hcm.billAmount,
                      scheduledUnits: scheduledUnits,
                      scheduledDetails: hcm.scheduledDetails,
                    };
                  } catch (error) {
                    console.error(
                      `Error fetching HCM info for ID ${hcm.hcmId}:`,
                      error
                    );
                    return null;
                  }
                })
              )
            : [];
        return {
          tenantId: service.tenantId ? service.tenantId._id : '-',
          tenantName: service.tenantId ? service.tenantId.name : '-',
          assignedHCMs: assignedHCMs.filter((hcm) => hcm !== null),
          serviceType: service.serviceTypeName,
          period:
            service.startDate && service.endDate
              ? `${service.startDate.toISOString().split('T')[0]} to ${
                  service.endDate.toISOString().split('T')[0]
                }`
              : 'N/A', // Handle missing dates gracefully
          totalUnits: service.totalUnits,
          unitsRemaining: service.unitsRemaining,
          scheduledUnits: service.scheduledUnits,
          workedUnits: service.workedUnits,
          billRate: service.billRate,
        };
      })
    );

    return res.status(200).json({
      success: true,
      message: 'Plan usage data fetched successfully',
      response,
    });
  } catch (error) {
    console.error('Error in planUsage:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching plan usage data',
    });
  }
};

//TENANT CLAIMS
export const getTenantClaims = async (req, res) => {
  const tenantId = req.params.tenantId;
  try {
    const services = await serviceTracking.find({ tenantId });
    if (services.length === 0) {
      return res.status(200).json({
        success: false,
        message: 'Service tracking data not found for the given tenant ID',
      });
    }

    const response = await Promise.all(
      services.map(async (service) => {
        const assignedHCMs =
          service.hcms && service.hcms.length > 0
            ? await Promise.all(
                service.hcms.map(async (hcm) => {
                  try {
                    const hcmInfoRecord = await users
                      .findById(hcm.hcmId)
                      .select('_id name email phoneNo')
                      .lean();
                    if (!hcmInfoRecord) {
                      console.warn(`HCM info not found for ID ${hcm.hcmId}`);
                      return null;
                    }

                    // Determine billing model based on service type
                    let workedHours = hcm.workedHours;
                    let workedUnits = hcm.workedUnits;
                    let scheduledUnits = hcm.scheduledUnits;

                    if (
                      service.serviceType.toLowerCase().includes('consultation')
                    ) {
                      // Housing Consultation: Per session billing
                      workedUnits = 1; // One session
                      workedHours = 0; // Not applicable
                      scheduledUnits = hcm.scheduledUnits || 0; // Keep scheduled sessions
                    } else if (
                      service.serviceType.toLowerCase().includes('moving') ||
                      service.serviceType.toLowerCase().includes('expense')
                    ) {
                      // Moving Expenses: One-time billing
                      workedUnits = 1; // One-time service
                      workedHours = 0; // Not applicable
                      scheduledUnits = 0; // Not applicable for moving expenses
                    } else {
                      // Housing Transition/Sustaining: Use actual units/hours
                      workedHours = hcm.workedHours || 0;
                      workedUnits = hcm.workedUnits || 0;
                      scheduledUnits = hcm.scheduledUnits || 0;
                    }

                    return {
                      hcmId: hcm.hcmId,
                      hcmName: hcmInfoRecord.name,
                      hcmEmail: hcmInfoRecord.email,
                      hcmPhoneNo: hcmInfoRecord.phoneNo,
                      workedUnits: workedUnits,
                      serviceDetails: hcm.serviceDetails,
                      billAmount: hcm.billAmount,
                      scheduledUnits: scheduledUnits,
                      scheduledDetails: hcm.scheduledDetails,
                    };
                  } catch (error) {
                    console.error(
                      `Error fetching HCM info for ID ${hcm.hcmId}:`,
                      error
                    );
                    return null;
                  }
                })
              )
            : [];
        return {
          tenantId: service.tenantId ? service.tenantId._id : '-',
          tenantName: service.tenantId ? service.tenantId.name : '-',
          assignedHCMs: assignedHCMs.filter((hcm) => hcm !== null),
          serviceType: service.serviceTypeName,
          period:
            service.startDate && service.endDate
              ? `${service.startDate.toISOString().split('T')[0]} to ${
                  service.endDate.toISOString().split('T')[0]
                }`
              : 'N/A',
          totalUnits: service.totalUnits,
          unitsRemaining: service.unitsRemaining,
          scheduledUnits: service.scheduledUnits,
          workedUnits: service.workedUnits,
          billRate: service.billRate,
        };
      })
    );

    return res.status(200).json({
      success: true,
      message: 'Plan usage data for Tenant fetched successfully',
      response,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching plan usage data',
    });
  }
};

export const getBillsPending = async (req, res) => {
  const { companyId } = req.params;
  try {
    const billPending = await Bill.find({ companyId, status: 'pending' });
    res.status(200).json({
      success: true,
      message: 'Bill pending fetched successfully',
      response: {
        count: billPending.length,
        pendingBills: billPending,
      },
    });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, response: error });
  }
};
export const getBillsDone = async (req, res) => {
  const { companyId } = req.params;
  try {
    const billingDone = await Bill.find({ companyId, status: 'done' });
    res.status(200).json({
      success: true,
      message: 'Bills done fetched successfully',
      response: {
        count: billingDone.length,
        doneBills: billingDone,
      },
    });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, response: error });
  }
};
export const getBillsGenerated = async (req, res) => {
  try {
    // Fetch bills from both collections
    const billingPending = await billingPending.find();
    const billingDone = await billingDone.find();

    // Combine the results
    const allBills = [...billingPending, ...billingDone];

    res.status(200).json({
      success: true,
      message: 'Bills generated fetched successfully',
      response: allBills,
    });
  } catch (error) {
    console.error('Error fetching bills:', error);
    res.status(400).json({
      success: false,
      message: error.message,
      response: error,
    });
  }
};

export const markBillAsPaid = async (req, res) => {
  try {
    const { billId } = req.body;

    // Find the bill in the billingPending collection
    const bill = await billingPending.findById(billId);
    if (!bill) {
      return res
        .status(404)
        .json({ success: false, message: 'Bill not found' });
    }

    // Create a new document in the billingDone collection
    const billDone = new billingDone({
      ...bill.toObject(),
    });
    await billDone.save();

    // Remove the bill from the billingPending collection
    await billingPending.findByIdAndDelete(billId);

    res.status(200).json({
      success: true,
      message: 'Bill marked as paid and moved to billingDone',
      response: billDone,
    });
  } catch (error) {
    console.error('Error marking bill as paid:', error);
    res
      .status(400)
      .json({ success: false, message: error.message, response: error });
  }
};

export const getbillsPending = async (req, res) => {
  try {
    const billingPending = await billingPending.find();
    res.status(200).json({
      success: true,
      message: 'Bills pending fetched successfully',
      response: billingPending,
    });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, response: error });
  }
};

export const getBillsRejected = async (req, res) => {
  try {
    const billsRejected = await Bill.find({ status: 'rejected' });
    res.status(200).json({
      success: true,
      message: 'Bills rejected fetched successfully',
      response: billsRejected,
    });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, response: error });
  }
};

export const getBillClaim = async (req, res) => {
  try {
    const { tenantId, serviceType } = req.body;
    const billClaim = await Bill.find({ tenantId, serviceType });
    res.status(200).json({
      success: true,
      message: 'Bill claim fetched successfully',
      response: billClaim,
    });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, response: error });
  }
};

export const getBillsPendingByTenant = async (req, res) => {
  try {
    const { tenantId } = req.body;

    // Fetch pending bills and populate the 'bill' field with data from the 'bills' collection
    // Also populate the 'visit' field within each 'bill', which further populates the actual visit
    const pendingBills = await billingPending
      .find({ tenant: tenantId })
      .populate({
        path: 'bill',
        populate: {
          path: 'visit', // This is the field in the 'Bill' schema
          model: 'approvedvisits', // Ensure this matches the model name for visits
          populate: {
            path: 'visit', // This is the field in the 'Visits' schema
            model: 'visits', // Ensure this matches the actual visits model name
          },
        },
      });

    // Extract the populated bill data
    const bills = pendingBills.map((pendingBill) => pendingBill.bill);

    return res.status(200).json({
      success: true,
      message: 'Bills fetched successfully',
      response: {
        Bills: bills,
      },
    });
  } catch (error) {
    console.error('Error in getBillsPendingByTenant:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching bills',
      error: error.message || error,
    });
  }
};

export const createBill = async (req, res) => {
  try {
    const { tenantId, serviceType, startTime, endTime, amount } = req.body;

    // Validate required fields
    if (!tenantId || !serviceType || !startTime || !endTime || !amount) {
      return res.status(400).json({
        success: false,
        message:
          'tenantId, serviceType, startTime, endTime, and amount are required.',
        response: null,
      });
    }

    // Parse startTime and endTime as Date objects
    const billStartTime = new Date(startTime);
    const billEndTime = new Date(endTime);

    // Ensure startTime is before endTime
    if (billStartTime >= billEndTime) {
      return res.status(400).json({
        success: false,
        message: 'Start time must be before end time.',
        response: null,
      });
    }

    // Create the bill
    const newBill = new Bill({
      tenantId,
      serviceType,
      startTime: billStartTime,
      endTime: billEndTime,
      amount,
    });

    await newBill.save();

    // Send notifications to all admin users
    const admins = await User.find({ role: 2 });

    for (const admin of admins) {
      await createNotification({
        recipient: admin._id,
        type: 'claim',
        title: 'New Claim Submitted',
        message: `A new claim has been submitted with ID ${newBill._id}`,
        data: {
          billId: newBill._id,
          amount: newBill.amount,
        },
        forWeb: true,
        forMobile: false,
      });
    }

    // Send notifications to all superadmin users as well
    const superAdmins = await User.find({ role: 3 });

    for (const superAdmin of superAdmins) {
      await createNotification({
        recipient: superAdmin._id,
        type: 'claim',
        title: 'New Claim Submitted',
        message: `A new claim has been submitted with ID ${newBill._id}`,
        data: {
          billId: newBill._id,
          amount: newBill.amount,
        },
        forWeb: true,
        forMobile: false,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Bill created successfully',
      response: newBill,
    });
  } catch (error) {
    console.error('Error in createBill:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      response: error.message,
    });
  }
};

export const generateAndUploadEdi = async (req, res) => {
  try {
    const { billId } = req.params;

    // Fetch the bill
    const bill = await Bills.findById(billId);
    if (!bill) {
      return res.status(404).json({
        success: false,
        message: 'Bill not found',
      });
    }

    // Generate EDI content
    const { ediContent, ediFileName } = await generateEDI(bill);

    if (!ediContent) {
      return res.status(400).json({
        success: false,
        message: 'Failed to generate EDI content',
      });
    }

    // Save EDI file locally
    const filePath = path.join(ediFilesDir, ediFileName);
    fs.writeFileSync(filePath, ediContent);

    // Upload to Google Drive
    const uploadResult = await uploadFileToDrive(filePath, ediFileName);

    // Update bill status
    bill.status = 'submitted';
    bill.ediFileId = uploadResult.fileId;
    bill.updatedAt = new Date();
    await bill.save();

    // Clean up local file
    fs.unlinkSync(filePath);

    res.status(200).json({
      success: true,
      message: 'EDI file generated and uploaded to Google Drive successfully',
      response: {
        fileName: ediFileName,
        fileId: uploadResult.fileId,
        billId: bill._id,
        status: bill.status,
      },
    });
  } catch (error) {
    console.error('Error generating and uploading EDI:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error generating and uploading EDI file',
      error: error,
    });
  }
};

export const getBillsPendingCount = async (req, res) => {
  const { companyId } = req.params;
  try {
    const count = await Bills.countDocuments({
      companyId,
      status: 'scheduled',
    });
    res.status(200).json({
      success: true,
      message: 'Bills pending count fetched successfully',
      response: count,
    });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: error.message, response: error });
  }
};

export const getBillsForCompany = async (req, res) => {
  try {
    const { companyId } = req.params;
    let { startDate, endDate, status, tenantId, hcmId } = req.query;

    const query = { companyId };

    // Handle date filtering
    if (startDate || endDate) {
      query.createdAt = {};

      if (startDate) {
        // Fix timezone issues by creating a date with just the date parts
        const start = new Date(startDate);
        const startYear = start.getFullYear();
        const startMonth = start.getMonth();
        const startDay = start.getDate();

        query.createdAt.$gte = new Date(startYear, startMonth, startDay);
      }

      if (endDate) {
        // Fix timezone issues by creating a date with just the date parts
        const end = new Date(endDate);
        const endYear = end.getFullYear();
        const endMonth = end.getMonth();
        const endDay = end.getDate();

        // Set to end of day for the end date
        query.createdAt.$lte = new Date(
          endYear,
          endMonth,
          endDay,
          23,
          59,
          59,
          999
        );
      }
    }

    // Handle status filtering
    if (status) {
      query.status = status;
    }

    // Handle tenant filtering
    if (tenantId) {
      query.tenantId = tenantId;
    }

    // Handle HCM filtering
    if (hcmId) {
      query.hcmId = hcmId;
    }

    const bills = await Bill.find(query)
      .populate('tenantId')
      .populate('hcmId')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      message: 'Bills fetched successfully',
      bills,
    });
  } catch (error) {
    console.error('Error in getBillsForCompany:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

export const generateMultipleVisitsEdi = async (req, res) => {
  try {
    const { visitIds, companyId } = req.body;

    if (!visitIds || !Array.isArray(visitIds) || visitIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Visit IDs array is required and cannot be empty',
      });
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required',
      });
    }
    const results = [];
    const generatedFiles = [];

    // Group visits by member/tenant and employee/HCM for batch processing
    const visitGroups = new Map();

    // Fetch all visits first
    const visits = await Visits.find({
      _id: { $in: visitIds },
      status: 'approved', // Only process approved visits
    }).populate('tenantId hcmId');

    if (visits.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No approved visits found for the provided IDs',
      });
    }

    // Group visits by tenant and HCM for efficient batch processing
    for (const visit of visits) {
      const groupKey = `${visit.tenantId._id}_${visit.hcmId._id}`;

      if (!visitGroups.has(groupKey)) {
        visitGroups.set(groupKey, {
          tenant: visit.tenantId,
          hcm: visit.hcmId,
          visits: [],
        });
      }

      visitGroups.get(groupKey).visits.push(visit);
    }
    // Process each group
    for (const [groupKey, group] of visitGroups) {
      try {
        // Find or create bills for each visit in the group
        const billsForGroup = [];

        for (const visit of group.visits) {
          try {
            // Check if bill already exists for this visit
            let bill = await Bills.findOne({ visitId: visit._id });

            if (!bill) {
              // Generate bill for this visit
              const billResult = await generateBillForVisit(
                visit._id,
                companyId
              );
              if (billResult.success) {
                bill = await Bills.findById(billResult.billId);
              }
            }

            if (bill) {
              billsForGroup.push(bill);
            }
          } catch (visitError) {
            console.error(
              `[MULTIPLE EDI] Error processing visit ${visit._id}:`,
              visitError
            );
            results.push({
              visitId: visit._id,
              success: false,
              error: `Failed to generate bill: ${visitError.message}`,
            });
          }
        }

        if (billsForGroup.length === 0) {
          continue;
        }

        // Generate batch EDI for this group
        const { generateBatchEDI } = await import(
          '../../tasks/generateEdiFile.js'
        );
        const batchResult = await generateBatchEDI(billsForGroup);

        if (batchResult.success) {
          // Save the batch EDI file
          const ediFileName = `batch_${group.tenant.name.replace(
            /\s+/g,
            '_'
          )}_${group.hcm.name.replace(/\s+/g, '_')}_${Date.now()}.dat`;
          const ediFilePath = path.join(process.cwd(), 'ediFiles', ediFileName);

          await fs.promises.writeFile(ediFilePath, batchResult.ediContent);

          // Update all bills in this group with batch information
          for (const bill of billsForGroup) {
            bill.ediContent = batchResult.ediContent;
            bill.ediFileName = ediFileName;
            bill.batchProcessed = true;
            bill.batchDate = new Date();
            bill.lastEdiUpdate = new Date();
            await bill.save();
          }

          generatedFiles.push({
            fileName: ediFileName,
            filePath: ediFilePath,
            tenant: group.tenant.name,
            hcm: group.hcm.name,
            visitCount: group.visits.length,
            billCount: billsForGroup.length,
          });

          // Add success results for all visits in this group
          for (const visit of group.visits) {
            results.push({
              visitId: visit._id,
              success: true,
              ediFileName,
              tenant: group.tenant.name,
              hcm: group.hcm.name,
              message: 'EDI generated successfully in batch',
            });
          }
        } else {
          console.error(
            `[MULTIPLE EDI] Failed to generate batch EDI for group: ${groupKey}`,
            batchResult.error
          );

          // Add failure results for all visits in this group
          for (const visit of group.visits) {
            results.push({
              visitId: visit._id,
              success: false,
              error: `Batch EDI generation failed: ${batchResult.error}`,
            });
          }
        }
      } catch (groupError) {
        console.error(
          `[MULTIPLE EDI] Error processing group ${groupKey}:`,
          groupError
        );

        // Add failure results for all visits in this group
        for (const visit of group.visits) {
          results.push({
            visitId: visit._id,
            success: false,
            error: `Group processing failed: ${groupError.message}`,
          });
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;
    return res.status(200).json({
      success: true,
      message: `Processed ${visits.length} visits: ${successCount} successful, ${failureCount} failed`,
      results,
      generatedFiles,
      summary: {
        totalVisits: visits.length,
        successCount,
        failureCount,
        batchesGenerated: generatedFiles.length,
      },
    });
  } catch (error) {
    console.error('[MULTIPLE EDI] Error in generateMultipleVisitsEdi:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while generating multiple visits EDI',
      error: error.message,
    });
  }
};

export const getClaimVisits = async (req, res) => {
  try {
    const { claimId } = req.params;

    if (!claimId) {
      return res.status(400).json({
        success: false,
        message: 'Claim ID is required',
      });
    }

    // Get all visit mappings for this claim
    const visitMappings = await ClaimVisitMap.find({ claimId }).sort({
      serviceDate: 1,
    });

    if (!visitMappings || visitMappings.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No visit data found for mapped claim IDs',
        response: {
          claimId,
          visitGroups: [],
        },
      });
    }

    const allVisitIds = new Set();
    visitMappings.forEach((mapping) => {
      if (mapping.visitId) {
        allVisitIds.add(mapping.visitId.toString());
      }

      if (mapping.visitIds && Array.isArray(mapping.visitIds)) {
        mapping.visitIds.forEach((id) => {
          if (id) {
            allVisitIds.add(id.toString());
          }
        });
      }
    });

    const uniqueVisitIds = Array.from(allVisitIds);

    const visits = await Visits.find({ _id: { $in: uniqueVisitIds } })
      .populate('tenantId', 'name personalInfo')
      .populate('hcmId', 'name');

    if (visits.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No visit data found for mapped claim IDs',
        response: {
          claimId,
          visitGroups: [],
        },
      });
    }

    const visitsMap = {};
    visits.forEach((visit) => {
      visitsMap[visit._id.toString()] = visit;
    });

    const visitsByDateAndService = {};
    visitMappings.forEach((mapping) => {
      const visitIdsToProcess =
        mapping.visitIds &&
        Array.isArray(mapping.visitIds) &&
        mapping.visitIds.length > 0
          ? mapping.visitIds
          : [mapping.visitId.toString()];

      const validVisits = [];
      const processedVisitIds = new Set();

      visitIdsToProcess.forEach((visitId) => {
        const visitIdStr = visitId.toString();
        if (!processedVisitIds.has(visitIdStr)) {
          const visit = visitsMap[visitIdStr];
          if (visit) {
            validVisits.push(visit);
            processedVisitIds.add(visitIdStr);
          } else {
          }
        }
      });

      if (validVisits.length === 0) {
        return; // Skip if no valid visits
      }

      const dateKey = new Date(mapping.serviceDate).toISOString().split('T')[0];
      const serviceKey = mapping.serviceType || 'Unknown Service';
      const combinedKey = `${dateKey}_${serviceKey}`;

      if (!visitsByDateAndService[combinedKey]) {
        visitsByDateAndService[combinedKey] = {
          date: mapping.serviceDate,
          serviceType: mapping.serviceType || 'Unknown Service',
          procedureCode: mapping.procedureCode || 'H2015',
          visits: [],
          totalUnits: 0,
          totalAmount: 0,
          tenantInfo: validVisits[0].tenantId,
          hcmInfo: [], // Track all HCMs
        };
      }

      // Add all visits to the group
      validVisits.forEach((visit) => {
        visitsByDateAndService[combinedKey].visits.push(visit);

        // Add HCM to the list if not already included
        if (
          visit.hcmId &&
          !visitsByDateAndService[combinedKey].hcmInfo.some(
            (hcm) =>
              hcm._id &&
              visit.hcmId._id &&
              hcm._id.toString() === visit.hcmId._id.toString()
          )
        ) {
          visitsByDateAndService[combinedKey].hcmInfo.push(visit.hcmId);
        }
      });

      visitsByDateAndService[combinedKey].totalUnits = mapping.mergedUnits || 0;
      visitsByDateAndService[combinedKey].totalAmount =
        mapping.mergedAmount || 0;
    });

    // Convert to array for response
    const groupedVisits = Object.values(visitsByDateAndService);

    return res.status(200).json({
      success: true,
      message: 'Claim visits fetched successfully',
      response: groupedVisits,
    });
  } catch (error) {
    console.error('Error in getClaimVisits:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching claim visits',
      error: error.message,
    });
  }
};

// Add a function to update plan usage data for a specific tenant
export const updatePlanUsage = async (req, res) => {
  try {
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required',
      });
    }

    // Find all service tracking records for this tenant
    const serviceTrackingRecords = await ServiceTracking.find({ tenantId });

    if (serviceTrackingRecords.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No service tracking records found for this tenant',
      });
    }

    // Process each service tracking record
    const updatedRecords = [];
    for (const record of serviceTrackingRecords) {
      // Recalculate worked units and scheduled units from HCM entries
      let totalWorkedUnits = 0;
      let totalScheduledUnits = 0;

      if (record.hcms && record.hcms.length > 0) {
        record.hcms.forEach((hcm) => {
          // Sum up worked units from HCM
          totalWorkedUnits += hcm.workedUnits || 0;

          // Sum up scheduled units from HCM
          totalScheduledUnits += hcm.scheduledUnits || 0;
        });
      }

      // Update the service tracking record with the calculated values
      record.workedUnits = totalWorkedUnits;
      record.scheduledUnits = totalScheduledUnits;

      // Calculate remaining units correctly: total - worked - scheduled
      record.unitsRemaining = Math.max(
        0,
        record.totalUnits - totalWorkedUnits - totalScheduledUnits
      );

      // Save the updated record
      await record.save();
      updatedRecords.push({
        _id: record._id,
        serviceType: record.serviceType,
        totalUnits: record.totalUnits,
        workedUnits: record.workedUnits,
        scheduledUnits: record.scheduledUnits,
        unitsRemaining: record.unitsRemaining,
      });
    }

    // Now fetch the updated plan usage data
    const planUsageData = await planUsage({ body: { tenantId } }, null, true);

    return res.status(200).json({
      success: true,
      message: `Successfully updated plan usage for tenant ${tenantId}`,
      updatedRecords,
      planUsage: planUsageData.response,
    });
  } catch (error) {
    console.error('Error in updatePlanUsage:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// Add a function to delete all bills and reset claim-visit mappings
export const deleteAllBills = async (req, res) => {
  try {
    // Delete all bills
    const result = await Bill.deleteMany({});
    // Delete all claim-visit mappings
    const claimVisitMapResult = await ClaimVisitMap.deleteMany({});
    return res.status(200).json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} bills and ${claimVisitMapResult.deletedCount} claim-visit mappings`,
      deletedBills: result.deletedCount,
      deletedMappings: claimVisitMapResult.deletedCount,
    });
  } catch (error) {
    console.error('Error deleting bills:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// Enhanced function to update batch status with proper handling of cancelled claims
export const updateBatchStatus = async (req, res) => {
  const { claimIds, status, scheduledDate } = req.body;

  if (
    !claimIds ||
    !Array.isArray(claimIds) ||
    claimIds.length === 0 ||
    !status
  ) {
    return res.status(400).json({
      success: false,
      message: 'Claim IDs and status are required',
    });
  }
  try {
    // Prepare update data
    let updateData = { status };
    if (status === 'cancelled') {
      updateData.scheduledFor = null;
      updateData.cancelledAt = new Date();
      updateData.status = 'cancelled';
    }
    // Set scheduled date for non-cancelled claims
    if (scheduledDate) {
      updateData.scheduledFor = scheduledDate;
      updateData.cancelledAt = null;
      updateData.status = 'scheduled';
    }
    if (status === 'submitted') {
      updateData.cancelledAt = null;
      updateData.status = 'submitted';
    }

    const updatePromises = claimIds.map(async (claimId) => {
      try {
        // Allow updating all claims, including cancelled and submitted ones
        const claim = await Bills.findByIdAndUpdate(claimId, updateData, {
          new: true,
        });

        if (!claim) {
          return { claimId, success: false, message: 'Claim not found' };
        }

        return { claimId, success: true, claim };
      } catch (error) {
        return { claimId, success: false, message: error.message };
      }
    });

    const updatedClaims = await Promise.all(updatePromises);

    const successfulUpdates = updatedClaims.filter((result) => result.success);
    const failedUpdates = updatedClaims.filter((result) => !result.success);

    res.status(200).json({
      success: true,
      message: `Successfully updated ${successfulUpdates.length} claims${
        failedUpdates.length > 0 ? `, ${failedUpdates.length} failed` : ''
      }`,
      response: {
        status,
        scheduledDate: updateData.scheduledFor,
        successful: successfulUpdates,
        failed: failedUpdates,
      },
    });
  } catch (error) {
    console.error('Error updating batch status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update batch status',
      error: error.message,
    });
  }
};

// Function to cancel multiple claims
export const cancelBatch = async (req, res) => {
  const { claimIds } = req.body;

  if (!claimIds || !Array.isArray(claimIds) || claimIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Claim IDs are required',
    });
  }

  try {
    const updateData = {
      status: 'cancelled',
      scheduledFor: null, // Clear scheduled date when cancelled
      cancelledAt: new Date(), // Track when it was cancelled
    };

    const updatePromises = claimIds.map(async (claimId) => {
      try {
        const claim = await Bills.findByIdAndUpdate(claimId, updateData, {
          new: true,
        });

        if (!claim) {
          return { claimId, success: false, message: 'Claim not found' };
        }

        return { claimId, success: true, claim };
      } catch (error) {
        return { claimId, success: false, message: error.message };
      }
    });

    const updatedClaims = await Promise.all(updatePromises);

    const successfulUpdates = updatedClaims.filter((result) => result.success);
    const failedUpdates = updatedClaims.filter((result) => !result.success);

    res.status(200).json({
      success: true,
      message: `Successfully cancelled ${successfulUpdates.length} claims${
        failedUpdates.length > 0 ? `, ${failedUpdates.length} failed` : ''
      }`,
      response: {
        successful: successfulUpdates,
        failed: failedUpdates,
      },
    });
  } catch (error) {
    console.error('Error cancelling claims:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel claims',
      error: error.message,
    });
  }
};
