import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import Bill from '../models/bills/bills.js';
import { setupUploadDirectories } from './setupDirectories.js';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { uploadsDir } = setupUploadDirectories();
const googleDriveBatchDir = path.join(uploadsDir, 'googleDriveBatch');
const mnItsBatchDir = path.join(uploadsDir, 'mnItsBatch');

const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

if (!fs.existsSync(googleDriveBatchDir)) {
    fs.mkdirSync(googleDriveBatchDir, { recursive: true });
}

if (!fs.existsSync(mnItsBatchDir)) {
    fs.mkdirSync(mnItsBatchDir, { recursive: true });
}

export const setupGoogleDrive = () => {
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(process.cwd(), 'credentials.json'),
            scopes: ['https://www.googleapis.com/auth/drive.file']
        });

        const drive = google.drive({
            version: 'v3',
            auth
        });

        return { auth, drive };
    } catch (error) {
        console.error('Error setting up Google Drive:', error);
        throw error;
    }
};

export const uploadToGoogleDrive = async (filePath, fileName, folderId) => {
    try {
        const { drive } = setupGoogleDrive();

        const fileMetadata = {
            name: fileName,
            parents: folderId ? [folderId] : []
        };

        const media = {
            mimeType: 'application/octet-stream',
            body: fs.createReadStream(filePath)
        };

        const response = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, webViewLink'
        });

        return {
            fileId: response.data.id,
            webViewLink: response.data.webViewLink
        };
    } catch (error) {
        console.error('Error uploading to Google Drive:', error);
        throw error;
    }
};

const createDatFile = async (bill) => {
    const npi = bill.isGovernmentInsurance ? 'A634637200' : (bill.companyNPI || '1111111111');
    const transactionType = '837P';
    const today = new Date();
    const date = today.toISOString().split('T')[0].replace(/-/g, '');
    const fileDescription = bill.isGovernmentInsurance ? 'gov_trans' : 'priv_trans';
    const fileName = `${npi}_${transactionType}_${date}_${fileDescription}.dat`;

    const filePath = path.join(googleDriveBatchDir, fileName);

    await fs.promises.writeFile(filePath, bill.ediContent);

    return { fileName, filePath };
};

export const processAndUploadEDIs = async (folderId) => {
    try {
        const pendingBills = await Bill.find({ status: 'scheduled' });

        if (pendingBills.length === 0) {
            return { success: true, message: 'No pending bills to upload' };
        }
        const results = [];

        for (const bill of pendingBills) {
            try {
                if (!bill.ediContent) {
                    continue;
                }

                const { fileName, filePath } = await createDatFile(bill);
                const uploadResult = await uploadToGoogleDrive(filePath, fileName, folderId);

                bill.status = 'submitted';
                bill.googleDriveFileId = uploadResult.fileId;
                bill.googleDriveLink = uploadResult.webViewLink;
                bill.updatedAt = new Date();
                await bill.save();

                results.push({
                    billId: bill._id,
                    fileName,
                    googleDriveFileId: uploadResult.fileId,
                    googleDriveLink: uploadResult.webViewLink
                });
                fs.unlinkSync(filePath);
            } catch (error) {
                console.error(`Error processing bill ID ${bill._id}:`, error);
                results.push({
                    billId: bill._id,
                    error: error.message
                });
            }
        }
        return {
            success: true,
            message: `Successfully processed ${results.filter(r => !r.error).length} bills.`,
            results
        };
    } catch (error) {
        console.error('Error processing pending bills:', error);
        return {
            success: false,
            message: 'Error processing pending bills',
            error: error.message
        };
    }
};

