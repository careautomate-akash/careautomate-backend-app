import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import pkg from 'ftp';
const { Client: FTPClient } = pkg;
import Bill from '../models/bills/bills.js';
import mongoose from 'mongoose';
import { setupUploadDirectories } from './setupDirectories.js';
import cron from 'node-cron';

const { uploadsDir } = setupUploadDirectories();
const ftpBatchDir = path.join(uploadsDir, 'ftpBatch');
if (!fs.existsSync(ftpBatchDir)) {
    fs.mkdirSync(ftpBatchDir);
}

const ftpConfig = {
    host: process.env.FTP_HOST || 'secureftp.dhs.state.mn.us',
    port: parseInt(process.env.FTP_PORT) || 22,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    secure: true,
    secureOptions: {
        rejectUnauthorized: false
    }
};

const generateFileName = (bill) => {
    const npi = bill.isGovernmentInsurance ? 'A634637200' : (bill.companyNPI || '1111111111');
    const transactionType = '837P';
    const today = new Date();
    const date = today.toISOString().split('T')[0].replace(/-/g, '');

    return `${npi}_${transactionType}_${date}.dat`;
};

const createDatFile = async (bill) => {
    const fileName = generateFileName(bill);
    const filePath = path.join(ftpBatchDir, fileName);

    await fs.promises.writeFile(filePath, bill.ediContent);

    return { fileName, filePath };
};

const uploadFileToFTP = (filePath, fileName, isGovernmentInsurance) => {
    // Only upload government insurance claims to the FTP server
    if (!isGovernmentInsurance) {
        return Promise.resolve(true);
    }

    return new Promise((resolve, reject) => {
        const ftp = new FTPClient();

        ftp.on('ready', () => {
            ftp.cwd('X12/NCPDP Pharmacy Transactions', (err) => {
                if (err) {
                    ftp.end();
                    return reject(`Error navigating to destination folder: ${err}`);
                }

                ftp.put(filePath, fileName, (err) => {
                    if (err) {
                        ftp.end();
                        return reject(`Error uploading file: ${err}`);
                    }

                    console.log(`Successfully uploaded ${fileName} to FTP server (government insurance)`);
                    ftp.end();
                    resolve(true);
                });
            });
        });

        ftp.on('error', (err) => {
            reject(`FTP connection error: ${err}`);
        });

        ftp.connect(ftpConfig);
    });
};

const processPendingBills = async () => {
    try {
        const pendingBills = await Bill.find({ status: 'scheduled' });

        if (pendingBills.length === 0) {
            return;
        }
        // Process each bill
        for (const bill of pendingBills) {
            try {
                if (!bill.ediContent) {
                    continue;
                }

                // Check if this is a government insurance claim
                const isGovernmentInsurance = bill.isGovernmentInsurance ||
                    (bill.insurance && bill.insurance.name &&
                        bill.insurance.name.toLowerCase() === 'medical assistance');

                const { fileName, filePath } = await createDatFile(bill);

                // Only upload government insurance claims to the FTP server
                if (isGovernmentInsurance) {
                    await uploadFileToFTP(filePath, fileName, isGovernmentInsurance);
                } else {
                    console.log(`Private insurance claim not uploaded to FTP: ${fileName} (should be uploaded to Waystar portal)`);
                }

                bill.status = 'submitted';
                bill.updatedAt = new Date();
                await bill.save();
                fs.unlinkSync(filePath);
            } catch (error) {
                console.error(`Error processing bill ID ${bill._id}:`, error);
            }
        }
    } catch (error) {
        console.error('Error processing pending bills:', error);
    }
};

const createStatusIndex = async () => {
    try {
    } catch (error) {
        console.error('Error creating index:', error);
    }
};

createStatusIndex().catch(console.error);

export const testFTPConnection = async (targetFolder = 'X12/NCPDP Pharmacy Transactions') => {
    return new Promise((resolve, reject) => {
        const testFileName = `test_connection_${Date.now()}.txt`;
        const testFilePath = path.join(ftpBatchDir, testFileName);

        // Create a small test file
        fs.writeFileSync(testFilePath, 'This is a test file to verify FTP connection and upload permissions.');

        const ftp = new FTPClient();

        ftp.on('ready', () => {
            ftp.cwd(targetFolder, (err) => {
                if (err) {
                    fs.unlinkSync(testFilePath);
                    ftp.end();
                    return reject({
                        success: false,
                        message: `Error: Could not navigate to folder "${targetFolder}": ${err}`,
                        details: err
                    });
                }
                ftp.put(testFilePath, testFileName, (err) => {
                    if (err) {
                        fs.unlinkSync(testFilePath);
                        ftp.end();
                        return reject({
                            success: false,
                            message: `Error: Could not upload to folder "${targetFolder}": ${err}`,
                            details: err
                        });
                    }
                    // Delete the test file from the FTP server
                    ftp.delete(testFileName, (err) => {
                        if (err) {
                            console.warn(`Warning: Could not delete test file from FTP server: ${err}`);
                        } else {
                        }

                        fs.unlinkSync(testFilePath);
                        ftp.end();
                        resolve({
                            success: true,
                            message: `Successfully connected to FTP server and verified upload permissions for folder "${targetFolder}"`
                        });
                    });
                });
            });
        });

        ftp.on('error', (err) => {
            fs.unlinkSync(testFilePath);
            reject({
                success: false,
                message: `FTP connection error: ${err}`,
                details: err
            });
        });
        ftp.connect(ftpConfig);
    });
};

// Command line execution for direct testing
if (process.argv[2] === 'test-ftp') {
    const targetFolder = process.argv[3] || 'X12/NCPDP Pharmacy Transactions';
    testFTPConnection(targetFolder)
        .then(result => {
            process.exit(0);
        })
        .catch(error => {
            console.error('\nTEST RESULT:');
            console.error(error);
            process.exit(1);
        });
}

export const scheduleFTPUpload = () => {
    cron.schedule('59 23 * * *', () => {
        processPendingBills().catch(console.error);
    });
};

export const triggerFTPUpload = () => {
    return processPendingBills();
};
