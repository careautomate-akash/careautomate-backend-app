import users from '../../models/account/users.js';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import sftpUploader from '../../utils/sftpUploader.js';
import Visits from '../../models/appointments-visits/visits.js';
import {
  generateEDI,
  generateBatchEDI as generateBatchEDIFromFile,
} from '../../tasks/generateEdiFile.js';
import { setupUploadDirectories } from '../../utils/setupDirectories.js';
import User from '../../models/account/users.js';
import ClaimAuditLog from '../../models/bills/claimAuditLog.js';
import causers from '../../models/account/users.js';
import TenantInfo from '../../models/hcm-tenants/tenantInfo.js';
import accountSetup from '../../models/account/accountSetup.js';
import Batches from '../../models/bills/batches.js';
import EDIGenerator from './coreedi.js';
import visits from '../../models/appointments-visits/visits.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== TIMEZONE UTILITY FUNCTIONS =====

/**
 * Convert UTC date to user's timezone and get the date string in YYYY-MM-DD format
 * @param {Date} utcDate - UTC date object
 * @param {string} userTimezone - User's timezone (e.g., 'America/New_York', 'Asia/Kolkata')
 * @returns {string} Date string in YYYY-MM-DD format in user's timezone
 */
function getDateInUserTimezone(utcDate, userTimezone) {
  if (!utcDate || !userTimezone) {
    return utcDate?.toISOString().split('T')[0];
  }

  try {
    // Special handling for dates stored as UTC midnight
    // These were likely created as date-only inputs and need timezone-aware interpretation
    if (
      utcDate.getUTCHours() === 0 &&
      utcDate.getUTCMinutes() === 0 &&
      utcDate.getUTCSeconds() === 0
    ) {
      // For dates stored as UTC midnight, we assume they were originally created in US Eastern timezone
      // and need to be converted to the user's timezone with proper offset consideration

      const dateStr = utcDate.toISOString().split('T')[0]; // Get YYYY-MM-DD

      // Create a date representing the same calendar date in US Eastern timezone
      // Use noon to avoid DST issues
      const usEasternNoon = new Date(`${dateStr}T17:00:00.000Z`); // 12 PM EST = 5 PM UTC (standard time)

      // Now convert this to the user's timezone to get the correct date
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: userTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

      return formatter.format(usEasternNoon);
    } else {
      // For non-midnight times, use standard timezone conversion
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: userTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });

      return formatter.format(utcDate);
    }
  } catch (error) {
    console.error('Error converting date to user timezone:', error);
    return utcDate.toISOString().split('T')[0];
  }
}

// ===== END TIMEZONE UTILITY FUNCTIONS =====

