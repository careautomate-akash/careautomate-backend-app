import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import Bills from '../models/bills/bills.js';
import billsPending from '../models/bills/billsPending.js';
import causers from '../models/account/users.js';
import accountSetup from '../models/account/accountSetup.js';
import ServiceTracking from '../models/bills/serviceTracking.js';
import TenantInfo from '../models/hcm-tenants/tenantInfo.js';
import users from '../models/account/users.js';
import { getProcedureCodeAndModifier } from '../utils/procedureCodeMapper.js';
import { generateBatchEDI } from './generateBatchEDI.js';
import { generateMultiPatientEDI } from './generateMultiPatientEDI.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../config/awsConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to generate a random alphanumeric string of given length
function generateRandomAlphanumeric(length) {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Function to get a random control number starting with 111
function getNextControlNumber() {
  // Generate a random number between 0 and 999999, pad with zeros to 6 digits
  const randomPart = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, '0');
  return `111${randomPart}`;
}

// Generate bill and handle batch EDI creation automatically
export const generateBill = async (visit) => {
  try {
    const tenantId = visit.tenantId;
    const serviceDate = new Date(visit.date);
    const serviceMonth = serviceDate.getMonth();
    const serviceYear = serviceDate.getFullYear();

    // Create a month-year key for grouping
    const monthYearKey = `${serviceYear}-${serviceMonth
      .toString()
      .padStart(2, '0')}`;

    const tenant = await causers.findOne({ _id: tenantId });
    if (!tenant) {
      return { success: false, message: 'Tenant not found' };
    }

    const tenantInfo = await TenantInfo.findById(tenant.info_id);
    if (!tenantInfo) {
      return { success: false, message: 'Tenant information not found' };
    }

    const companyId = visit.companyId;
    const companyAdmin = await users.findOne({ companyId, role: 2 });
    if (!companyAdmin) {
      return { success: false, message: 'Company admin not found' };
    }

    const admin = await accountSetup.findOne({ adminId: companyAdmin._id });
    if (!admin) {
      return { success: false, message: 'Account setup not found' };
    }

    const service = await ServiceTracking.findOne({
      tenantId: visit.tenantId,
      serviceId: visit.serviceId,
    });
    if (!service) {
      return { success: false, message: 'Service tracking not found' };
    }

    const hcm = await causers.findOne({ _id: visit.hcmId });
    if (!hcm) {
      return { success: false, message: 'HCM not found' };
    }

    // Calculate worked units and bill amount for this visit
    const startTime = new Date(visit.startTime);
    const endTime = new Date(visit.endTime);
    const durationInMinutes = (endTime - startTime) / (1000 * 60);
    const workedUnits = durationInMinutes / 15;
    const billAmount = workedUnits * service.billRate;

    // Ensure admissionInfo exists to prevent errors
    tenantInfo.admissionInfo = tenantInfo.admissionInfo || {};
    tenantInfo.personalInfo = tenantInfo.personalInfo || {};
    tenantInfo.address = tenantInfo.address || {};

    // Look for existing bill for the same tenant in the same month-year
    const startOfMonth = new Date(serviceYear, serviceMonth, 1);
    const endOfMonth = new Date(serviceYear, serviceMonth + 1, 0);

    const existingBill = await Bills.findOne({
      tenantId: tenantId,
      serviceDate: {
        $gte: startOfMonth,
        $lte: endOfMonth,
      },
    });

    let billResult;
    if (existingBill) {
      // Update existing bill with new visit data
      billResult = await updateExistingBill(
        existingBill,
        visit,
        hcm,
        workedUnits,
        billAmount,
        service
      );
    } else {
      // Create new bill for this tenant and month
      billResult = await createNewBill(
        visit,
        tenant,
        tenantInfo,
        admin,
        hcm,
        workedUnits,
        billAmount,
        service,
        companyId,
        monthYearKey
      );
    }

    // After bill creation/update, regenerate batch EDI for all bills in this month
    if (billResult.success) {
      await regenerateBatchEDI(companyId, monthYearKey);
    }

    return billResult;
  } catch (error) {
    console.error('Error in generateBill:', error);
    return {
      success: false,
      message: 'Error generating bill',
      error: error.message,
    };
  }
};

