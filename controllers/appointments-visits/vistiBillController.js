import Visits from '../../models/appointments-visits/visits.js';
import Bills from '../../models/bills/bills.js';
import { generateBill } from '../../tasks/billGeneration.js';
import { regenerateBatchEDI } from '../../tasks/billGeneration.js';
import { generateMultiPatientEDI } from '../../tasks/generateMultiPatientEDI.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client } from '../../config/awsConfig.js';
import causers from '../../models/account/users.js';
import TenantInfo from '../../models/hcm-tenants/tenantInfo.js';
import mongoose from 'mongoose';

const checkIfBillGenerationNeeded = async (visit) => {
    try {
        const visitDate = new Date(visit.date);
        const serviceMonth = visitDate.getMonth();
        const serviceYear = visitDate.getFullYear();

        // Look for existing bill in the same month-year
        const startOfMonth = new Date(serviceYear, serviceMonth, 1);
        const endOfMonth = new Date(serviceYear, serviceMonth + 1, 0);

        const existingBill = await Bills.findOne({
            tenantId: visit.tenantId,
            serviceDate: {
                $gte: startOfMonth,
                $lte: endOfMonth
            }
        });

        if (existingBill) {
            // Bill exists for this month, the generateBill function will handle the update
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error checking bill generation need:', error);
        return false;
    }
};

const generateBillandEDI = async (visitId) => {
    try {
        const visit = await Visits.findById(visitId);
        if (!visit) {
            return { success: false, message: 'Visit not found' };
        }

        const billResult = await generateBill(visit);

        if (billResult.success && billResult.billId) {
            return {
                success: true,
                message: 'Bill and EDI generated successfully',
                billId: billResult.billId
            };
        } else {
            return { success: false, message: billResult.message || 'Failed to generate bill' };
        }
    } catch (error) {
        console.error('Error in generateBillandEDI:', error);
        return { success: false, message: error.message };
    }
}

export const markVisitAsApproved = async (visitId) => {
    try {
        const visit = await Visits.findById(visitId);
        if (!visit) {
            return { success: false, message: 'Visit not found' };
        }

        visit.status = 'approved';
        visit.timeOfApproval = new Date();
        await visit.save();

        const billResult = await generateBillandEDI(visitId);
        if (billResult.success) {
            visit.billId = billResult.billId;
            await visit.save();
            return { success: true, message: 'Visit approved and bill generated successfully' };
        } else {
            return { success: false, message: billResult.message };
        }
    } catch (error) {
        console.error('Error in markVisitAsApproved:', error);
        return { success: false, message: error.message };
    }
};

export const updateBillandEDI = async (visitId) => {
    try {
        const visit = await Visits.findById(visitId);
        if (!visit) {
            return { success: false, message: 'Visit not found' };
        }

        // Generate/update the bill for this visit
        const billResult = await generateBill(visit);

        if (billResult.success) {
            // Update the visit with the bill ID if it was created
            if (billResult.billId && !visit.billId) {
                visit.billId = billResult.billId;
                await visit.save();
            }

            // The generateBill function already handles batch EDI regeneration
            // through the regenerateBatchEDI function, so no additional EDI work needed
            return {
                success: true,
                message: 'Bill and EDI updated successfully',
                billId: billResult.billId
            };
        } else {
            return { success: false, message: billResult.message };
        }
    } catch (error) {
        console.error('Error in updateBillandEDI:', error);
        return { success: false, message: error.message };
    }
}

export const removeBill = async (visitId) => {
    try {
        // Find the visit to get information
        const visit = await Visits.findById(visitId);
        if (!visit) {
            return { success: false, message: 'Visit not found' };
        }

        // Find the bill by visit ID
        let bill;
        if (visit.billId) {
            bill = await Bills.findById(visit.billId);
        } else {
            bill = await Bills.findOne({ visitId: visitId });
        }

        if (!bill) {
            return { success: true, message: 'No bill found to remove' };
        }
        // Store bill information before deletion
        const billData = {
            _id: bill._id,
            tenantId: bill.tenantId,
            visitId: bill.visitId,
            serviceDate: bill.serviceDate,
            units: bill.units,
            amount: bill.amount,
            companyId: bill.companyId
        };

        // Delete the bill
        await Bills.findByIdAndDelete(bill._id);
        // Clear the billId reference in the visit
        if (visit.billId) {
            visit.billId = null;
            await visit.save();
        }

        // If the visit is still in the system but just had its bill removed,
        // we may need to regenerate the batch EDI file for the month
        if (billData.serviceDate) {
            const serviceDate = new Date(billData.serviceDate);
            const monthYearKey = `${serviceDate.getFullYear()}-${(serviceDate.getMonth() + 1).toString().padStart(2, '0')}`;

            // Check if there are any other bills for this tenant in this month
            const monthStart = new Date(serviceDate.getFullYear(), serviceDate.getMonth(), 1);
            const monthEnd = new Date(serviceDate.getFullYear(), serviceDate.getMonth() + 1, 0, 23, 59, 59);

            const otherBillsInMonth = await Bills.countDocuments({
                _id: { $ne: billData._id },
                tenantId: billData.tenantId,
                serviceDate: { $gte: monthStart, $lte: monthEnd }
            });

            if (otherBillsInMonth === 0) {
                await regenerateBatchEDI(billData.companyId, monthYearKey);
            }
        }

        return { success: true, message: 'Bill removed successfully' };
    } catch (error) {
        console.error('Error removing bill:', error);
        return { success: false, message: error.message };
    }
};

export const updateTenantBillsAndEDI = async (tenantId) => {
    try {
        // First, get the updated tenant information
        const tenant = await causers.findById(tenantId);
        if (!tenant) {
            return { success: false, message: 'Tenant not found' };
        }

        const tenantInfo = await TenantInfo.findById(tenant.info_id);
        if (!tenantInfo) {
            return { success: false, message: 'Tenant information not found' };
        }

        // Find all scheduled bills for this tenant
        const tenantBills = await Bills.find({
            tenantId: tenantId,
            status: 'scheduled'
        });

        if (tenantBills.length === 0) {
            return { success: true, message: 'No bills found for tenant' };
        }

        // Update tenant details in all bills
        const updatedBillsCount = await updateTenantDetailsInBills(tenantBills, tenant, tenantInfo);

        // Group bills by month-year and company to identify unique EDI batches
        const batchGroups = new Map();

        for (const bill of tenantBills) {
            const serviceDate = new Date(bill.serviceDate);
            const monthYear = `${serviceDate.getFullYear()}-${serviceDate.getMonth()}`;
            const key = `${bill.companyId}_${monthYear}`;

            if (!batchGroups.has(key)) {
                batchGroups.set(key, {
                    companyId: bill.companyId,
                    year: serviceDate.getFullYear(),
                    month: serviceDate.getMonth(),
                    bills: []
                });
            }
            batchGroups.get(key).bills.push(bill);
        }

        // For each batch group, regenerate the complete EDI file
        for (const [key, group] of batchGroups) {
            await regenerateCompleteBatchEDI(group.companyId, group.year, group.month);
        }

        return {
            success: true,
            message: `Updated tenant details in ${updatedBillsCount} bills and regenerated EDI files for ${batchGroups.size} batch(es)`
        };
    } catch (error) {
        console.error('Error in updateTenantBillsAndEDI:', error);
        return { success: false, message: error.message };
    }
};

// Helper function to update tenant details in existing bills
const updateTenantDetailsInBills = async (tenantBills, tenant, tenantInfo) => {
    try {
        let updatedCount = 0;

        for (const bill of tenantBills) {
            let hasChanges = false;

            // Update patient details
            const personalInfo = tenantInfo.personalInfo || {};
            const address = tenantInfo.address || {};
            const admissionInfo = tenantInfo.admissionInfo || {};

            // Update patient details if they exist and are different
            if (bill.patientDetails) {
                if (personalInfo.firstName && bill.patientDetails.firstName !== personalInfo.firstName) {
                    bill.patientDetails.firstName = personalInfo.firstName;
                    hasChanges = true;
                }
                if (personalInfo.lastName && bill.patientDetails.lastName !== personalInfo.lastName) {
                    bill.patientDetails.lastName = personalInfo.lastName;
                    hasChanges = true;
                }
                if (personalInfo.gender && bill.patientDetails.gender !== personalInfo.gender) {
                    bill.patientDetails.gender = personalInfo.gender;
                    hasChanges = true;
                }
                if (personalInfo.dob && bill.patientDetails.birthDate !== personalInfo.dob) {
                    bill.patientDetails.birthDate = new Date(personalInfo.dob);
                    hasChanges = true;
                }
                if (personalInfo.maPMINumber && bill.patientDetails.pmiNumber !== personalInfo.maPMINumber) {
                    bill.patientDetails.pmiNumber = personalInfo.maPMINumber;
                    hasChanges = true;
                }
                if (admissionInfo.diagnosisCode && bill.patientDetails.diagnosisCode !== admissionInfo.diagnosisCode) {
                    bill.patientDetails.diagnosisCode = admissionInfo.diagnosisCode;
                    hasChanges = true;
                }

                // Update address details
                if (bill.patientDetails.address) {
                    if (address.addressLine1 && bill.patientDetails.address.addressLine1 !== address.addressLine1) {
                        bill.patientDetails.address.addressLine1 = address.addressLine1;
                        hasChanges = true;
                    }
                    if (address.addressLine2 && bill.patientDetails.address.addressLine2 !== address.addressLine2) {
                        bill.patientDetails.address.addressLine2 = address.addressLine2;
                        hasChanges = true;
                    }
                    if (address.city && bill.patientDetails.address.city !== address.city) {
                        bill.patientDetails.address.city = address.city;
                        hasChanges = true;
                    }
                    if (address.state && bill.patientDetails.address.state !== address.state) {
                        bill.patientDetails.address.state = address.state;
                        hasChanges = true;
                    }
                    if (address.zipCode && bill.patientDetails.address.zipcode !== address.zipCode) {
                        bill.patientDetails.address.zipcode = address.zipCode;
                        hasChanges = true;
                    }
                }
            }

            // Update insurance details
            if (bill.insurance && admissionInfo.insurance) {
                if (admissionInfo.insurance && bill.insurance.name !== admissionInfo.insurance) {
                    bill.insurance.name = admissionInfo.insurance;
                    hasChanges = true;
                }
                if (admissionInfo.insuranceNumber && bill.insurance.identifier !== admissionInfo.insuranceNumber) {
                    bill.insurance.identifier = admissionInfo.insuranceNumber;
                    bill.insurance.memberNumber = admissionInfo.insuranceNumber;
                    hasChanges = true;
                }
            }

            // Update bill claim information
            if (bill.bill && bill.bill.claimInformation && admissionInfo.diagnosisCode) {
                if (bill.bill.claimInformation.diagnosisCode !== admissionInfo.diagnosisCode) {
                    bill.bill.claimInformation.diagnosisCode = admissionInfo.diagnosisCode;
                    hasChanges = true;
                }
            }

            // Save the bill if there were changes
            if (hasChanges) {
                bill.updatedAt = new Date();
                await bill.save();
                updatedCount++;
            }
        }

        return updatedCount;
    } catch (error) {
        console.error('Error updating tenant details in bills:', error);
        throw error;
    }
};

// Helper function to regenerate complete batch EDI for a given month
const regenerateCompleteBatchEDI = async (companyId, year, month) => {
    try {
        // Find all bills for this company and month (not just for one tenant)
        const startOfMonth = new Date(year, month, 1);
        const endOfMonth = new Date(year, month + 1, 0);

        const allBillsInMonth = await Bills.find({
            companyId: companyId,
            serviceDate: {
                $gte: startOfMonth,
                $lte: endOfMonth
            },
            status: 'scheduled'
        }).sort({ tenantId: 1, serviceDate: 1 });

        if (allBillsInMonth.length === 0) return;

        // Determine if this should be single patient or multi-patient EDI
        const uniqueTenants = [...new Set(allBillsInMonth.map(bill => bill.tenantId.toString()))];

        let ediResult;
        if (uniqueTenants.length === 1) {
            // Single patient - use generateBatchEDI
            const billObject = allBillsInMonth[0].toObject();
            ediResult = await generateBatchEDI(billObject);
        } else {
            // Multiple patients - use generateMultiPatientEDI
            const billObjects = allBillsInMonth.map(bill => bill.toObject());
            ediResult = await generateMultiPatientEDI(billObjects);
        }

        if (ediResult.ediContent) {
            // Update all bills in this month with the new EDI content
            for (const bill of allBillsInMonth) {
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
        console.error('Error regenerating complete batch EDI:', error);
        throw error;
    }
};

// Utility function to check EDI file status for debugging
export const checkEDIStatus = async (tenantId) => {
    try {
        const bills = await Bills.find({ tenantId: tenantId, status: 'scheduled' });

        const ediInfo = bills.map(bill => ({
            billId: bill._id,
            tenantId: bill.tenantId,
            serviceDate: bill.serviceDate,
            ediFileName: bill.ediFileName,
            hasEDIContent: !!bill.ediContent,
            ediContentLength: bill.ediContent ? bill.ediContent.length : 0,
            patientName: `${bill.patientDetails?.firstName || ''} ${bill.patientDetails?.lastName || ''}`.trim(),
            insurance: bill.insurance?.name,
            lastUpdated: bill.updatedAt
        }));

        return {
            success: true,
            totalBills: bills.length,
            ediFiles: ediInfo
        };
    } catch (error) {
        console.error('Error checking EDI status:', error);
        return { success: false, message: error.message };
    }
};

// Utility function to compare tenant details before and after update
export const compareTenantDataInBills = async (tenantId, expectedTenantInfo) => {
    try {
        const bills = await Bills.find({ tenantId: tenantId, status: 'scheduled' });

        const comparison = bills.map(bill => {
            const personalInfo = expectedTenantInfo.personalInfo || {};
            const address = expectedTenantInfo.address || {};
            const admissionInfo = expectedTenantInfo.admissionInfo || {};

            return {
                billId: bill._id,
                patientDetails: {
                    expected: {
                        firstName: personalInfo.firstName,
                        lastName: personalInfo.lastName,
                        gender: personalInfo.gender,
                        dob: personalInfo.dob,
                        pmiNumber: personalInfo.maPMINumber,
                        diagnosisCode: admissionInfo.diagnosisCode
                    },
                    actual: {
                        firstName: bill.patientDetails?.firstName,
                        lastName: bill.patientDetails?.lastName,
                        gender: bill.patientDetails?.gender,
                        dob: bill.patientDetails?.birthDate,
                        pmiNumber: bill.patientDetails?.pmiNumber,
                        diagnosisCode: bill.patientDetails?.diagnosisCode
                    },
                    matches: {
                        firstName: bill.patientDetails?.firstName === personalInfo.firstName,
                        lastName: bill.patientDetails?.lastName === personalInfo.lastName,
                        gender: bill.patientDetails?.gender === personalInfo.gender,
                        pmiNumber: bill.patientDetails?.pmiNumber === personalInfo.maPMINumber,
                        diagnosisCode: bill.patientDetails?.diagnosisCode === admissionInfo.diagnosisCode
                    }
                },
                insurance: {
                    expected: {
                        name: admissionInfo.insurance,
                        identifier: admissionInfo.insuranceNumber
                    },
                    actual: {
                        name: bill.insurance?.name,
                        identifier: bill.insurance?.identifier
                    },
                    matches: {
                        name: bill.insurance?.name === admissionInfo.insurance,
                        identifier: bill.insurance?.identifier === admissionInfo.insuranceNumber
                    }
                }
            };
        });

        return {
            success: true,
            totalBills: bills.length,
            comparison: comparison
        };
    } catch (error) {
        console.error('Error comparing tenant data:', error);
        return { success: false, message: error.message };
    }
};