/**
 * Apply dynamic filters to get visits and organize them into batches/claims
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const applyDynamicFilters = async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      companyId,
      startDate,
      endDate,
      tenantIds = [],
      hcmIds = [],
      serviceTypes = [],
      visitStatuses = ['approved'],
      claimStatuses = [
        'not_scheduled',
        'scheduled',
        'submitted',
        'billed',
        'cancelled',
      ],
      includeSubmitted = true,
      page = 1,
      limit = 1000,
      userTimezone = 'UTC', // Default to UTC if not provided
      clientname,
      staffname,
      payer,
    } = req.body;

    const userId = req.user?.id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required',
      });
    }

    // Build query filter for visits - only select approved visits
    const visitQuery = {
      companyId: companyId,
      status: { $in: visitStatuses }, // Only select visits with specified statuses (approved)
    };

    // Add claim status filter
    if (claimStatuses.length > 0) {
      visitQuery.claimStatus = { $in: claimStatuses };
    }

    // Date range filter
    if (startDate || endDate) {
      visitQuery.date = {};
      if (startDate) {
        // Parse the date string and create a proper date range
        // Handle YYYY-MM-DD format from frontend
        const dateParts = startDate.split('-');
        if (dateParts.length === 3) {
          const year = parseInt(dateParts[0], 10);
          const month = parseInt(dateParts[1], 10) - 1; // Month is 0-indexed
          const day = parseInt(dateParts[2], 10);

          // Create start of day in UTC to avoid timezone issues
          const startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
          visitQuery.date.$gte = startOfDay;
         
        } else {
          // Fallback to original logic for other formats
          const startOfDay = new Date(startDate);
          startOfDay.setHours(0, 0, 0, 0);
          visitQuery.date.$gte = startOfDay;
        }
      }
      if (endDate) {
        // Parse the date string and create a proper date range
        // Handle YYYY-MM-DD format from frontend
        const dateParts = endDate.split('-');
        if (dateParts.length === 3) {
          const year = parseInt(dateParts[0], 10);
          const month = parseInt(dateParts[1], 10) - 1; // Month is 0-indexed
          const day = parseInt(dateParts[2], 10);

          // Create end of day in UTC to avoid timezone issues
          const endOfDay = new Date(
            Date.UTC(year, month, day, 23, 59, 59, 999)
          );
          visitQuery.date.$lte = endOfDay;
        
        } else {
          // Fallback to original logic for other formats
          const endOfDay = new Date(endDate);
          endOfDay.setHours(23, 59, 59, 999);
          visitQuery.date.$lte = endOfDay;
        }
      }
    }

// Tenant filter
    if (tenantIds.length > 0) {
      visitQuery.tenantId = { $in: tenantIds };
    }

    // HCM filter
    if (hcmIds.length > 0) {
      visitQuery.hcmId = { $in: hcmIds };
    }

    // Service type filter
    if (serviceTypes.length > 0) {
      visitQuery.serviceType = { $in: serviceTypes };
    }

    // clientname filter which is tenant name
    if (clientname) {
      const matchingTenants = await users
        .find({
          name: { $regex: clientname, $options: 'i' },
        })
        .select('_id')
        .lean();

      if (matchingTenants.length > 0) {
        visitQuery.tenantId = { $in: matchingTenants.map((t) => t._id) };
      } else {
        // No matches - return empty results
        visitQuery.tenantId = { $in: [] };
      }
    }

    // staffname filter which is HCM name
    if (staffname) {
      const matchingHCMs = await users
        .find({
          name: { $regex: staffname, $options: 'i' },
        })
        .select('_id')
        .lean();
      if (matchingHCMs.length > 0) {
        visitQuery.hcmId = { $in: matchingHCMs.map((h) => h._id) };
      } else {
        // No matches - return empty results
        visitQuery.hcmId = { $in: [] };
      }
    }

    // payer filter - matches insurance field inside TenantInfo
    if (payer) {
      const matchingTenantInfoDocs = await TenantInfo.find({
        'admissionInfo.insurance': { $regex: payer, $options: 'i' },
      })
        .select('_id')
        .lean();

      if (matchingTenantInfoDocs.length > 0) {
        const matchingInfoIds = matchingTenantInfoDocs.map((doc) =>
          doc._id.toString()
        );

        // You need to find all users (tenants) where info_id matches
        const matchingTenantsByInsurance = await users
          .find({
            info_id: { $in: matchingInfoIds },
          })
          .select('_id')
          .lean();

        if (matchingTenantsByInsurance.length > 0) {
          const tenantIdsByInsurance = matchingTenantsByInsurance.map(
            (t) => t._id
          );
          visitQuery.tenantId = {
            ...(visitQuery.tenantId || {}),
            $in: tenantIdsByInsurance,
          };
        } else {
          // No matching tenants
          visitQuery.tenantId = { $in: [] };
        }
      } else {
        // No matching insurance
        visitQuery.tenantId = { $in: [] };
      }
    }

// Execute query with pagination for visits
    const skip = (page - 1) * limit;
    const [visits, totalVisitCount] = await Promise.all([
      Visits.find(visitQuery)
        .populate('tenantId', 'name email info_id')
        .populate('hcmId', 'name email')
        .populate('scheduledBy', 'name email')
        .populate('submittedBy', 'name email')
        .populate('billedBy', 'name email')
        .populate('cancelledBy', 'name email')
        .populate({
          path: 'serviceId',
          select: 'service_name service_procedure_code service_modifiers service_rate',
          model: 'Service',
        })
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Visits.countDocuments(visitQuery),
    ]);

    // use info_id to get tenant data
    const tenentData = await TenantInfo.find({
      _id: { $in: visits.map((v) => v.tenantId.info_id) },
    }).lean();

visits.forEach((visit) => {
      if (visit.scheduledDate || visit.cancelledDate) {
      }
    });

// Enhance visits with time, units, and amount calculations
    const enhancedVisits = visits.map((visit) => {
      // Calculate time in hours
      let timeInHours = 0;
      if (visit.startTime && visit.endTime) {
        const startTime = new Date(visit.startTime);
        const endTime = new Date(visit.endTime);
        timeInHours = (endTime - startTime) / (1000 * 60 * 60); // Convert milliseconds to hours
      } else {
        // Default to 1 hour if no time specified
        timeInHours = 1;
      }

      // Calculate units (15 minutes = 1 unit)
      const units = Math.max(1, Math.ceil((timeInHours * 60) / 15)); // Convert hours to 15-minute units

      // Use ratePerUnit from serviceId (populated Service)
      const ratePerUnit = visit.serviceId?.service_rate || 17.17; // fallback if not present
      const calculatedAmount = units * ratePerUnit;
      const tenentInsurance =
        tenentData.find(
          (t) => t._id.toString() === visit.tenantId.info_id.toString()
        )?.admissionInfo.insurance || 'Not Provided';

      return {
        ...visit,
        timeInHours: Math.round(timeInHours * 100) / 100, // Round to 2 decimal places
        calculatedUnits: units,
        calculatedAmount: Math.round(calculatedAmount * 100) / 100, // Round to 2 decimal places
        ratePerUnit,
        claimAmount: visit.claimAmount || calculatedAmount,
        claimUnits: visit.claimUnits || units,
        hasEDI: !!visit.ediContent,
        billStatus: visit.claimStatus || 'not_scheduled',
        insurance: tenentInsurance,
      };
    });

    // Group visits by same day, tenant, HCM, and service for display
    const groupedVisits = groupVisitsByDayTenantHcmService(
      enhancedVisits,
      userTimezone
    );

    // Group visits into batches and claims
    const { batches, claims } = await organizeVisitsIntoBatchesAndClaims(
      enhancedVisits,
      startDate,
      endDate,
      userTimezone
    );

    // Generate EDI for claims that don't have it yet (excluding submitted/billed)
    const ediGenerationResults = await generateEDIForClaims(
      claims,
      companyId,
      userId
    );

    const executionTime = Date.now() - startTime;

    // Log the filter operation
    if (userId) {
      await logAuditAction({
        companyId,
        userId,
        entityType: 'filter',
        entityId: `FILTER_${Date.now()}`,
        action: 'filter_applied',
        description: `Applied dynamic filters to retrieve ${enhancedVisits.length} visits organized into ${batches.length} batches and ${claims.length} claims`,
        metadata: {
          filters: {
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null,
            tenantIds,
            hcmIds,
            serviceTypes,
            visitStatuses,
            claimStatuses,
          },
          performance: {
            executionTimeMs: executionTime,
            recordsProcessed: totalVisitCount,
            recordsAffected: enhancedVisits.length,
          },
        },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Filters applied successfully',
      data: {
        visits: enhancedVisits,
        groupedVisits,
        batches,
        claims,
        ediGenerationResults,
        summary: {
          totalVisits: enhancedVisits.length,
          totalBatches: batches.length,
          totalClaims: claims.length,
          statusBreakdown: getStatusBreakdown(enhancedVisits),
          ediGenerated: ediGenerationResults.successful,
          ediErrors: ediGenerationResults.errors,
        },
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalVisitCount / limit),
          totalRecords: totalVisitCount,
          hasNextPage: skip + enhancedVisits.length < totalVisitCount,
          hasPrevPage: page > 1,
        },
        performance: {
          executionTimeMs: executionTime,
          recordsRetrieved: enhancedVisits.length,
        },
      },
    });
  } catch (error) {
    const executionTime = Date.now() - startTime;

    console.error('Error applying dynamic filters:', error);

    // Log error
    if (req.user?.id) {
      await logAuditAction({
        companyId: req.body.companyId,
        userId: req.user.id,
        entityType: 'filter',
        entityId: `FILTER_ERROR_${Date.now()}`,
        action: 'filter_failed',
        description: 'Failed to apply dynamic filters',
        metadata: {
          error: {
            message: error.message,
            stack: error.stack,
          },
          performance: {
            executionTimeMs: executionTime,
          },
        },
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error applying filters',
      error: error.message,
    });
  }
};

export const getPayerWiseAmount = async (req, res) => {
  const { companyId, startDate, endDate } = req.body;

  try {
    if (!companyId) {
      return res
        .status(400)
        .json({ success: false, message: 'companyId is required' });
    }

    // Step 1: Visit query
    const visitQuery = { companyId };
    if (startDate || endDate) {
      visitQuery.date = {};
      if (startDate)
        visitQuery.date.$gte = new Date(startDate + 'T00:00:00.000Z');
      if (endDate) visitQuery.date.$lte = new Date(endDate + 'T23:59:59.999Z');
    }

    const visits = await Visits.find(visitQuery)
      .populate('tenantId', 'info_id')
      .lean();

    if (!visits.length) {
      return res.status(200).json({ success: true, data: [] });
    }

    // Step 2: Map insurance
    const infoIds = [
      ...new Set(
        visits.map((v) => v.tenantId?.info_id?.toString()).filter(Boolean)
      ),
    ];
    const tenantInfos = await TenantInfo.find({ _id: { $in: infoIds } })
      .select('_id admissionInfo.insurance')
      .lean();

    const insuranceMap = {};
    tenantInfos.forEach((info) => {
      insuranceMap[info._id.toString()] =
        info.admissionInfo?.insurance?.toLowerCase() || 'unknown';
    });

    // Step 3: Initialize structures
    const payerSummary = {};
    const totalSummary = {
      insurance: 'Total',
      totalAmount: 0,
      approvedAmount: 0,
      rejectedAmount: 0,
      pendingAmount: 0,
      scheduledAmount: 0,
    };

    // Step 4: Loop visits
    for (const visit of visits) {
      const infoId = visit.tenantId?.info_id?.toString();
      const insurance = insuranceMap[infoId] || 'unknown';

      // Calculate amount
      let timeInHours = 1;
      if (visit.startTime && visit.endTime) {
        timeInHours =
          (new Date(visit.endTime) - new Date(visit.startTime)) /
          (1000 * 60 * 60);
      }
      const units = Math.max(1, Math.ceil((timeInHours * 60) / 15));
      const ratePerUnit = 17.17;
      const amount = Math.round(units * ratePerUnit * 100) / 100;

      // Init if not exists
      if (!payerSummary[insurance]) {
        payerSummary[insurance] = {
          insurance,
          totalAmount: 0,
          approvedAmount: 0,
          rejectedAmount: 0,
          pendingAmount: 0,
          scheduledAmount: 0,
        };
      }

      // Add to total
      payerSummary[insurance].totalAmount += amount;
      totalSummary.totalAmount += amount;

      // Categorize by claimStatus
      const status = visit.claimStatus || 'not_scheduled';
      if (status === 'billed') {
        payerSummary[insurance].approvedAmount += amount;
        totalSummary.approvedAmount += amount;
      } else if (status === 'cancelled') {
        payerSummary[insurance].rejectedAmount += amount;
        totalSummary.rejectedAmount += amount;
      } else if (status === 'not_scheduled') {
        payerSummary[insurance].pendingAmount += amount;
        totalSummary.pendingAmount += amount;
      } else if (status === 'scheduled') {
        payerSummary[insurance].scheduledAmount += amount;
        totalSummary.scheduledAmount += amount;
      }
    }

    // Step 5: Final result
    const result = Object.values(payerSummary).map((entry) => ({
      insurance: entry.insurance,
      totalAmount: Math.round(entry.totalAmount * 100) / 100,
      approvedAmount: Math.round(entry.approvedAmount * 100) / 100,
      rejectedAmount: Math.round(entry.rejectedAmount * 100) / 100,
      pendingAmount: Math.round(entry.pendingAmount * 100) / 100,
      scheduledAmount: Math.round(entry.scheduledAmount * 100) / 100,
    }));

    const finalResult = {
      individualPayers: result,
      totalPayer: {
        insurance: 'Total',
        totalAmount: Math.round(totalSummary.totalAmount * 100) / 100,
        approvedAmount: Math.round(totalSummary.approvedAmount * 100) / 100,
        rejectedAmount: Math.round(totalSummary.rejectedAmount * 100) / 100,
        pendingAmount: Math.round(totalSummary.pendingAmount * 100) / 100,
        scheduledAmount: Math.round(totalSummary.scheduledAmount * 100) / 100,
      },
    };

    return res.status(200).json({ success: true, data: finalResult });
  } catch (error) {
    console.error('Error in getPayerWiseAmountWithStatusAmount:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

export const getPayerWiseMonthlyAmount = async (req, res) => {
  const { companyId, year, fromMonth, toMonth, payer } = req.body;

  try {
    if (!companyId || !year || !fromMonth || !toMonth) {
      return res.status(400).json({
        success: false,
        message: 'companyId, year, fromMonth, and toMonth are required',
      });
    }

    // Convert month names to numbers (Jan -> 1, Feb -> 2, etc.)
    const monthMap = {
      Jan: 1,
      Feb: 2,
      Mar: 3,
      Apr: 4,
      May: 5,
      Jun: 6,
      Jul: 7,
      Aug: 8,
      Sep: 9,
      Oct: 10,
      Nov: 11,
      Dec: 12,
    };

    const startMonth = monthMap[fromMonth];
    const endMonth = monthMap[toMonth];

    if (!startMonth || !endMonth || startMonth > endMonth) {
      return res.status(400).json({
        success: false,
        message: 'Invalid month range provided',
      });
    }

    // Create date range for each month
    const monthlyDateRanges = [];
    for (let month = startMonth; month <= endMonth; month++) {
      const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
      monthlyDateRanges.push({
        month: Object.keys(monthMap).find((key) => monthMap[key] === month),
        startDate,
        endDate,
      });
    }

    // Step 1: Get all visits for the company within the date range
    const visitQuery = {
      companyId,
      date: {
        $gte: monthlyDateRanges[0].startDate,
        $lte: monthlyDateRanges[monthlyDateRanges.length - 1].endDate,
      },
    };

    const visits = await Visits.find(visitQuery)
      .populate('tenantId', 'info_id')
      .lean();

    if (!visits.length) {
      return res.status(200).json({
        success: true,
        data: {
          year,
          from: fromMonth,
          to: toMonth,
          companyId,
          payer: payer || 'all',
          totalAmount: 0,
          pendingAmount: 0,
          approvedAmount: 0,
          scheduledAmount: 0,
          rejectedAmount: 0,
          ...monthlyDateRanges.reduce((acc, { month }) => {
            acc[month.toLowerCase()] = {
              totalAmount: 0,
              pendingAmount: 0,
              approvedAmount: 0,
              scheduledAmount: 0,
              rejectedAmount: 0,
            };
            return acc;
          }, {}),
        },
      });
    }

    // Step 2: Get insurance information for all tenants
    const infoIds = [
      ...new Set(
        visits.map((v) => v.tenantId?.info_id?.toString()).filter(Boolean)
      ),
    ];
    const tenantInfos = await TenantInfo.find({ _id: { $in: infoIds } })
      .select('_id admissionInfo.insurance')
      .lean();

    const insuranceMap = {};
    tenantInfos.forEach((info) => {
      insuranceMap[info._id.toString()] =
        info.admissionInfo?.insurance?.toLowerCase() || 'unknown';
    });

    // Step 3: Initialize result structure
    const result = {
      year,
      from: fromMonth,
      to: toMonth,
      companyId,
      payer: payer || 'all',
      totalAmount: 0,
      pendingAmount: 0,
      approvedAmount: 0,
      scheduledAmount: 0,
      rejectedAmount: 0,
    };

    // Initialize monthly breakdowns
    monthlyDateRanges.forEach(({ month }) => {
      result[month.toLowerCase()] = {
        totalAmount: 0,
        pendingAmount: 0,
        approvedAmount: 0,
        scheduledAmount: 0,
        rejectedAmount: 0,
      };
    });

    // Step 4: Process each visit
    for (const visit of visits) {
      const infoId = visit.tenantId?.info_id?.toString();
      const insurance = insuranceMap[infoId] || 'unknown';

      // Skip if payer filter is specified and doesn't match
      if (payer && payer !== 'all' && insurance !== payer.toLowerCase()) {
        continue;
      }

      // Calculate amount
      let timeInHours = 1;
      if (visit.startTime && visit.endTime) {
        timeInHours =
          (new Date(visit.endTime) - new Date(visit.startTime)) /
          (1000 * 60 * 60);
      }
      const units = Math.max(1, Math.ceil((timeInHours * 60) / 15));
      const ratePerUnit = 17.17;
      const amount = Math.round(units * ratePerUnit * 100) / 100;

      // Determine which month this visit belongs to
      const visitDate = new Date(visit.date);
      const visitMonth = visitDate.getUTCMonth() + 1; // 1-12
      const monthName = Object.keys(monthMap)
        .find((key) => monthMap[key] === visitMonth)
        .toLowerCase();

      // Add to totals
      result.totalAmount += amount;
      result[monthName].totalAmount += amount;

      // Categorize by claimStatus
      const status = visit.claimStatus || 'not_scheduled';
      if (status === 'billed') {
        result.approvedAmount += amount;
        result[monthName].approvedAmount += amount;
      } else if (status === 'cancelled') {
        result.rejectedAmount += amount;
        result[monthName].rejectedAmount += amount;
      } else if (status === 'not_scheduled') {
        result.pendingAmount += amount;
        result[monthName].pendingAmount += amount;
      } else if (status === 'scheduled') {
        result.scheduledAmount += amount;
        result[monthName].scheduledAmount += amount;
      }
    }

    // Round all amounts to 2 decimal places
    const roundAmounts = (obj) => {
      Object.keys(obj).forEach((key) => {
        if (typeof obj[key] === 'number') {
          obj[key] = Math.round(obj[key] * 100) / 100;
        } else if (typeof obj[key] === 'object') {
          roundAmounts(obj[key]);
        }
      });
    };
    roundAmounts(result);

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Error in getPayerWiseMonthlyAmount:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

export const storeBatchDetails = async (req, res) => {
  const { batchName, companyId, ediFiles, batchStatus, batchDate } = req.body;
  try {
    if (
      !batchName ||
      !companyId ||
      !ediFiles ||
      ediFiles.length === 0 ||
      !batchDate
    ) {
      return res.status(400).json({
        success: false,
        message: 'batchName, companyId, ediFiles, and batchDate are required',
      });
    }

    // Step 2: Store batch details
    const batch = new Batches({
      batchName,
      companyId,
      ediFiles,
      batchStatus,
      batchDate: new Date(batchDate),
    });
    await batch.save();

    if (batchStatus !== 'scheduled') {
      // send immediate to ftp
      for (const ediFile of ediFiles) {
        try {
          const fileName = ediFile.fileName;
          const content = ediFile.ediContent;
          const localPath = path.join(os.tmpdir(), fileName);

          // Write content to temp file
          await fsp.writeFile(localPath, content);

          // Upload to SFTP
          await sftpUploader(localPath, fileName);
          // Optional: Delete after upload
          await fsp.unlink(localPath);
        } catch (err) {
          console.error(
            `❌ Failed to upload ${ediFile.fileName}:`,
            err.message
          );
        }
      }
    }

    return res.status(201).json({
      success: true,
      data: batch,
    });
  } catch (error) {
    console.error('Error in storeBatchDetails:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};
export const getBatchesofCompany = async (req, res) => {
  const { companyId } = req.params;
  try {
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'companyId is required',
      });
    }

    // Step 1: Get all batches for the company
    const batches = await Batches.find({ companyId });

    res.status(200).json({
      success: true,
      data: batches,
    });
  } catch (error) {
    console.error('Error in getBatchesofCompany:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

export const getPayerNames = async (req, res) => {
  const { companyId } = req.body;
  try {
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'companyId is required',
      });
    }
    // Step 1: Get all visits for the company
    const visits = await Visits.find({ companyId })
      .populate('tenantId', 'info_id')
      .lean();
    if (!visits.length) {
      return res.status(200).json({ success: true, data: [] });
    }
    // Step 2: Get insurance information for all tenants
    const infoIds = [
      ...new Set(
        visits.map((v) => v.tenantId?.info_id?.toString()).filter(Boolean)
      ),
    ];
    const tenantInfos = await TenantInfo.find({ _id: { $in: infoIds } })
      .select('_id admissionInfo.insurance')
      .lean();
    const insuranceSet = new Set();
    tenantInfos.forEach((info) => {
      if (info.admissionInfo?.insurance) {
        insuranceSet.add(info.admissionInfo.insurance.toLowerCase());
      }
    });
    // Step 3: Convert Set to Array and sort

    const payerNames = Array.from(insuranceSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    const payerNamesFormatted = payerNames.map((name) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value: name.toLowerCase(),
    }));
    return res.status(200).json({ success: true, data: payerNamesFormatted });
  } catch (error) {
    console.error('Error in getPayerNames:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

// get visit history by visit ID like shedule, submit, cancel, bill and involved in batch like history of
// date, action, user
export const getVisitHistory = async (req, res) => {
  const { visitId } = req.body;
  try {
    if (!visitId) {
      return res.status(400).json({
        success: false,
        message: 'visitId is required',
      });
    }

    // Step 1: Get the visit by ID
    const visit = await Visits.findById(visitId)
      .populate('tenantId', 'name email')
      .populate('hcmId', 'name email')
      .populate('scheduledBy', 'name email')
      .populate('submittedBy', 'name email')
      .populate('billedBy', 'name email')
      .populate('cancelledBy', 'name email')
      .lean();
    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found',
      });
    }

    // Step 2: Get the history of actions performed on this visit
    const history = [];
    if (visit.scheduledDate) {
      history.push({
        date: visit.scheduledDate,
        action: 'Scheduled',
        user: visit.scheduledBy?.name || 'System',
      });
    }
    if (visit.submittedDate) {
      history.push({
        date: visit.submittedDate,
        action: 'Submitted',
        user: visit.submittedBy?.name || 'System',
      });
    }
    if (visit.cancelledDate) {
      history.push({
        date: visit.cancelledDate,
        action: 'Cancelled',
        user: visit.cancelledBy?.name || 'System',
        reason: visit.cancellationReason || 'No reason provided',
      });
    }
    if (visit.billedDate) {
      history.push({
        date: visit.billedDate,
        action: 'Billed',
        user: visit.billedBy?.name || 'System',
      });
    }

    // Step 3: Sort history by date
    history.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.status(200).json({
      success: true,
      data: {
        visit,
        history,
      },
    });
  } catch (error) {
    console.error('Error in getVisitHistory:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

/**
 * Update visit status (schedule, submit, cancel, bill)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const updateVisitStatus = async (req, res) => {
  const startTime = Date.now();

  try {
    const {
      visitIds = [],
      action, // 'schedule', 'submit', 'cancel', 'bill'
      scheduledDate,
      cancellationReason,
      companyId,
    } = req.body;

    const userId = req.user?.id;

    if (!companyId || !action || visitIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Company ID, action, and visit IDs are required',
      });
    }

    const results = {
      successful: [],
      failed: [],
    };

    for (const visitId of visitIds) {
      try {
        const visit = await Visits.findById(visitId);
        if (!visit) {
          results.failed.push({
            visitId,
            error: 'Visit not found',
          });
          continue;
        }

        // Check if visit belongs to company
        if (visit.companyId.toString() !== companyId) {
          results.failed.push({
            visitId,
            error: 'Visit does not belong to this company',
          });
          continue;
        }

        let updateData = {};
        let newStatus = visit.claimStatus;

        switch (action) {
          case 'schedule':
            if (
              visit.claimStatus === 'submitted' ||
              visit.claimStatus === 'billed'
            ) {
              results.failed.push({
                visitId,
                error: 'Cannot reschedule submitted or billed visit',
              });
              continue;
            }
            updateData = {
              claimStatus: 'scheduled',
              scheduledDate: scheduledDate
                ? new Date(scheduledDate)
                : new Date(),
              scheduledBy: userId,
              // Clear cancelled date if rescheduling a previously cancelled visit
              cancelledDate: null,
              cancelledBy: null,
              cancellationReason: null,
            };
            newStatus = 'scheduled';
            break;

          case 'submit':
            if (visit.claimStatus === 'cancelled') {
              results.failed.push({
                visitId,
                error: 'Cannot submit cancelled visit',
              });
              continue;
            }
            updateData = {
              claimStatus: 'submitted',
              submittedDate: new Date(),
              submittedBy: userId,
            };
            newStatus = 'submitted';
            break;

          case 'cancel':
            if (visit.claimStatus === 'billed') {
              results.failed.push({
                visitId,
                error: 'Cannot cancel billed visit',
              });
              continue;
            }
            updateData = {
              claimStatus: 'cancelled',
              cancelledDate: new Date(),
              cancelledBy: userId,
              cancellationReason: cancellationReason || 'Cancelled by user',
            };
            newStatus = 'cancelled';
            break;

          case 'bill':
            // if (visit.claimStatus !== 'submitted') {
            //   results.failed.push({
            //     visitId,
            //     error: 'Can only bill submitted visits',
            //   });
            //   continue;
            // }
            updateData = {
              claimStatus: 'billed',
              billedDate: new Date(),
              billedBy: userId,
            };
            newStatus = 'billed';
            break;

          default:
            results.failed.push({
              visitId,
              error: 'Invalid action',
            });
            continue;
        }

        const updatedVisit = await Visits.findByIdAndUpdate(
          visitId,
          updateData,
          { new: true }
        );

        // Debug: Log the updated visit data
        // Log the action
        await logAuditAction({
          companyId,
          userId,
          entityType: 'visit',
          entityId: visitId,
          action: `visit_${action}`,
          description: `Visit ${action}d successfully`,
          metadata: {
            previousStatus: visit.claimStatus,
            newStatus,
            updateData,
            updatedFields: {
              scheduledDate: updatedVisit.scheduledDate,
              submittedDate: updatedVisit.submittedDate,
              cancelledDate: updatedVisit.cancelledDate,
            },
          },
        });

        results.successful.push({
          visitId,
          action,
          previousStatus: visit.claimStatus,
          newStatus,
        });
      } catch (error) {
        results.failed.push({
          visitId,
          error: error.message,
        });
      }
    }

    const executionTime = Date.now() - startTime;

    res.status(200).json({
      success: true,
      message: `Visit status update completed: ${results.successful.length} successful, ${results.failed.length} failed`,
      data: {
        results,
        summary: {
          totalProcessed: visitIds.length,
          successful: results.successful.length,
          failed: results.failed.length,
          action,
        },
        performance: {
          executionTimeMs: executionTime,
        },
      },
    });
  } catch (error) {
    const executionTime = Date.now() - startTime;

    console.error('Error updating visit status:', error);

    res.status(500).json({
      success: false,
      message: 'Error updating visit status',
      error: error.message,
      performance: {
        executionTimeMs: executionTime,
      },
    });
  }
};

/**
 * Generate EDI for individual visit
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const generateIndividualVisitEDI = async (req, res) => {
  const startTime = Date.now();

  try {
    const { visitId } = req.params;
    const { companyId } = req.body;
    const userId = req.user?.id;

    if (!visitId || !companyId) {
      return res.status(400).json({
        success: false,
        message: 'Visit ID and Company ID are required',
      });
    }

    // Get the visit
    const visit = await Visits.findById(visitId)
      .populate('tenantId', 'name email')
      .populate('hcmId', 'name email')
      .lean();

    if (!visit) {
      return res.status(404).json({
        success: false,
        message: 'Visit not found',
      });
    }

    if (visit.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        message: 'Visit does not belong to this company',
      });
    }

    // Generate EDI content
    const ediResult = await generateEDIForVisit(visit);

    if (!ediResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate EDI content',
        error: ediResult.error,
      });
    }

    // Update visit with EDI information
    await Visits.findByIdAndUpdate(visitId, {
      ediGenerated: true,
      ediGeneratedDate: new Date(),
      ediFileName: ediResult.fileName,
      ediContent: ediResult.content,
    });

    // Save EDI file to filesystem as text file
    const { uploadsDir } = setupUploadDirectories();
    const ediFilesDir = path.join(uploadsDir, 'ediFiles');
    const ediFilePath = path.join(ediFilesDir, ediResult.fileName);

    if (!fs.existsSync(ediFilesDir)) {
      fs.mkdirSync(ediFilesDir, { recursive: true });
    }

    fs.writeFileSync(ediFilePath, ediResult.content);
    const fileSize = fs.statSync(ediFilePath).size;

    const executionTime = Date.now() - startTime;

    // Log EDI generation
    await logAuditAction({
      companyId,
      userId,
      entityType: 'visit',
      entityId: visitId,
      action: 'edi_generated',
      description: `Generated EDI for individual visit`,
      metadata: {
        fileName: ediResult.fileName,
        fileSize,
        performance: {
          executionTimeMs: executionTime,
        },
      },
    });

    res.status(200).json({
      success: true,
      message: 'EDI generated successfully for visit',
      data: {
        visitId,
        ediFileName: ediResult.fileName,
        ediFilePath,
        fileSize,
        ediContent: ediResult.content,
        performance: {
          executionTimeMs: executionTime,
        },
      },
    });
  } catch (error) {
    const executionTime = Date.now() - startTime;

    console.error('Error generating individual visit EDI:', error);

    res.status(500).json({
      success: false,
      message: 'Error generating EDI for visit',
      error: error.message,
      performance: {
        executionTimeMs: executionTime,
      },
    });
  }
};

/**
 * Generate EDI for batch or claim
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const generateBatchEDI = async (req, res) => {
  const startTime = Date.now();

  try {
    const { batchId } = req.params;
    const { companyId, claimId } = req.body;
    const userId = req.user?.id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required',
      });
    }

    let visits = [];

    if (claimId) {
      // Generate EDI for specific claim
      visits = await Visits.find({
        claimId,
        companyId,
        claimStatus: { $nin: ['cancelled'] },
      })
        .populate('tenantId', 'name email')
        .populate('hcmId', 'name email')
        .lean();
    } else if (batchId) {
      // Generate EDI for entire batch
      visits = await Visits.find({
        batchId,
        companyId,
        claimStatus: { $nin: ['cancelled'] },
      })
        .populate('tenantId', 'name email')
        .populate('hcmId', 'name email')
        .lean();
    } else {
      return res.status(400).json({
        success: false,
        message: 'Either batch ID or claim ID is required',
      });
    }

    if (visits.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No visits found for EDI generation',
      });
    }

    // Generate consolidated EDI for all visits
    const ediResult = await generateEDIForVisits(visits, batchId || claimId);

    if (!ediResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate EDI content',
        error: ediResult.error,
      });
    }

    // Update visits with EDI information
    const visitIds = visits.map((v) => v._id);
    await Visits.updateMany(
      { _id: { $in: visitIds } },
      {
        ediGenerated: true,
        ediGeneratedDate: new Date(),
        ediFileName: ediResult.fileName,
      }
    );

    // Save EDI file to filesystem as text file
    const { uploadsDir } = setupUploadDirectories();
    const ediFilesDir = path.join(uploadsDir, 'ediFiles');
    const ediFilePath = path.join(ediFilesDir, ediResult.fileName);

    if (!fs.existsSync(ediFilesDir)) {
      fs.mkdirSync(ediFilesDir, { recursive: true });
    }

    fs.writeFileSync(ediFilePath, ediResult.content);
    const fileSize = fs.statSync(ediFilePath).size;

    const executionTime = Date.now() - startTime;

    // Log EDI generation
    await logAuditAction({
      companyId,
      userId,
      entityType: batchId ? 'batch' : 'claim',
      entityId: batchId || claimId,
      action: 'edi_generated',
      description: `Generated EDI for ${batchId ? 'batch' : 'claim'} with ${visits.length
        } visits`,
      metadata: {
        fileName: ediResult.fileName,
        fileSize,
        visitCount: visits.length,
        performance: {
          executionTimeMs: executionTime,
        },
      },
    });

    res.status(200).json({
      success: true,
      message: 'EDI generated successfully',
      data: {
        batchId: batchId || null,
        claimId: claimId || null,
        ediFileName: ediResult.fileName,
        ediFilePath,
        fileSize,
        visitCount: visits.length,
        ediContent: ediResult.content,
        performance: {
          executionTimeMs: executionTime,
        },
      },
    });
  } catch (error) {
    const executionTime = Date.now() - startTime;

    console.error('Error generating batch EDI:', error);

    res.status(500).json({
      success: false,
      message: 'Error generating EDI',
      error: error.message,
      performance: {
        executionTimeMs: executionTime,
      },
    });
  }
};

/**
 * Get batches for a company with filtering and pagination
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getBatches = async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      status = [],
      startDate,
      endDate,
      page = 1,
      limit = 20,
      sortBy = 'date',
      sortOrder = 'desc',
    } = req.query;

    const query = { companyId };

    // Date range filter
    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        query.date.$gte = new Date(startDate);
      }
      if (endDate) {
        query.date.$lte = new Date(endDate);
      }
    }

    // Status filter
    if (status.length > 0) {
      query.claimStatus = { $in: status };
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Get visits and organize into batches
    const visits = await Visits.find(query)
      .populate('tenantId', 'name email')
      .populate('hcmId', 'name email')
      .sort(sort)
      .lean();

    const { batches } = await organizeVisitsIntoBatchesAndClaims(
      visits,
      null,
      null,
      'UTC'
    );

    // Apply pagination to batches
    const paginatedBatches = batches.slice(skip, skip + parseInt(limit));
    const totalCount = batches.length;

    res.status(200).json({
      success: true,
      message: 'Batches retrieved successfully',
      data: {
        batches: paginatedBatches,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / limit),
          totalRecords: totalCount,
          hasNextPage: skip + paginatedBatches.length < totalCount,
          hasPrevPage: page > 1,
        },
      },
    });
  } catch (error) {
    console.error('Error getting batches:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving batches',
      error: error.message,
    });
  }
};

// ===== HELPER FUNCTIONS =====

/**
 * Organize visits into batches and claims based on time periods and grouping rules
 */