// Helper function to regenerate batch EDI for all bills in a month
export const regenerateBatchEDI = async (companyId, monthYearKey) => {
  try {
    // Find all bills for this company and month
    const [year, month] = monthYearKey.split('-');
    const startOfMonth = new Date(parseInt(year), parseInt(month), 1);
    const endOfMonth = new Date(parseInt(year), parseInt(month) + 1, 0);

    const billsInMonth = await Bills.find({
      companyId: companyId,
      serviceDate: {
        $gte: startOfMonth,
        $lte: endOfMonth,
      },
    }).sort({ tenantId: 1, serviceDate: 1 });

    if (billsInMonth.length === 0) return;

    // Determine if this should be single patient or multi-patient EDI
    const uniqueTenants = [
      ...new Set(billsInMonth.map((bill) => bill.tenantId.toString())),
    ];

    let ediResult;
    if (uniqueTenants.length === 1) {
      // Single patient - use generateBatchEDI
      const billObject = billsInMonth[0].toObject();
      ediResult = await generateBatchEDI(billObject);
    } else {
      // Multiple patients - use generateMultiPatientEDI
      const billObjects = billsInMonth.map((bill) => bill.toObject());
      ediResult = await generateMultiPatientEDI(billObjects);
    }

    if (ediResult.ediContent) {
      // Update all bills in this month with the new EDI content
      for (const bill of billsInMonth) {
        bill.ediContent = ediResult.ediContent;
        bill.ediFileName = ediResult.ediFileName;
        await bill.save();
      }

      // Upload to S3
      try {
        const s3Key = `edis/${ediResult.ediFileName}`;
        const uploadParams = {
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: s3Key,
          Body: ediResult.ediContent,
          ContentType: 'application/edi-x12',
        };
        await s3Client.send(new PutObjectCommand(uploadParams));
      } catch (s3Error) {
        console.error('S3 upload error:', s3Error);
      }
    }
  } catch (error) {
    console.error('Error regenerating batch EDI:', error);
  }
};

// Helper function to update existing bill
const updateExistingBill = async (
  existingBill,
  visit,
  hcm,
  workedUnits,
  billAmount,
  service
) => {
  try {
    const visitDate = new Date(visit.date);
    const serviceType = visit.serviceType;

    // Add or update HCM entry
    const hcmIndex = existingBill.hcms.findIndex(
      (hcmEntry) => hcmEntry.id.toString() === visit.hcmId.toString()
    );

    if (hcmIndex !== -1) {
      // Update existing HCM entry
      existingBill.hcms[hcmIndex].workedUnits += workedUnits;
      existingBill.hcms[hcmIndex].billAmount += billAmount;
    } else {
      // Add new HCM entry
      existingBill.hcms.push({
        id: visit.hcmId,
        name: hcm.name,
        serviceDate: visitDate,
        workedUnits: workedUnits,
        billAmount: billAmount,
      });
    }

    // Check if we need to add this as a new service line or combine with existing same-day services
    const sameDayServices =
      existingBill.serviceLines?.filter(
        (line) =>
          new Date(line.serviceDate).toDateString() ===
            visitDate.toDateString() && line.serviceType === serviceType
      ) || [];

    if (sameDayServices.length > 0) {
      // Combine with existing same-day service
      const serviceLineIndex = existingBill.serviceLines.findIndex(
        (line) =>
          new Date(line.serviceDate).toDateString() ===
            visitDate.toDateString() && line.serviceType === serviceType
      );

      existingBill.serviceLines[serviceLineIndex].serviceUnitCount +=
        workedUnits;
      existingBill.serviceLines[serviceLineIndex].lineItemChargeAmount +=
        billAmount;
    } else {
      // Add new service line for different day or service type
      if (!existingBill.serviceLines) {
        existingBill.serviceLines = [];
      }

      const {
        code: procedureCode,
        modifiers,
        displayName,
      } = getProcedureCodeAndModifier(serviceType);

      existingBill.serviceLines.push({
        procedureCode: procedureCode,
        modifier: modifiers.join(' '),
        lineItemChargeAmount: billAmount,
        serviceUnitCount: workedUnits,
        serviceDate: visitDate,
        description: displayName,
        serviceType: procedureCode,
        serviceName: serviceType,
        serviceDisplayName: displayName,
        claimId: existingBill.claimId || generateRandomAlphanumeric(8),
        visitId: visit._id,
      });
    }

    // Update total amounts
    const totalAmount =
      existingBill.serviceLines?.reduce(
        (sum, line) => sum + line.lineItemChargeAmount,
        0
      ) || billAmount;

    existingBill.serviceLine.serviceUnitCount =
      existingBill.serviceLines?.reduce(
        (sum, line) => sum + line.serviceUnitCount,
        0
      ) || workedUnits;
    existingBill.serviceLine.lineItemChargeAmount = totalAmount;

    if (existingBill.bill && existingBill.bill.claimInformation) {
      existingBill.bill.claimInformation.totalClaimChargeAmount = totalAmount;
    }

    await existingBill.save();

    return {
      success: true,
      message: 'Visit added to existing bill successfully',
      billId: existingBill._id,
    };
  } catch (error) {
    console.error('Error updating existing bill:', error);
    return { success: false, message: error.message };
  }
};