export const uploadBatchEDIs = async (batchEDIs, folderId) => {
    try {
        if (!batchEDIs || !Array.isArray(batchEDIs) || batchEDIs.length === 0) {
            return {
                success: false,
                message: 'No batch EDIs provided for upload'
            };
        }

        const results = [];

        for (const edi of batchEDIs) {
            try {
                const filePath = path.join(googleDriveBatchDir, edi.ediFileName);
                await fs.promises.writeFile(filePath, edi.ediContent);

                const uploadResult = await uploadToGoogleDrive(filePath, edi.ediFileName, folderId);

                results.push({
                    fileName: edi.ediFileName,
                    googleDriveFileId: uploadResult.fileId,
                    googleDriveLink: uploadResult.webViewLink,
                    isGovernmentInsurance: edi.isGovernmentInsurance
                });

                fs.unlinkSync(filePath);
            } catch (error) {
                console.error(`Error uploading batch EDI file ${edi.ediFileName}:`, error);
                results.push({
                    fileName: edi.ediFileName,
                    error: error.message
                });
            }
        }

        return {
            success: true,
            message: `Successfully uploaded ${results.filter(r => !r.error).length} batch EDI files.`,
            results
        };
    } catch (error) {
        console.error('Error uploading batch EDI files:', error);
        return {
            success: false,
            message: 'Error uploading batch EDI files',
            error: error.message
        };
    }
};

export const testGoogleDriveConnection = async (folderId = GOOGLE_DRIVE_FOLDER_ID) => {
    try {
        if (!folderId) {
            throw new Error('No folder ID provided and GOOGLE_DRIVE_FOLDER_ID not set in environment');
        }
        const testFileName = `test_connection_${Date.now()}.txt`;
        const testFilePath = path.join(googleDriveBatchDir, testFileName);
        fs.writeFileSync(testFilePath, 'This is a test file to verify Google Drive connection and upload permissions.');

        const result = await uploadToGoogleDrive(testFilePath, testFileName, folderId);

        fs.unlinkSync(testFilePath);

        return {
            success: true,
            message: 'Successfully connected to Google Drive and verified upload permissions',
            fileId: result.fileId,
            link: result.webViewLink
        };
    } catch (error) {
        console.error('Detailed Google Drive connection error:', error);
        return {
            success: false,
            message: 'Error testing Google Drive connection',
            error: error.message
        };
    }
};

export const scheduleGoogleDriveUpload = (folderId = GOOGLE_DRIVE_FOLDER_ID) => {
    cron.schedule('59 23 * * *', () => {
        processAndUploadEDIs(folderId).catch(console.error);
    });
};

export const triggerGoogleDriveUpload = (folderId = GOOGLE_DRIVE_FOLDER_ID) => {
    return processAndUploadEDIs(folderId);
};

const MNITS_USERNAME = process.env.MNITS_USERNAME || 'accepttest@A634637200';
const MNITS_PASSWORD = process.env.MNITS_PASSWORD || 'your_password_here';
const MNITS_LOGIN_URL = 'https://mn-its-atst.dhs.state.mn.us/gatewayweb/login';

export const prepareMnItsFiles = async () => {
    try {
        const pendingBills = await Bill.find({
            status: 'scheduled',
            isGovernmentInsurance: true
        });

        if (pendingBills.length === 0) {
            return { success: true, message: 'No pending government insurance bills to prepare' };
        }
        const results = [];
        const outputDir = path.join(process.cwd(), 'uploads', 'mnItsReady');

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        for (const bill of pendingBills) {
            try {
                if (!bill.ediContent) {
                    continue;
                }

                const npi = 'A634637200';
                const transactionType = '837P';
                const today = new Date();
                const date = today.toISOString().split('T')[0].replace(/-/g, '');
                const fileName = `${npi}_${transactionType}_${date}_gov_trans.dat`;
                const filePath = path.join(outputDir, fileName);

                await fs.promises.writeFile(filePath, bill.ediContent);

                results.push({
                    billId: bill._id,
                    fileName,
                    filePath,
                    preparedAt: new Date()
                });
            } catch (error) {
                console.error(`Error processing bill ID ${bill._id}:`, error);
                results.push({
                    billId: bill._id,
                    error: error.message
                });
            }
        }

        const manifestPath = path.join(outputDir, 'UPLOAD_INSTRUCTIONS.txt');
        const instructions = `
MN-ITS UPLOAD INSTRUCTIONS
=========================
1. Connect to the required VPN
2. Navigate to: ${MNITS_LOGIN_URL}
3. Login with your credentials: ${MNITS_USERNAME}
4. Go to "Submit Transactions"
5. Select "X12" as the file type
6. Upload the .dat files in this folder
7. After upload, please mark the bills as submitted in the system

Files prepared: ${results.filter(r => !r.error).length}
Preparation date: ${new Date().toISOString()}
        `;
        await fs.promises.writeFile(manifestPath, instructions);
        return {
            success: true,
            message: `Successfully prepared ${results.filter(r => !r.error).length} files for manual upload`,
            outputDir,
            results
        };
    } catch (error) {
        console.error('Error preparing MN-ITS files:', error);
        return {
            success: false,
            message: 'Error preparing MN-ITS files',
            error: error.message
        };
    }
};