async function organizeVisitsIntoBatchesAndClaims(
  visits,
  startDate,
  endDate,
  userTimezone = 'UTC'
) {
  const batches = [];
  const claims = [];

  if (!visits || visits.length === 0) {
    return { batches, claims };
  }

  // Apply strict date filtering if date range is provided
  let filteredVisits = visits;
  if (startDate || endDate) {
    filteredVisits = visits.filter((visit) => {
      // Use startTime for proper timezone conversion instead of date (which is midnight UTC)
      const visitDateTime = new Date(visit.startTime || visit.date);
      const visitDate = visitDateTime;

      if (startDate) {
        // Parse the date string properly to avoid timezone issues
        const dateParts = startDate.split('-');
        let filterStart;

        if (dateParts.length === 3) {
          const year = parseInt(dateParts[0], 10);
          const month = parseInt(dateParts[1], 10) - 1; // Month is 0-indexed
          const day = parseInt(dateParts[2], 10);
          filterStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
        } else {
          // Fallback for other formats
          filterStart = new Date(startDate);
          filterStart.setHours(0, 0, 0, 0);
        }

        if (visitDate < filterStart) {
          return false;
        }
      }

      if (endDate) {
        // Parse the date string properly to avoid timezone issues
        const dateParts = endDate.split('-');
        let filterEnd;

        if (dateParts.length === 3) {
          const year = parseInt(dateParts[0], 10);
          const month = parseInt(dateParts[1], 10) - 1; // Month is 0-indexed
          const day = parseInt(dateParts[2], 10);
          filterEnd = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
        } else {
          // Fallback for other formats
          filterEnd = new Date(endDate);
          filterEnd.setHours(23, 59, 59, 999);
        }

        if (visitDate > filterEnd) {
          return false;
        }
      }

      return true;
    });
  }

  // Sort visits by date
  filteredVisits.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Calculate time period for batching
  const timePeriod = calculateTimePeriod(startDate, endDate);

  // First, create 15-day batches across ALL visits regardless of tenant/service

  // Create 15-day batches
  const dateBatches = createDateBasedSubBatches(
    filteredVisits,
    timePeriod,
    userTimezone
  );

  let batchCounter = 1;
  let claimCounter = 1;

  for (const dateBatch of dateBatches) {
    const batchId = `BATCH_${batchCounter++}_${new Date().getFullYear()}_${new Date().getMonth() + 1
      }_${batchCounter}`;

    // Within each date batch, group visits by tenant + service type for claims
    const claimGroups = {};

    for (const visit of dateBatch.visits) {
      const tenantId = visit.tenantId._id.toString();
      const serviceType = visit.serviceType || 'default';
      const claimKey = `${tenantId}_${serviceType}`;

      if (!claimGroups[claimKey]) {
        claimGroups[claimKey] = {
          tenantId: visit.tenantId,
          serviceType,
          visits: [],
          hcms: new Set(),
        };
      }

      claimGroups[claimKey].visits.push(visit);
      claimGroups[claimKey].hcms.add(visit.hcmId._id.toString());
    }

    // Create claims within this batch
    const batchClaims = [];
    let batchTotalAmount = 0;
    let batchTotalUnits = 0;
    let batchTotalVisits = 0;

    for (const [claimKey, claimGroup] of Object.entries(claimGroups)) {
      const claimId = `CLAIM_${claimCounter++}_${new Date().getFullYear()}_${new Date().getMonth() + 1
        }_${claimCounter}`;

      // Update visits with batch and claim IDs
      const visitIds = claimGroup.visits.map((v) => v._id);
      await Visits.updateMany({ _id: { $in: visitIds } }, { batchId, claimId });

      // Calculate claim totals
      const claimTotalAmount = claimGroup.visits.reduce(
        (sum, v) => sum + (v.calculatedAmount || v.claimAmount || 0),
        0
      );
      const claimTotalUnits = claimGroup.visits.reduce(
        (sum, v) => sum + (v.calculatedUnits || v.claimUnits || 1),
        0
      );

      // Calculate actual date range from visits (smallest to largest) using startTime for proper timezone conversion
      const visitDates = claimGroup.visits.map(
        (v) => new Date(v.startTime || v.date)
      );
      const claimStartDate = new Date(Math.min(...visitDates));
      const claimEndDate = new Date(Math.max(...visitDates));

      // Create claim
      const claim = {
        claimId,
        batchId,
        tenantId: claimGroup.tenantId,
        serviceType: claimGroup.serviceType,
        visits: claimGroup.visits,
        totalVisits: claimGroup.visits.length,
        totalAmount: claimTotalAmount,
        totalUnits: claimTotalUnits,
        status: calculateClaimStatus(claimGroup.visits),
        hcms: Array.from(claimGroup.hcms)
          .map(
            (hcmId) =>
              claimGroup.visits.find((v) => v.hcmId._id.toString() === hcmId)
                ?.hcmId
          )
          .filter(Boolean),
        startDate: claimStartDate,
        endDate: claimEndDate,
        ediGenerated: claimGroup.visits.some((v) => v.ediGenerated),
        ediFileName: claimGroup.visits.find((v) => v.ediFileName)?.ediFileName,
      };

      batchClaims.push(claim);
      claims.push(claim);

      // Add to batch totals
      batchTotalAmount += claimTotalAmount;
      batchTotalUnits += claimTotalUnits;
      batchTotalVisits += claimGroup.visits.length;
    }

    // Calculate batch date range from all visits in this batch using startTime for proper timezone conversion
    const batchVisitDates = dateBatch.visits.map(
      (v) => new Date(v.startTime || v.date)
    );
    const batchStartDate = new Date(Math.min(...batchVisitDates));
    const batchEndDate = new Date(Math.max(...batchVisitDates));

    // Create batch
    const batch = {
      batchId,
      visits: dateBatch.visits,
      claims: batchClaims,
      totalVisits: batchTotalVisits,
      totalAmount: batchTotalAmount,
      totalUnits: batchTotalUnits,
      status: calculateBatchStatus(dateBatch.visits),
      hcmCount: dateBatch.hcms.size,
      startDate: batchStartDate,
      endDate: batchEndDate,
      claimCount: batchClaims.length,
    };

    batches.push(batch);
  }

  return { batches, claims };
}

