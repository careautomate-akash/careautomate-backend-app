import Bill from '../models/bills/bills.js';
import ServiceTracking from '../models/bills/serviceTracking.js';
import users from '../models/account/users.js';
import tenantInfo from '../models/hcm-tenants/tenantInfo.js';
import hcmInfo from '../models/hcm-tenants/hcmInfo.js';
import accountSetup from '../models/account/accountSetup.js';
import Company from '../models/account/company.js';
import Visits from '../models/appointments-visits/visits.js';
import mongoose from 'mongoose';

/**
 * Service to handle bill record updates when related data changes
 */
class BillUpdateService {
    /**
     * Update bills when HCM data changes
     * @param {string} hcmId - HCM ID
     * @param {Object} updatedHcmData - Updated HCM data
     */
    static async updateBillsForHcmChanges(hcmId, updatedHcmData) {
        try {
            // Find all bills related to this HCM
            const bills = await Bill.find({ hcmId }).populate('tenantId');

            for (const bill of bills) {
                let updated = false;

                // Update HCM name if changed
                if (updatedHcmData.personalInfo) {
                    const newHcmName = `${updatedHcmData.personalInfo.firstName || ''} ${updatedHcmData.personalInfo.middleName || ''} ${updatedHcmData.personalInfo.lastName || ''}`.trim();
                    if (bill.hcmName !== newHcmName) {
                        bill.hcmName = newHcmName;
                        updated = true;
                    }
                }

                // Update provider information in bill structure
                if (bill.bill?.providerInformation && updatedHcmData.employmentInfo) {
                    if (updatedHcmData.employmentInfo.rateOfPay && bill.bill.providerInformation.rateOfPay !== updatedHcmData.employmentInfo.rateOfPay) {
                        bill.bill.providerInformation.rateOfPay = updatedHcmData.employmentInfo.rateOfPay;
                        updated = true;
                    }
                }

                if (updated) {
                    bill.updatedAt = new Date();
                    await bill.save();
                }
            }

            return { success: true, message: `Updated ${bills.length} bills for HCM changes` };
        } catch (error) {
            console.error('Error updating bills for HCM changes:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Update bills when tenant data changes
     * @param {string} tenantId - Tenant ID
     * @param {Object} updatedTenantData - Updated tenant data
     */
    static async updateBillsForTenantChanges(tenantId, updatedTenantData) {
        try {
            // Find all bills related to this tenant
            const bills = await Bill.find({ tenantId }).populate('hcmId');

            for (const bill of bills) {
                let updated = false;

                // Update tenant name if changed
                if (updatedTenantData.personalInfo) {
                    const newTenantName = `${updatedTenantData.personalInfo.firstName || ''} ${updatedTenantData.personalInfo.middleName || ''} ${updatedTenantData.personalInfo.lastName || ''}`.trim();
                    if (bill.tenantName !== newTenantName) {
                        bill.tenantName = newTenantName;
                        updated = true;
                    }
                }

                // Update patient information in bill structure
                if (bill.bill?.patientDetails) {
                    if (updatedTenantData.personalInfo?.firstName && bill.bill.patientDetails.firstName !== updatedTenantData.personalInfo.firstName) {
                        bill.bill.patientDetails.firstName = updatedTenantData.personalInfo.firstName;
                        updated = true;
                    }

                    if (updatedTenantData.personalInfo?.lastName && bill.bill.patientDetails.lastName !== updatedTenantData.personalInfo.lastName) {
                        bill.bill.patientDetails.lastName = updatedTenantData.personalInfo.lastName;
                        updated = true;
                    }

                    if (updatedTenantData.personalInfo?.dob && bill.bill.patientDetails.birthDate !== updatedTenantData.personalInfo.dob) {
                        bill.bill.patientDetails.birthDate = updatedTenantData.personalInfo.dob;
                        updated = true;
                    }

                    if (updatedTenantData.personalInfo?.gender && bill.bill.patientDetails.gender !== updatedTenantData.personalInfo.gender) {
                        bill.bill.patientDetails.gender = updatedTenantData.personalInfo.gender;
                        updated = true;
                    }

                    if (updatedTenantData.personalInfo?.maPMINumber && bill.bill.patientDetails.pmiNumber !== updatedTenantData.personalInfo.maPMINumber) {
                        bill.bill.patientDetails.pmiNumber = updatedTenantData.personalInfo.maPMINumber;
                        updated = true;
                    }
                }

                // Update address information
                if (bill.bill?.patientDetails?.address && updatedTenantData.address) {
                    if (updatedTenantData.address.city && bill.bill.patientDetails.address.city !== updatedTenantData.address.city) {
                        bill.bill.patientDetails.address.city = updatedTenantData.address.city;
                        updated = true;
                    }

                    if (updatedTenantData.address.state && bill.bill.patientDetails.address.state !== updatedTenantData.address.state) {
                        bill.bill.patientDetails.address.state = updatedTenantData.address.state;
                        updated = true;
                    }

                    if (updatedTenantData.address.zipCode && bill.bill.patientDetails.address.zipCode !== updatedTenantData.address.zipCode) {
                        bill.bill.patientDetails.address.zipCode = updatedTenantData.address.zipCode;
                        updated = true;
                    }
                }

                // Update insurance information
                if (bill.bill?.insurance && updatedTenantData.admissionInfo) {
                    if (updatedTenantData.admissionInfo.insurance && bill.bill.insurance.name !== updatedTenantData.admissionInfo.insurance) {
                        bill.bill.insurance.name = updatedTenantData.admissionInfo.insurance;
                        updated = true;
                    }

                    if (updatedTenantData.admissionInfo.insuranceNumber && bill.bill.insurance.memberNumber !== updatedTenantData.admissionInfo.insuranceNumber) {
                        bill.bill.insurance.memberNumber = updatedTenantData.admissionInfo.insuranceNumber;
                        updated = true;
                    }
                }

                if (updated) {
                    bill.updatedAt = new Date();
                    await bill.save();
                }
            }

            return { success: true, message: `Updated ${bills.length} bills for tenant changes` };
        } catch (error) {
            console.error('Error updating bills for tenant changes:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Update bills when company/admin data changes
     * @param {string} companyId - Company ID
     * @param {Object} updatedCompanyData - Updated company data
     */
    static async updateBillsForCompanyChanges(companyId, updatedCompanyData) {
        try {
            // Find all bills related to this company
            const bills = await Bill.find({ companyId });

            for (const bill of bills) {
                let updated = false;

                // Update company information in bill structure
                if (bill.bill?.providerInformation && updatedCompanyData) {
                    if (updatedCompanyData.companyName && bill.bill.providerInformation.organizationName !== updatedCompanyData.companyName) {
                        bill.bill.providerInformation.organizationName = updatedCompanyData.companyName;
                        updated = true;
                    }

                    if (updatedCompanyData.federalTaxId && bill.bill.providerInformation.taxId !== updatedCompanyData.federalTaxId) {
                        bill.bill.providerInformation.taxId = updatedCompanyData.federalTaxId;
                        updated = true;
                    }

                    if (updatedCompanyData.idnpiUmpi && bill.bill.providerInformation.npi !== updatedCompanyData.idnpiUmpi) {
                        bill.bill.providerInformation.npi = updatedCompanyData.idnpiUmpi;
                        updated = true;
                    }

                    // Update address information
                    if (updatedCompanyData.address) {
                        if (updatedCompanyData.address.city && bill.bill.providerInformation.address?.city !== updatedCompanyData.address.city) {
                            if (!bill.bill.providerInformation.address) bill.bill.providerInformation.address = {};
                            bill.bill.providerInformation.address.city = updatedCompanyData.address.city;
                            updated = true;
                        }

                        if (updatedCompanyData.address.state && bill.bill.providerInformation.address?.state !== updatedCompanyData.address.state) {
                            if (!bill.bill.providerInformation.address) bill.bill.providerInformation.address = {};
                            bill.bill.providerInformation.address.state = updatedCompanyData.address.state;
                            updated = true;
                        }

                        if (updatedCompanyData.address.zipCode && bill.bill.providerInformation.address?.zipCode !== updatedCompanyData.address.zipCode) {
                            if (!bill.bill.providerInformation.address) bill.bill.providerInformation.address = {};
                            bill.bill.providerInformation.address.zipCode = updatedCompanyData.address.zipCode;
                            updated = true;
                        }
                    }
                }

                if (updated) {
                    bill.updatedAt = new Date();
                    await bill.save();
                }
            }

            return { success: true, message: `Updated ${bills.length} bills for company changes` };
        } catch (error) {
            console.error('Error updating bills for company changes:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Update bills when visit data changes
     * @param {string} visitId - Visit ID
     * @param {Object} updatedVisitData - Updated visit data
     */
    static async updateBillsForVisitChanges(visitId, updatedVisitData) {
        try {
            // Find all bills related to this visit
            const bills = await Bill.find({ visitId });

            for (const bill of bills) {
                let updated = false;

                // Update service information
                if (bill.bill?.serviceLine && updatedVisitData) {
                    if (updatedVisitData.serviceType && bill.bill.serviceLine.description !== updatedVisitData.serviceType) {
                        bill.bill.serviceLine.description = updatedVisitData.serviceType;
                        updated = true;
                    }

                    if (updatedVisitData.startTime && updatedVisitData.endTime) {
                        const startTime = new Date(updatedVisitData.startTime);
                        const endTime = new Date(updatedVisitData.endTime);

                        if (!isNaN(startTime.getTime()) && !isNaN(endTime.getTime())) {
                            const durationMinutes = (endTime - startTime) / (1000 * 60);
                            const hours = Math.max(0, durationMinutes / 60);
                            const workedHours = Math.round(hours * 4) / 4; // Round to nearest 0.25
                            const workedUnits = Math.round(workedHours * 4);

                            // Update service units and amount based on service type
                            const serviceType = updatedVisitData.serviceType || bill.bill.serviceLine.description;

                            if (serviceType?.toLowerCase().includes('consultation')) {
                                // Housing Consultation: Per session billing
                                bill.bill.serviceLine.serviceUnitCount = 1;
                                updated = true;
                            } else if (serviceType?.toLowerCase().includes('moving') || serviceType?.toLowerCase().includes('expense')) {
                                // Moving Expenses: One-time billing
                                bill.bill.serviceLine.serviceUnitCount = 1;
                                updated = true;
                            } else {
                                // Housing Transition/Sustaining: Calculate from units/hours
                                if (bill.bill.serviceLine.serviceUnitCount !== workedUnits) {
                                    bill.bill.serviceLine.serviceUnitCount = workedUnits;
                                    updated = true;
                                }
                            }
                        }
                    }

                    if (updatedVisitData.place && bill.bill.serviceLine.placeOfService !== updatedVisitData.place) {
                        bill.bill.serviceLine.placeOfService = updatedVisitData.place;
                        updated = true;
                    }
                }

                // Update service date
                if (updatedVisitData.date) {
                    const newServiceDate = new Date(updatedVisitData.date);
                    if (bill.serviceDate.getTime() !== newServiceDate.getTime()) {
                        bill.serviceDate = newServiceDate;
                        updated = true;
                    }
                }

                if (updated) {
                    bill.updatedAt = new Date();
                    await bill.save();
                }
            }

            return { success: true, message: `Updated ${bills.length} bills for visit changes` };
        } catch (error) {
            console.error('Error updating bills for visit changes:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Update bills when service tracking data changes
     * @param {string} serviceTrackingId - Service Tracking ID
     * @param {Object} updatedServiceData - Updated service data
     */
    static async updateBillsForServiceChanges(serviceTrackingId, updatedServiceData) {
        try {
            // Find the service tracking record
            const serviceTracking = await ServiceTracking.findById(serviceTrackingId);
            if (!serviceTracking) {
                return { success: false, message: 'Service tracking record not found' };
            }

            // Find all bills related to this tenant and service type
            const bills = await Bill.find({
                tenantId: serviceTracking.tenantId,
                'bill.serviceLine.description': serviceTracking.serviceType
            });

            for (const bill of bills) {
                let updated = false;

                // Update billing rate if changed
                if (updatedServiceData.billRate && bill.bill?.serviceLine) {
                    const newRate = parseFloat(updatedServiceData.billRate);
                    const currentUnits = parseInt(bill.bill.serviceLine.serviceUnitCount || 0);
                    const newAmount = newRate * currentUnits;

                    if (bill.bill.serviceLine.lineItemChargeAmount !== newAmount) {
                        bill.bill.serviceLine.lineItemChargeAmount = newAmount;
                        bill.bill.claimInformation.totalClaimChargeAmount = newAmount;
                        updated = true;
                    }
                }

                if (updated) {
                    bill.updatedAt = new Date();
                    await bill.save();
                }
            }

            return { success: true, message: `Updated ${bills.length} bills for service changes` };
        } catch (error) {
            console.error('Error updating bills for service changes:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Comprehensive bill validation and update
     * @param {string} billId - Bill ID to validate and update
     */
    static async validateAndUpdateBill(billId) {
        try {
            const bill = await Bill.findById(billId)
                .populate('tenantId')
                .populate('hcmId')
                .populate('visitId');

            if (!bill) {
                return { success: false, message: 'Bill not found' };
            }

            let updated = false;

            // Validate and update tenant information
            if (bill.tenantId) {
                const tenantInfoRecord = await tenantInfo.findById(bill.tenantId.info_id);
                if (tenantInfoRecord) {
                    const correctTenantName = `${tenantInfoRecord.personalInfo?.firstName || ''} ${tenantInfoRecord.personalInfo?.middleName || ''} ${tenantInfoRecord.personalInfo?.lastName || ''}`.trim();
                    if (bill.tenantName !== correctTenantName) {
                        bill.tenantName = correctTenantName;
                        updated = true;
                    }
                }
            }

            // Validate and update HCM information
            if (bill.hcmId) {
                const hcmInfoRecord = await hcmInfo.findById(bill.hcmId.info_id);
                if (hcmInfoRecord) {
                    const correctHcmName = `${hcmInfoRecord.personalInfo?.firstName || ''} ${hcmInfoRecord.personalInfo?.middleName || ''} ${hcmInfoRecord.personalInfo?.lastName || ''}`.trim();
                    if (bill.hcmName !== correctHcmName) {
                        bill.hcmName = correctHcmName;
                        updated = true;
                    }
                }
            }

            // Validate and update visit information
            if (bill.visitId) {
                const visit = await Visits.findById(bill.visitId);
                if (visit) {
                    if (bill.serviceDate.getTime() !== visit.date.getTime()) {
                        bill.serviceDate = visit.date;
                        updated = true;
                    }

                    if (bill.bill?.serviceLine?.description !== visit.serviceType) {
                        bill.bill.serviceLine.description = visit.serviceType;
                        updated = true;
                    }
                }
            }

            if (updated) {
                bill.updatedAt = new Date();
                await bill.save();
            }

            return { success: true, message: updated ? 'Bill updated successfully' : 'Bill is already up to date' };
        } catch (error) {
            console.error('Error validating and updating bill:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Update bills when HCM information changes
     * @param {string} hcmId - The HCM ID that was updated
     * @param {Object} updatedHcmData - The updated HCM data
     */
    static async updateBillsForHcmChange(hcmId, updatedHcmData) {
        try {
            // Find all bills that contain this HCM
            const bills = await Bill.find({
                'hcms.id': hcmId
            });
            for (const bill of bills) {
                let billUpdated = false;

                // Update HCM information in the hcms array
                bill.hcms.forEach(hcm => {
                    if (hcm.id && hcm.id.toString() === hcmId.toString()) {
                        if (updatedHcmData.name && hcm.name !== updatedHcmData.name) {
                            hcm.name = updatedHcmData.name;
                            billUpdated = true;
                        }
                    }
                });

                if (billUpdated) {
                    await bill.save();
                    // Regenerate EDI if needed
                    try {
                        const { regenerateEdiForBill } = await import('../utils/dynamicEdiUpdater.js');
                        await regenerateEdiForBill(bill._id);
                    } catch (ediError) {
                        console.error(`[BILL UPDATE] Error regenerating EDI for bill ${bill._id}:`, ediError);
                    }
                }
            }

            return { success: true, message: `Updated ${bills.length} bills for HCM change` };
        } catch (error) {
            console.error('[BILL UPDATE] Error updating bills for HCM change:', error);
            return { success: false, message: error.message };
        }
    }
}

export default BillUpdateService; 