export const testMnItsFileGeneration = async () => {
    try {
        const testFileName = `test_connection_${Date.now()}.dat`;
        const outputDir = path.join(process.cwd(), 'uploads', 'mnItsReady');

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const testFilePath = path.join(outputDir, testFileName);

        const testEdiContent = `ISA*00*          *00*          *ZZ*A634637200     *30*41-1674742     *${new Date().toISOString().slice(0, 10).replace(/-/g, '')}*${new Date().getHours()}${new Date().getMinutes()}*^*00501*${Math.floor(100000000 + Math.random() * 900000000)}*1*P*:~
GS*HC*A634637200*41-1674742*${new Date().toISOString().slice(0, 10).replace(/-/g, '')}*${new Date().getHours()}${new Date().getMinutes()}*1*X*005010X222A1~
ST*837*0001*005010X222A1~
BHT*0019*00*1*${new Date().toISOString().slice(0, 10).replace(/-/g, '')}*${new Date().getHours()}${new Date().getMinutes()}*CH~
NM1*41*2*CIRCINNO SOFTWARES INC*****46*A634637200~
NM1*40*2*MINNESOTA DEPT OF HUMAN SERVICES*****46*41-1674742~
HL*1**20*1~
NM1*85*1*TEST PROVIDER*****XX*1234567890~
N3*123 TEST STREET~
N4*MINNEAPOLIS*MN*55401~
REF*EI*123456789~
HL*2*1*22*0~
SBR*P*18*******MA~
NM1*IL*1*TEST*PATIENT****MI*12345678~
N3*456 TEST AVE~
N4*MINNEAPOLIS*MN*55401~
DMG*D8*20000101*M~
NM1*PR*2*MINNESOTA DEPT OF HUMAN SERVICES*****PI*41-1674742~
N3*PO BOX 52~
N4*MINNEAPOLIS*MN*55440~
CLM*TEST12345*150***11:B:1*Y*A*Y*Y~
HI*ABF:F90.0~
NM1*82*1*TEST*PROVIDER*Z~
LX*1~
SV1*HC:H2015:U8*150*UN*10***1~
DTP*472*D8*${new Date().toISOString().slice(0, 10).replace(/-/g, '')}~
REF*6R*TEST12345~
SE*28*0001~
GE*1*1~
IEA*1*1~`;

        await fs.promises.writeFile(testFilePath, testEdiContent);
        const instructionsPath = path.join(outputDir, 'TEST_FILE_INSTRUCTIONS.txt');
        const instructions = `
TEST FILE UPLOAD INSTRUCTIONS
============================
This test file has been generated with proper 837P format for MN-ITS.
To test the upload:

1. Connect to the required VPN
2. Navigate to: ${MNITS_LOGIN_URL}
3. Login with your credentials: ${MNITS_USERNAME}
4. Go to "Submit Transactions"
5. Select "X12" as the file type
6. Upload the file: ${testFileName}

After confirming the upload works, you can implement the manual workflow
or further investigate API options for automation.
        `;
        await fs.promises.writeFile(instructionsPath, instructions);

        return {
            success: true,
            message: 'Successfully generated test EDI file for MN-ITS',
            filePath: testFilePath
        };
    } catch (error) {
        console.error('Error generating test MN-ITS file:', error);
        return {
            success: false,
            message: 'Error generating test MN-ITS file',
            error: error.message
        };
    }
};