/**
 * Create date-based sub-batches from visits using proper 15-day calendar chunks
 */
function createDateBasedSubBatches(visits, timePeriod, userTimezone = 'UTC') {
  const subBatches = [];

  if (visits.length === 0) return subBatches;

  // Sort visits by startTime to ensure proper chronological order
  visits.sort(
    (a, b) => new Date(a.startTime || a.date) - new Date(b.startTime || b.date)
  );

  // Group visits by 15-day calendar chunks using user timezone
  const batchGroups = {};

  for (const visit of visits) {
    // Use startTime for proper timezone conversion instead of date (which is midnight UTC)
    const visitDateTime = new Date(visit.startTime || visit.date);

    // Convert to user timezone for proper date grouping
    const visitDateInUserTZ = getDateInUserTimezone(
      visitDateTime,
      userTimezone
    );
    const userTZDate = new Date(visitDateInUserTZ + 'T00:00:00.000Z');

    // Calculate which 15-day period this visit belongs to
    // Use the first visit's startTime as the reference point (also in user timezone)
    const firstVisitDateTime = new Date(visits[0].startTime || visits[0].date);
    const firstVisitDateInUserTZ = getDateInUserTimezone(
      firstVisitDateTime,
      userTimezone
    );
    const firstUserTZDate = new Date(firstVisitDateInUserTZ + 'T00:00:00.000Z');

    const daysDiff = Math.floor(
      (userTZDate - firstUserTZDate) / (1000 * 60 * 60 * 24)
    );
    const batchIndex = Math.floor(daysDiff / 15); // 15-day chunks: 0, 1, 2, etc.

    if (!batchGroups[batchIndex]) {
      batchGroups[batchIndex] = {
        visits: [],
        hcms: new Set(),
        startDate: null,
        endDate: null,
        batchIndex,
      };
    }

    batchGroups[batchIndex].visits.push(visit);
    batchGroups[batchIndex].hcms.add(visit.hcmId._id.toString());

    // Update start and end dates for this batch using user timezone dates
    if (
      !batchGroups[batchIndex].startDate ||
      userTZDate < batchGroups[batchIndex].startDate
    ) {
      batchGroups[batchIndex].startDate = userTZDate;
    }
    if (
      !batchGroups[batchIndex].endDate ||
      userTZDate > batchGroups[batchIndex].endDate
    ) {
      batchGroups[batchIndex].endDate = userTZDate;
    }
  }

  // Convert to array and sort by batch index
  const sortedBatches = Object.keys(batchGroups)
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((key) => batchGroups[key]);

  return sortedBatches;
}