// Helper function to create new bill
const createNewBill = async (
  visit,
  tenant,
  tenantInfo,
  admin,
  hcm,
  workedUnits,
  billAmount,
  service,
  companyId,
  monthYearKey
) => {
  try {
    const controlNumber = getNextControlNumber();
    const claimId = generateRandomAlphanumeric(8);
    const companyNPI = admin.idnpiUmpi;
    const visitDate = new Date(visit.date);

    const currentDate = new Date();
    const formattedDate = currentDate
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
    const fileName = `${companyNPI}_${controlNumber}_${formattedDate}_TPinfo.dat`;

    // Determine if government insurance
    const insuranceName = (
      tenantInfo.admissionInfo.insurance || ''
    ).toLowerCase();
    const isGovernmentInsurance =
      insuranceName === 'medical assistance' || insuranceName === 'medicaid mn';

    const {
      code: procedureCode,
      modifiers,
      displayName,
    } = getProcedureCodeAndModifier(visit.serviceType);

    const newBill = new Bills({
      claimId,
      controlNumber,
      tenantId: visit.tenantId,
      visitId: visit._id,
      companyId,
      hcms: [
        {
          id: visit.hcmId,
          name: hcm.name,
          serviceDate: visitDate,
          workedUnits: workedUnits,
          billAmount: billAmount,
        },
      ],
      serviceDate: visitDate,
      serviceType: visit.serviceType,
      companyNPI,
      billName: fileName,
      isGovernmentInsurance: isGovernmentInsurance,
      monthYearKey: monthYearKey,
      serviceLines: [
        {
          procedureCode: procedureCode,
          modifier: modifiers.join(' '),
          lineItemChargeAmount: billAmount,
          serviceUnitCount: workedUnits,
          serviceDate: visitDate,
          description: displayName,
          serviceType: procedureCode,
          serviceName: visit.serviceType,
          serviceDisplayName: displayName,
          claimId: claimId,
          visitId: visit._id,
        },
      ],
      bill: {
        taxonomyCode: tenantInfo.admissionInfo.ssn || '',
        additionalIdentifier: tenantInfo.admissionInfo.ssn || '',
        claimInformation: {
          patientAccountNumber: tenantInfo.admissionInfo.ssn || '',
          totalClaimChargeAmount: billAmount,
          medicalRecordNumber: tenantInfo.admissionInfo.ssn || '',
          claimId,
        },
      },
      insurance: {
        name: tenantInfo.admissionInfo.insurance || 'Unknown Insurance',
        identifier: tenantInfo.admissionInfo.insuranceNumber || '',
        type: tenantInfo.admissionInfo.insurance || 'Unknown Insurance',
        memberNumber: tenantInfo.admissionInfo.insuranceNumber || '',
      },
      company: {
        name: admin.companyName || 'Unknown Company',
        address: {
          addressLine1: admin.address?.addressLine1 || '',
          addressLine2: admin.address?.addressLine2 || '',
          city: admin.address?.city || '',
          state: admin.address?.state || '',
          zipCode: admin.address?.zipCode || '',
        },
        taxId: companyNPI,
      },
      patientDetails: {
        firstName: tenantInfo.personalInfo.firstName || '',
        lastName: tenantInfo.personalInfo.lastName || '',
        taxId: tenantInfo.personalInfo.maPMINumber || '',
        address: {
          addressLine1: tenantInfo.address.addressLine1 || '',
          addressLine2: tenantInfo.address.addressLine2 || '',
          city: tenantInfo.address.city || '',
          state: tenantInfo.address.state || '',
          zipcode: tenantInfo.address.zipCode || '',
        },
        gender: tenantInfo.personalInfo.gender || 'Unknown',
        birthDate: tenantInfo.personalInfo.dob || new Date(),
        pmiNumber: tenantInfo.personalInfo.maPMINumber || '',
        diagnosisCode: tenantInfo.admissionInfo.diagnosisCode || 'Z99.0',
      },
      serviceLine: {
        procedureCode: procedureCode,
        modifier: modifiers.join(' '),
        lineItemChargeAmount: billAmount,
        serviceUnitCount: workedUnits,
        serviceDate: visitDate,
        description: displayName,
        serviceName: visit.serviceType,
        serviceDisplayName: displayName,
        serviceType: procedureCode,
      },
      companyId,
    });

    const savedBill = await newBill.save();

    // Create billing pending entry
    try {
      const newBillingPending = new billsPending({
        bill: savedBill._id,
        tenant: visit.tenantId,
        companyId: visit.companyId,
        createdAt: new Date(),
        status: 'pending',
      });
      await newBillingPending.save();
    } catch (pendingError) {
      console.error('Error creating billing pending:', pendingError);
    }

    // Update batch status
    try {
      savedBill.isReadyForBatch = true;
      savedBill.batchStatus = 'pending';
      await savedBill.save();
    } catch (batchError) {
      console.error('Error updating batch status:', batchError);
    }

    return {
      success: true,
      message: 'New bill created successfully',
      billId: savedBill._id,
    };
  } catch (error) {
    console.error('Error creating new bill:', error);
    return { success: false, message: error.message };
  }
};
