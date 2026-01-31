import Bills from '../models/bills/bills.js';
import { generateEDI } from '../tasks/generateEdiFile.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

export const updateEDIForCompanyChanges = async (companyId, updatedCompanyData) => {
    try {
        // Find all bills for this company
        const bills = await Bills.find({ companyId });

        for (const bill of bills) {
            // Update company data in the bill
            bill.company = {
                ...bill.company,
                ...updatedCompanyData
            };

            // Regenerate EDI content
            const ediFile = await generateEDI(bill);
            bill.ediContent = ediFile.ediContent;
            bill.ediFileName = ediFile.ediFileName;

            // Upload updated EDI to S3
            const s3Key = `edis/${ediFile.ediFileName}`;
            const uploadParams = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: s3Key,
                Body: ediFile.ediContent,
                ContentType: 'application/edi-x12',
            };

            await s3Client.send(new PutObjectCommand(uploadParams));
            await bill.save();
        }
        return { success: true, updatedBills: bills.length };
    } catch (error) {
        console.error('Error updating EDI for company changes:', error);
        throw error;
    }
};

export const updateEDIForTenantChanges = async (tenantId, updatedTenantData) => {
    try {
        // Find all bills for this tenant
        const bills = await Bills.find({ tenantId });

        for (const bill of bills) {
            // Update tenant data in the bill
            if (updatedTenantData.personalInfo) {
                bill.patientDetails.firstName = updatedTenantData.personalInfo.firstName;
                bill.patientDetails.lastName = updatedTenantData.personalInfo.lastName;
                bill.patientDetails.gender = updatedTenantData.personalInfo.gender;
                bill.patientDetails.birthDate = updatedTenantData.personalInfo.dob;
                bill.patientDetails.pmiNumber = updatedTenantData.personalInfo.maPMINumber;
            }

            if (updatedTenantData.address) {
                bill.patientDetails.address = {
                    ...bill.patientDetails.address,
                    ...updatedTenantData.address
                };
            }

            if (updatedTenantData.admissionInfo) {
                bill.insurance.name = updatedTenantData.admissionInfo.insurance;
                bill.insurance.identifier = updatedTenantData.admissionInfo.insuranceNumber;
                bill.patientDetails.diagnosisCode = updatedTenantData.admissionInfo.diagnosisCode;
            }

            // Regenerate EDI content
            const ediFile = await generateEDI(bill);
            bill.ediContent = ediFile.ediContent;
            bill.ediFileName = ediFile.ediFileName;

            // Upload updated EDI to S3
            const s3Key = `edis/${ediFile.ediFileName}`;
            const uploadParams = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: s3Key,
                Body: ediFile.ediContent,
                ContentType: 'application/edi-x12',
            };

            await s3Client.send(new PutObjectCommand(uploadParams));
            await bill.save();
        }
        return { success: true, updatedBills: bills.length };
    } catch (error) {
        console.error('Error updating EDI for tenant changes:', error);
        throw error;
    }
}; 