/**
 * Calculate time period for batching based on selected date range
 */
function calculateTimePeriod(startDate, endDate) {
  return 15; // Always use 15-day periods for consistent batching
}

/**
 * Calculate batch status based on visit statuses
 */
function calculateBatchStatus(visits) {
  const statuses = visits.map((v) => v.claimStatus);

  if (statuses.every((s) => s === 'billed')) return 'billed';
  if (statuses.every((s) => s === 'submitted')) return 'submitted';
  if (statuses.every((s) => s === 'cancelled')) return 'cancelled';
  if (statuses.some((s) => s === 'submitted' || s === 'billed'))
    return 'partially_submitted';
  if (statuses.some((s) => s === 'scheduled')) return 'scheduled';

  return 'not_scheduled';
}

/**
 * Calculate claim status based on visit statuses
 */
function calculateClaimStatus(visits) {
  return calculateBatchStatus(visits); // Same logic for now
}

/**
 * Generate EDI for multiple claims
 */
async function generateEDIForClaims(claims, companyId, userId) {
  const results = {
    successful: 0,
    errors: [],
  };

  for (const claim of claims) {
    // Skip if EDI already generated or claim is submitted/billed
    if (
      claim.ediGenerated ||
      claim.status === 'submitted' ||
      claim.status === 'billed'
    ) {
      continue;
    }

    try {
      const ediResult = await generateEDIForVisits(claim.visits, claim.claimId);

      if (ediResult.success) {
        // Update visits with EDI information
        const visitIds = claim.visits.map((v) => v._id);
        await Visits.updateMany(
          { _id: { $in: visitIds } },
          {
            ediGenerated: true,
            ediGeneratedDate: new Date(),
            ediFileName: ediResult.fileName,
          }
        );

        results.successful++;
      } else {
        results.errors.push({
          claimId: claim.claimId,
          error: ediResult.error,
        });
      }
    } catch (error) {
      results.errors.push({
        claimId: claim.claimId,
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * Generate EDI for a single visit using proper EDI generation with complete data
 */
async function generateEDIForVisit(visit) {
  try {
    // Get complete tenant information
    const tenant = await causers.findById(visit.tenantId._id);
    const tenantInfo = tenant
      ? await TenantInfo.findById(tenant.info_id)
      : null;

    // Get company admin information
    const companyAdmin = await User.findOne({
      companyId: visit.companyId,
      role: 2,
    });
    const adminSetup = companyAdmin
      ? await accountSetup.findOne({ adminId: companyAdmin._id })
      : null;

    // Ensure required objects exist
    const patientInfo = tenantInfo?.personalInfo || {};
    const admissionInfo = tenantInfo?.admissionInfo || {};
    const addressInfo = tenantInfo?.address || {};
    const companyInfo = adminSetup || {};

    // Transform visit data to bill format for EDI generation
    const billData = {
      controlNumber: Math.floor(
        100000000 + Math.random() * 900000000
      ).toString(),
      companyNPI: adminSetup?.idnpiUmpi || '000000',
      claimId: patientInfo.maPMINumber || `${Date.now().toString().slice(-8)}`,

      // Company information from admin setup
      company: {
        name: companyInfo.companyName || 'HEALTHCARE PROVIDER',
        address: {
          addressLine1:
            companyInfo.address?.addressLine1 || 'ADDRESS NOT PROVIDED',
          addressLine2: companyInfo.address?.addressLine2 || '',
          city: companyInfo.address?.city || '',
          state: companyInfo.address?.state || '',
          zipcode: companyInfo.address?.zipCode || '00000',
        },
        taxId: adminSetup?.idnpiUmpi || '000000000',
        umpi: adminSetup?.idnpiUmpi || '000000',
      },

      // Patient details from tenant info
      patientDetails: {
        firstName: patientInfo.firstName || 'JOHN',
        lastName: patientInfo.lastName || 'DOE',
        birthDate: patientInfo.dob || new Date().toISOString(),
        gender: patientInfo.gender || 'Male',
        address: {
          addressLine1: addressInfo.addressLine1 || 'ADDRESS NOT PROVIDED',
          addressLine2: addressInfo.addressLine2 || '',
          city: addressInfo.city || '',
          state: addressInfo.state || '',
          zipcode: addressInfo.zipCode || '00000',
        },
        pmiNumber:
          patientInfo.maPMINumber || `${Date.now().toString().slice(-8)}`,
        diagnosisCode: admissionInfo.diagnosisCode || 'F99',
      },

      // Insurance information from admission info
      insurance: {
        name: admissionInfo.insurance || 'UCARE',
        identifier: admissionInfo.insuranceNumber || '0000000000',
        payerId:
          admissionInfo.insurance?.toLowerCase() === 'medical assistance' ||
            admissionInfo.insurance?.toLowerCase() === 'medicaid mn'
            ? '41-1674742'
            : '55413',
      },

      // Service line information
      serviceLine: {
        serviceDate: visit.date,
        serviceType: visit.serviceType,
        methodOfContact: visit.methodOfContact || 'in_person',
        lineItemChargeAmount: visit.calculatedAmount || visit.claimAmount || 0,
        serviceUnitCount: visit.calculatedUnits || visit.claimUnits || 1,
      },

      // HCM information
      hcms: [
        {
          name: visit.hcmId?.name || 'PROVIDER NAME',
          email: visit.hcmId?.email || '',
        },
      ],
    };

    // Generate EDI using the proper EDI generation function
    const ediResult = await generateEDI(billData);
    const fileName = `VISIT_${visit._id}_${Date.now()}.txt`;

    return {
      success: true,
      content: ediResult.ediContent,
      fileName: ediResult.ediFileName || fileName,
    };
  } catch (error) {
    console.error('Error in generateEDIForVisit:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate EDI for multiple visits using proper batch EDI generation with complete data
 */
async function generateEDIForVisits(visits, identifier) {
  try {
    // Generate EDI
    const result = await EDIGenerator.generateEDI(visits, identifier);

    if (result.success) {
      return {
        success: true,
        content: result.content,
        fileName: result.fileName,
      };
    } else {
      console.error('EDI generation failed:', result.error);
      return {
        success: false,
        error: result.error,
      };
    }
  } catch (error) {
    console.error('Error in generateEDIForVisits:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

export const generateEDIHandler = async (req, res) => {
  try {
    const { visitIds, identifier } = req.body;

    if (!Array.isArray(visitIds) || visitIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'visitIds must be a non-empty array',
      });
    }

    const visits = await Visits.find({ _id: { $in: visitIds } })
      .populate('tenantId')
      .populate('hcmId');
    if (!visits || visits.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: 'No visits found for the given IDs' });
    }

    // each tenantId add insurance
    for (const visit of visits) {
      if (!visit.tenantId) {
        return res.status(400).json({
          success: false,
          message: `Visit ${visit._id} is missing tenantId information`,
        });
      }
      const info_id = visit.tenantId.info_id;
      const tenantInfo = await TenantInfo.findById(info_id).lean();
      if (!tenantInfo) {
        return res.status(400).json({
          success: false,
          message: `Tenant info not found for visit ${visit._id}`,
        });
      }

      visit.tenantId.admissionInfo = tenantInfo.admissionInfo;
      visit.tenantId.personalInfo = tenantInfo.personalInfo;
      visit.tenantId.address = tenantInfo.address;

      const companyAdmin = await User.findOne({
        companyId: visit.companyId,
        role: 2,
      });
      const adminSetup = companyAdmin
        ? await accountSetup.findOne({ adminId: companyAdmin._id })
        : null;

      visit.companyInfo = adminSetup || {};
    }

    const ediResult = await generateEDIForVisits(
      visits,
      identifier || 'UNNAMED_BATCH'
    );

    if (!ediResult.success) {
      return res.status(500).json({ success: false, error: ediResult.error });
    }

    return res.json({
      success: true,
      fileName: ediResult.fileName,
      ediContent: ediResult.content,
    });
  } catch (err) {
    console.error('Error in generateEDIHandler:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * Get status breakdown for visits
 */
function getStatusBreakdown(visits) {
  const breakdown = {};

  visits.forEach((visit) => {
    const status = visit.claimStatus || 'not_scheduled';
    breakdown[status] = (breakdown[status] || 0) + 1;
  });

  return breakdown;
}

/**
 * Group visits by same day, tenant, HCM, and service for display
 */
function groupVisitsByDayTenantHcmService(visits, userTimezone = 'UTC') {
  const groups = {};

  visits.forEach((visit) => {
    // Use startTime for proper timezone conversion instead of date (which is midnight UTC)
    const visitDateTime = new Date(visit.startTime || visit.date);
    const visitDate = getDateInUserTimezone(visitDateTime, userTimezone);

    // Debug: Compare date vs startTime grouping
    if (visit.date !== visit.startTime) {
      const dateOnlyGrouping = getDateInUserTimezone(
        new Date(visit.date),
        userTimezone
      );
    }

    const tenantId = visit.tenantId._id.toString();
    const hcmId = visit.hcmId._id.toString();
    const serviceType = visit.serviceType || 'default';

    const groupKey = `${visitDate}_${tenantId}_${hcmId}_${serviceType}`;

    if (!groups[groupKey]) {
      groups[groupKey] = {
        groupKey,
        date: visitDate,
        tenantId: visit.tenantId,
        hcmId: visit.hcmId,
        serviceType,
        visits: [],
        totalTimeInHours: 0,
        totalUnits: 0,
        totalAmount: 0,
        claimStatus: visit.claimStatus || 'not_scheduled',
        scheduledDate: visit.scheduledDate,
        submittedDate: visit.submittedDate,
        cancelledDate: visit.cancelledDate,
        batchId: visit.batchId,
        claimId: visit.claimId,
      };
    }

    groups[groupKey].visits.push(visit);
    groups[groupKey].totalTimeInHours += visit.timeInHours || 0;
    groups[groupKey].totalUnits += visit.calculatedUnits || 0;
    groups[groupKey].totalAmount += visit.calculatedAmount || 0;

    // Round totals to 2 decimal places
    groups[groupKey].totalTimeInHours =
      Math.round(groups[groupKey].totalTimeInHours * 100) / 100;
    groups[groupKey].totalAmount =
      Math.round(groups[groupKey].totalAmount * 100) / 100;

    // Use the most recent status and dates from the grouped visits
    const statusPriority = {
      billed: 5,
      submitted: 4,
      scheduled: 3,
      cancelled: 2,
      not_scheduled: 1,
    };

    const currentStatusPriority =
      statusPriority[groups[groupKey].claimStatus] || 1;
    const visitStatusPriority = statusPriority[visit.claimStatus] || 1;

    if (visitStatusPriority > currentStatusPriority) {
      groups[groupKey].claimStatus = visit.claimStatus;
    }

    // Update dates with the most recent ones
    if (
      visit.scheduledDate &&
      (!groups[groupKey].scheduledDate ||
        new Date(visit.scheduledDate) >
        new Date(groups[groupKey].scheduledDate))
    ) {
      groups[groupKey].scheduledDate = visit.scheduledDate;
    }
    if (
      visit.submittedDate &&
      (!groups[groupKey].submittedDate ||
        new Date(visit.submittedDate) >
        new Date(groups[groupKey].submittedDate))
    ) {
      groups[groupKey].submittedDate = visit.submittedDate;
    }
    if (
      visit.cancelledDate &&
      (!groups[groupKey].cancelledDate ||
        new Date(visit.cancelledDate) >
        new Date(groups[groupKey].cancelledDate))
    ) {
      groups[groupKey].cancelledDate = visit.cancelledDate;
    }
  });

  return Object.values(groups);
}

/**
 * Log audit action
 */
async function logAuditAction(actionData) {
  try {
    // This would typically save to an audit log collection
    // If ClaimAuditLog model exists, save the action
    if (ClaimAuditLog && ClaimAuditLog.logAction) {
      await ClaimAuditLog.logAction(actionData);
    }
  } catch (error) {
    console.error('Error logging audit action:', error);
  }
}