export const testMnItsConnection = async () => {
    try {
        // First, generate a test file
        const testFileResult = await testMnItsFileGeneration();

        if (!testFileResult.success) {
            return {
                success: false,
                message: 'Failed to generate test MN-ITS file',
                details: testFileResult
            };
        }
        // Simple API test to check if we can reach the MN-ITS endpoint
        try {
            const response = await fetch('https://mn-its-atst.dhs.state.mn.us/gatewayweb/login', {
                method: 'GET',
                timeout: 10000
            });

            if (!response.ok) {
                return {
                    success: false,
                    message: 'Failed to connect to MN-ITS website. VPN connection may be required.',
                    details: {
                        status: response.status,
                        statusText: response.statusText
                    }
                };
            }
        } catch (error) {
            console.error('Network error connecting to MN-ITS:', error);
            return {
                success: false,
                message: 'Network error connecting to MN-ITS. VPN connection may be required.',
                error: error.message
            };
        }

        return {
            success: true,
            message: 'Successfully connected to MN-ITS and generated test file',
            testFilePath: testFileResult.filePath,
            uploadInstructions: 'To complete the test, manually upload the generated file through the MN-ITS web interface.'
        };
    } catch (error) {
        console.error('Error testing MN-ITS connection:', error);
        return {
            success: false,
            message: 'Error testing MN-ITS connection',
            error: error.message
        };
    }
};

export const uploadToMnIts = async (billId) => {
    try {
        // Fetch bill from database
        const bill = await Bill.findById(billId);
        if (!bill) {
            return {
                success: false,
                message: 'Bill not found'
            };
        }

        // Check if bill is for government insurance
        if (!bill.isGovernmentInsurance) {
            return {
                success: false,
                message: 'Bill is not for government insurance and cannot be uploaded to MN-ITS'
            };
        }

        // Generate EDI content if it doesn't exist
        if (!bill.ediContent) {
            const { ediContent, ediFileName } = await generateEDI(bill);
            bill.ediContent = ediContent;
            bill.ediFileName = ediFileName;
            await bill.save();
        }

        // Create DAT file from EDI content
        const npi = 'A634637200';
        const transactionType = '837P';
        const today = new Date();
        const date = today.toISOString().split('T')[0].replace(/-/g, '');
        const fileName = `${npi}_${transactionType}_${date}_gov_trans.dat`;
        const filePath = path.join(mnItsBatchDir, fileName);

        await fs.promises.writeFile(filePath, bill.ediContent);
        // Prepare result message with manual instructions
        const result = {
            success: true,
            message: 'Successfully prepared MN-ITS file for upload',
            billId: bill._id,
            fileName,
            filePath,
            manualInstructions: `
1. Connect to the required VPN
2. Navigate to: ${MNITS_LOGIN_URL}
3. Login with your credentials: ${MNITS_USERNAME}
4. Go to "Submit Transactions"
5. Select "X12" as the file type
6. Upload the .dat file: ${fileName}
7. After upload, please mark the bill as submitted in the system
            `
        };

        // Update bill status to indicate file is ready for upload
        bill.status = 'ready_for_mnits';
        bill.mnItsFilePath = filePath;
        bill.updatedAt = new Date();
        await bill.save();
        return result;
    } catch (error) {
        console.error(`Error preparing bill ${billId} for MN-ITS upload:`, error);
        return {
            success: false,
            message: 'Error preparing bill for MN-ITS upload',
            error: error.message
        };
    }
};

// Function to process multiple bills for MN-ITS upload
export const processBillsForMnIts = async () => {
    try {
        const pendingBills = await Bill.find({
            status: 'scheduled',
            isGovernmentInsurance: true
        });

        if (pendingBills.length === 0) {
            return {
                success: true,
                message: 'No pending government insurance bills to process'
            };
        }
        const results = [];

        for (const bill of pendingBills) {
            try {
                const result = await uploadToMnIts(bill._id);
                results.push({
                    billId: bill._id,
                    success: result.success,
                    fileName: result.fileName,
                    filePath: result.filePath
                });
            } catch (error) {
                console.error(`Error processing bill ${bill._id}:`, error);
                results.push({
                    billId: bill._id,
                    success: false,
                    error: error.message
                });
            }
        }

        return {
            success: true,
            message: `Successfully processed ${results.filter(r => r.success).length} bills for MN-ITS upload`,
            results
        };
    } catch (error) {
        console.error('Error processing bills for MN-ITS upload:', error);
        return {
            success: false,
            message: 'Error processing bills for MN-ITS upload',
            error: error.message
        };
    }
};

// Schedule MN-ITS processing daily
export const scheduleMnItsProcessing = () => {
    cron.schedule('0 0 * * *', () => {
        processBillsForMnIts().catch(console.error);
    });
}; 