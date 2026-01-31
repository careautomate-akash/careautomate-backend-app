// utils/mnItsUploader.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import Bill from '../models/bills/bills.js';
import { setupUploadDirectories } from './setupDirectories.js';
import cron from 'node-cron';
import { generateEDI } from '../tasks/generateEdiFile.js';
import SftpClient from 'ssh2-sftp-client';
import ftp from 'ftp';
import dns from 'dns';
import net from 'net';
import fetch from 'node-fetch';
const FTPClient = ftp;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { uploadsDir } = setupUploadDirectories();
const mnItsBatchDir = path.join(uploadsDir, 'mnItsBatch');

// Create batch directory if it doesn't exist
if (!fs.existsSync(mnItsBatchDir)) {
    fs.mkdirSync(mnItsBatchDir, { recursive: true });
}

// MN-ITS credentials - updated to match exact format required
// Use UMPI as specified in the documentation (A634637200)
const MNITS_USERNAME = process.env.MNITS_USERNAME || 'AAli Khan@A634637200';
const MNITS_PASSWORD = process.env.MNITS_PASSWORD || 'Ashmiza2021!';
const MNITS_LOGIN_URL = 'https://mn-its.dhs.state.mn.us/gatewayweb/login';

// FTP configuration - updated according to MN-ITS documentation
// Must use port 2222 for SFTP/SCP via SSH
const ftpConfig = {
    host: process.env.FTP_HOST || 'secureftp.dhs.state.mn.us',
    port: parseInt(process.env.FTP_PORT) || 2222, // SFTP/SCP via SSH uses port 2222 per MN-ITS docs
    username: process.env.FTP_USER || MNITS_USERNAME,
    password: process.env.FTP_PASSWORD || MNITS_PASSWORD,
    algorithms: {
        serverHostKey: [
            'ssh-rsa',
            'ecdsa-sha2-nistp256',
            'ssh-ed25519'
        ]
    },
    // Because it's a government/agency server, relax some defaults
    readyTimeout: 60000,
    keepaliveInterval: 30000,
    retries: 3,
    retry_minTimeout: 2000,
    debug: process.env.NODE_ENV === 'development' ? console.log : undefined
};

// Error interpretation - translate technical errors to human-readable explanations
const interpretConnectionError = (error) => {
    const errorDetails = {
        code: error.code || 'UNKNOWN',
        message: error.message || 'Unknown error',
        detailedExplanation: '',
        possibleSolutions: []
    };

    // Handle specific error codes
    switch (errorDetails.code) {
        case 'ECONNREFUSED':
            errorDetails.detailedExplanation = 'Connection was actively refused by the MN-ITS server. This typically means either the server address is incorrect, the port number is wrong, or the server is not accepting connections at this time.';
            errorDetails.possibleSolutions = [
                'Verify the server address is secureftp.dhs.state.mn.us',
                'Confirm port 2222 is correct for SFTP connections',
                'Check if your IP address is allowed (you may need to be on an approved network)',
                'Contact MN-ITS support at 651-431-2700 to verify your account and connection details'
            ];
            break;
        case 'ETIMEDOUT':
            errorDetails.detailedExplanation = 'Connection attempt timed out. This could mean the server is unreachable, there are network issues, or a firewall is blocking the connection.';
            errorDetails.possibleSolutions = [
                'Check your network connection',
                'Verify no firewall is blocking outgoing SFTP connections',
                'Try connecting from a different network',
                'Contact your IT department to verify outbound access to the MN-ITS SFTP server'
            ];
            break;
        case 'ENOTFOUND':
            errorDetails.detailedExplanation = 'The MN-ITS server hostname could not be resolved. This is a DNS issue.';
            errorDetails.possibleSolutions = [
                'Verify your DNS settings',
                'Try using an IP address instead of hostname if available',
                'Contact your network administrator'
            ];
            break;
        case 'EACCES':
            errorDetails.detailedExplanation = 'Permission denied. This typically means authentication failed (incorrect username or password).';
            errorDetails.possibleSolutions = [
                'Verify your username format matches exactly as provided by MN-ITS',
                'Check if password has expired (they expire every 3 months)',
                'Ensure username includes the UMPI in correct format (e.g., "AAli Khan@A634637200")',
                'Contact MN-ITS support at 651-431-2700 to reset your credentials'
            ];
            break;
        case 'All configured authentication methods failed':
            errorDetails.detailedExplanation = 'Authentication failed. The server rejected all authentication attempts.';
            errorDetails.possibleSolutions = [
                'Verify your username and password are correct',
                'Check if your account has been locked due to failed attempts',
                'Ensure you\'re using the correct authentication method (password-based auth)',
                'Contact MN-ITS support at 651-431-2700 to verify your account status'
            ];
            break;
        case 'No such file':
            errorDetails.detailedExplanation = 'The remote directory structure is not as expected. This could mean your account does not have the correct folder structure setup.';
            errorDetails.possibleSolutions = [
                'Contact MN-ITS support to verify your account has been properly set up with the correct directories',
                'Check folder spelling and case sensitivity (directory names are case sensitive)'
            ];
            break;
        default:
            if (error.message && error.message.includes('authentication')) {
                errorDetails.detailedExplanation = 'Authentication failed. This is typically due to incorrect credentials.';
                errorDetails.possibleSolutions = [
                    'Verify your username and password are correct',
                    'Ensure username format matches exactly what MN-ITS provided',
                    'Check if your password has expired (they expire every 3 months)',
                    'Contact MN-ITS support at 651-431-2700 for assistance'
                ];
            } else if (error.message && error.message.includes('permission denied')) {
                errorDetails.detailedExplanation = 'Permission denied. You don\'t have access to the requested directory or file operation.';
                errorDetails.possibleSolutions = [
                    'Verify you are navigating to the correct directories',
                    'Contact MN-ITS support to ensure your account has proper permissions'
                ];
            } else {
                errorDetails.detailedExplanation = 'An unexpected error occurred during the SFTP connection or operation.';
                errorDetails.possibleSolutions = [
                    'Check your connection parameters',
                    'Verify your credentials',
                    'Contact MN-ITS support at 651-431-2700 with the error details'
                ];
            }
    }

    return errorDetails;
};

// Function to perform network diagnostics on MN-ITS connection
export const diagnoseMnItsConnection = async () => {
    const results = {
        dns: null,
        tcp: null,
        authentication: null,
        folderAccess: null,
        overall: {
            success: false,
            message: 'Diagnosis not completed'
        }
    };

    try {
        // 1. DNS resolution test
        try {
            const dnsResult = await new Promise((resolve, reject) => {
                dns.lookup(ftpConfig.host, (err, address) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ address });
                    }
                });
            });

            results.dns = {
                success: true,
                message: `Successfully resolved ${ftpConfig.host} to ${dnsResult.address}`
            };
        } catch (error) {
            results.dns = {
                success: false,
                message: `Failed to resolve ${ftpConfig.host}: ${error.message}`,
                error: interpretConnectionError(error)
            };
            console.error(results.dns.message);

            // Early return if DNS fails - can't proceed without DNS
            results.overall = {
                success: false,
                message: 'DNS resolution failed - cannot connect to MN-ITS server',
                details: results
            };
            return results;
        }

        // 2. TCP connection test
        try {
            const tcpResult = await new Promise((resolve, reject) => {
                const socket = new net.Socket();
                let connected = false;

                socket.setTimeout(5000); // 5 second timeout

                socket.on('connect', () => {
                    connected = true;
                    socket.end();
                    resolve({ connected: true });
                });

                socket.on('timeout', () => {
                    socket.destroy();
                    reject(new Error('Connection timed out'));
                });

                socket.on('error', (err) => {
                    socket.destroy();
                    reject(err);
                });

                socket.connect(ftpConfig.port, ftpConfig.host);
            });

            results.tcp = {
                success: true,
                message: `Successfully established TCP connection to ${ftpConfig.host}:${ftpConfig.port}`
            };
        } catch (error) {
            results.tcp = {
                success: false,
                message: `Failed to establish TCP connection to ${ftpConfig.host}:${ftpConfig.port}: ${error.message}`,
                error: interpretConnectionError(error)
            };
            console.error(results.tcp.message);

            // Early return if TCP fails - can't proceed without TCP connection
            results.overall = {
                success: false,
                message: 'TCP connection failed - cannot connect to MN-ITS server',
                details: results
            };
            return results;
        }

        // 3. Authentication test
        const sftp = new SftpClient();
        try {
            await sftp.connect(ftpConfig);
            results.authentication = {
                success: true,
                message: 'Successfully authenticated with MN-ITS SFTP server'
            };
            // 4. Folder access test
            try {
                // Check if we can list the root directory
                const rootList = await sftp.list('/');

                // Try to access the required directories
                let inboundFound = false;
                let x12TransactionsFound = false;

                for (const item of rootList) {
                    if (item.name === 'Inbound Transactions') {
                        inboundFound = true;

                        try {
                            const inboundList = await sftp.list('/Inbound Transactions');
                            for (const inboundItem of inboundList) {
                                if (inboundItem.name === 'X12_Transactions') {
                                    x12TransactionsFound = true;
                                    break;
                                }
                            }
                        } catch (folderError) {
                            // Couldn't access Inbound Transactions folder
                        }

                        break;
                    }
                }

                if (inboundFound && x12TransactionsFound) {
                    results.folderAccess = {
                        success: true,
                        message: 'Successfully accessed required MN-ITS folders'
                    };
                } else {
                    results.folderAccess = {
                        success: false,
                        message: `Folder structure incomplete: ${inboundFound ? 'Found Inbound Transactions' : 'Missing Inbound Transactions'}, ${x12TransactionsFound ? 'Found X12_Transactions' : 'Missing X12_Transactions'}`,
                        error: {
                            detailedExplanation: 'The expected folder structure for MN-ITS submissions is not available or accessible to your account.',
                            possibleSolutions: [
                                'Contact MN-ITS support to verify your account has the correct folder structure',
                                'Ensure your account registration is complete and properly set up for batch submissions',
                                'Check if you need to complete testing before production access is granted'
                            ]
                        }
                    };
                }
            } catch (folderError) {
                results.folderAccess = {
                    success: false,
                    message: `Failed to access MN-ITS folders: ${folderError.message}`,
                    error: interpretConnectionError(folderError)
                };
            }
        } catch (authError) {
            results.authentication = {
                success: false,
                message: `Authentication failed: ${authError.message}`,
                error: interpretConnectionError(authError)
            };
            console.error(results.authentication.message);
        } finally {
            sftp.end();
        }

        // Overall assessment
        if (results.dns.success && results.tcp.success && results.authentication.success && results.folderAccess?.success) {
            results.overall = {
                success: true,
                message: 'All MN-ITS connection tests passed successfully',
                details: results
            };
        } else if (results.dns.success && results.tcp.success && results.authentication.success) {
            results.overall = {
                success: false,
                message: 'Authentication successful but folder access failed',
                details: results
            };
        } else if (results.dns.success && results.tcp.success) {
            results.overall = {
                success: false,
                message: 'Network connection works but authentication failed',
                details: results
            };
        } else if (results.dns.success) {
            results.overall = {
                success: false,
                message: 'DNS resolution works but TCP connection failed',
                details: results
            };
        } else {
            results.overall = {
                success: false,
                message: 'DNS resolution failed',
                details: results
            };
        }

        return results;
    } catch (error) {
        console.error('Error during MN-ITS connection diagnosis:', error);
        return {
            success: false,
            message: `General error during diagnosis: ${error.message}`,
            error: interpretConnectionError(error),
            details: results
        };
    }
};

// Generate FileZilla connection instructions
export const getFileZillaInstructions = () => {
    return {
        title: "FileZilla Connection Instructions for MN-ITS SFTP",
        instructions: [
            "1. Download and install FileZilla from https://filezilla-project.org/",
            "2. Open FileZilla and go to File > Site Manager",
            "3. Click 'New Site' and name it 'MN-ITS SFTP'",
            "4. Enter the following settings:",
            "   - Protocol: SFTP - SSH File Transfer Protocol",
            "   - Host: secureftp.dhs.state.mn.us",
            "   - Port: 2222",
            "   - Logon Type: Normal",
            `   - User: ${MNITS_USERNAME}`,
            `   - Password: (Your MN-ITS password)`,
            "5. Click 'Connect' to establish connection",
            "6. Navigate to 'Inbound Transactions/X12_Transactions' folder to upload files",
            "7. Navigate to 'Outbound Transactions/Received' to check for responses",
            "8. Ensure files are named according to the convention: UMPI_TransactionID_Date.dat",
            "   Example: A634637200_837P_20230523.dat"
        ],
        notes: [
            "- The connection may take a few moments to establish",
            "- If you receive a 'Unknown host key' prompt, you can accept it after verifying with MN-ITS",
            "- Remember that folder names are case sensitive",
            "- Passwords expire every 3 months per MN-ITS policy",
            "- For help, contact MN-ITS support at 651-431-2700"
        ],
        troubleshooting: [
            "If you encounter connection issues:",
            "1. Verify your network allows outbound connections on port 2222",
            "2. Ensure you're using the exact username format provided by MN-ITS",
            "3. Check if your password has expired (they expire every 3 months)",
            "4. Try connecting from a different network if possible",
            "5. Contact MN-ITS support for assistance if problems persist"
        ]
    };
};

const generateControlNumber = () => {
    return Math.floor(100000000 + Math.random() * 900000000).toString();
};

const generateProperFilename = () => {
    const npi = 'A634637200'; // Use UMPI format as per docs
    const transactionType = '837P';  // Use transaction ID
    const today = new Date();
    const date = today.toISOString().split('T')[0].replace(/-/g, '')

    return `${npi}_${transactionType}_${date}.dat`;
};

const createMnItsDatFile = async (bill) => {
    try {
        bill.controlNumber = generateControlNumber();

        const { ediContent } = await generateEDI(bill);

        const fileName = generateProperFilename();
        const filePath = path.join(mnItsBatchDir, fileName);

        // Write EDI content to file
        await fs.promises.writeFile(filePath, ediContent);

        return { fileName, filePath, ediContent };
    } catch (error) {
        console.error('Error creating MN-ITS DAT file:', error);
        throw error;
    }
};

// Add VPN detection function
const checkVpnConnection = async () => {
    try {
        // Test if we can reach MN-ITS web interface (which works with VPN)
        const response = await fetch('https://mn-its.dhs.state.mn.us/gatewayweb/login', {
            method: 'HEAD',
            timeout: 10000
        });

        return {
            success: response.ok,
            message: response.ok ? 'VPN connection detected - can reach MN-ITS web interface' : 'Cannot reach MN-ITS web interface'
        };
    } catch (error) {
        return {
            success: false,
            message: 'Cannot reach MN-ITS web interface - VPN may not be connected',
            error: error.message
        };
    }
};

// Update the uploadFileToMnItsSftp function to check VPN first
export const uploadFileToMnItsSftp = async (filePath, fileName) => {
    // First check if VPN is connected
    const vpnCheck = await checkVpnConnection();

    if (!vpnCheck.success) {
        console.error('[MN-ITS UPLOAD] VPN check failed:', vpnCheck.message);
        return {
            success: false,
            message: 'VPN connection required for MN-ITS SFTP access',
            error: vpnCheck.message,
            troubleshooting: [
                '1. Connect to your VPN',
                '2. Verify you can access https://mn-its.dhs.state.mn.us/gatewayweb/login in browser',
                '3. Try the upload again after VPN is connected'
            ]
        };
    }
    const sftp = new SftpClient();

    try {
        // Connect to SFTP server with extended timeout for VPN
        const extendedConfig = {
            ...ftpConfig,
            readyTimeout: 120000, // 2 minutes for VPN connections
            keepaliveInterval: 60000 // 1 minute keepalive
        };

        await sftp.connect(extendedConfig);
        // Navigate to the correct directory for EDI uploads
        // Try multiple possible directories
        const possibleDirs = ['/Inbound Transactions/X12_Transactions', '/incoming', '/upload', '/'];
        let uploadDir = '/';

        for (const dir of possibleDirs) {
            try {
                await sftp.cd(dir);
                uploadDir = dir;
                break;
            } catch (dirError) {
            }
        }

        // Upload the file
        const remotePath = uploadDir === '/' ? fileName : `${uploadDir}/${fileName}`;
        await sftp.put(filePath, remotePath);
        // Verify the upload
        const fileExists = await sftp.exists(remotePath);
        if (fileExists) {
            return {
                success: true,
                message: `File uploaded successfully to MN-ITS: ${fileName}`,
                remotePath,
                uploadDirectory: uploadDir
            };
        } else {
            throw new Error('File upload verification failed');
        }

    } catch (error) {
        console.error('[MN-ITS UPLOAD] Upload failed:', error);
        const errorDetails = interpretConnectionError(error);

        return {
            success: false,
            message: `Failed to upload to MN-ITS: ${error.message}`,
            errorDetails,
            troubleshooting: [
                'Ensure VPN is connected and stable',
                'Verify MN-ITS credentials are correct',
                'Check if your account has proper permissions',
                ...errorDetails.possibleSolutions
            ]
        };
    } finally {
        try {
            await sftp.end();
        } catch (closeError) {
            console.error('[MN-ITS UPLOAD] Error closing SFTP connection:', closeError);
        }
    }
};

const checkTransactionResponsesViaSftp = async () => {
    const sftp = new SftpClient();
    try {
        await sftp.connect(ftpConfig);

        const remotePath = 'Outbound Transactions/Received';
        const fileList = await sftp.list(remotePath);
        const transactions = [];

        for (const item of fileList) {
            const fileName = item.name;

            let status = 'unknown';
            if (fileName.includes('_999_')) {
                status = 'success';
            } else if (fileName.includes('_999P_')) {
                status = 'partial';
            } else if (fileName.includes('_277_') || fileName.includes('TA1')) {
                status = 'pending';
            } else if (fileName.includes('ACCEPTANCE_LETTER')) {
                status = 'accepted';
            } else if (fileName.includes('_N12R_')) {
                status = 'pharmacy_response';
            } else if (fileName.includes('_835_')) {
                status = 'remittance';
            }

            transactions.push({
                fileName,
                date: item.modifyTime ? new Date(item.modifyTime).toISOString() : new Date().toISOString(),
                status
            });
        }

        return {
            success: true,
            message: 'Successfully retrieved MN-ITS transaction status',
            transactions
        };
    } catch (error) {
        console.error('SFTP error when checking responses:', error);
        const errorDetails = interpretConnectionError(error);

        return {
            success: false,
            message: `SFTP connection error when checking responses: ${error.message}`,
            error: error,
            errorDetails: errorDetails
        };
    } finally {
        sftp.end();
    }
};

export const processAndUploadMnItsEDIs = async () => {
    try {
        // Find all government insurance bills that need to be uploaded
        const governmentBills = await Bill.find({
            isGovernmentInsurance: true,
            batchStatus: { $in: ['ready', 'pending'] },
            ediContent: { $exists: true, $ne: '' }
        }).populate('tenantId hcms.hcmId');

        if (governmentBills.length === 0) {
            return {
                success: true,
                message: 'No bills to process',
                processed: 0
            };
        }
        const results = [];
        const uploadedFiles = [];

        for (const bill of governmentBills) {
            try {
                // Regenerate EDI to ensure it's current
                const { generateEDI } = await import('../tasks/generateEdiFile.js');
                const { ediContent, ediFileName } = await generateEDI(bill);

                // Update bill with fresh EDI content
                bill.ediContent = ediContent;
                bill.ediFileName = ediFileName;
                bill.lastEdiUpdate = new Date();

                // Create temporary file for upload
                const tempFilePath = path.join(mnItsBatchDir, ediFileName);
                await fs.promises.writeFile(tempFilePath, ediContent);

                // Upload to MN-ITS SFTP
                const uploadResult = await uploadFileToMnItsSftp(tempFilePath, ediFileName);

                if (uploadResult.success) {
                    // Mark bill as uploaded
                    bill.batchStatus = 'uploaded';
                    bill.uploadedToMnIts = true;
                    bill.mnItsUploadDate = new Date();
                    uploadedFiles.push(ediFileName);

                    results.push({
                        billId: bill._id,
                        success: true,
                        fileName: ediFileName,
                        message: 'Uploaded successfully'
                    });
                } else {
                    bill.batchStatus = 'upload_failed';
                    bill.uploadError = uploadResult.message;

                    results.push({
                        billId: bill._id,
                        success: false,
                        fileName: ediFileName,
                        error: uploadResult.message
                    });
                }

                await bill.save();

                // Clean up temporary file
                try {
                    await fs.promises.unlink(tempFilePath);
                } catch (cleanupError) {
                    console.error(`[MN-ITS BATCH] Error cleaning up temp file: ${cleanupError}`);
                }

            } catch (billError) {
                console.error(`[MN-ITS BATCH] Error processing bill ${bill._id}:`, billError);
                results.push({
                    billId: bill._id,
                    success: false,
                    error: billError.message
                });
            }
        }

        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;
        return {
            success: true,
            message: `Processed ${governmentBills.length} bills: ${successCount} uploaded, ${failureCount} failed`,
            results,
            uploadedFiles,
            successCount,
            failureCount
        };

    } catch (error) {
        console.error('[MN-ITS BATCH] Error in processAndUploadMnItsEDIs:', error);
        return {
            success: false,
            message: error.message,
            error: error
        };
    }
};

export const testMnItsConnection = async () => {
    try {
        const testFileName = `A634637200_TEST_${Date.now()}.dat`;
        const testFilePath = path.join(mnItsBatchDir, testFileName);
        const testContent = 'This is a test file to verify MN-ITS production SFTP connection and upload permissions.';

        await fs.promises.writeFile(testFilePath, testContent);

        const result = await uploadFileToMnItsSftp(testFilePath, testFileName);

        fs.unlinkSync(testFilePath);

        return {
            success: result.success,
            message: result.success ?
                'Successfully connected to MN-ITS production SFTP and uploaded test file' :
                'Failed to connect to MN-ITS production SFTP or upload test file',
            details: result
        };
    } catch (error) {
        console.error('Error testing MN-ITS production SFTP connection:', error);
        const errorDetails = interpretConnectionError(error);

        return {
            success: false,
            message: 'Error testing MN-ITS production SFTP connection',
            error: error.message,
            errorDetails: errorDetails
        };
    }
};

export const checkMnItsFolderStructure = async () => {
    const sftp = new SftpClient();

    try {
        await sftp.connect(ftpConfig);

        const rootDirs = await sftp.list('/');
        let inboundFound = false;
        let outboundFound = false;

        for (const dir of rootDirs) {
            if (dir.name === 'Inbound Transactions') {
                inboundFound = true;
                const inboundDirs = await sftp.list('/Inbound Transactions');
                console.log('Inbound directories:', inboundDirs.map(d => d.name));
            }

            if (dir.name === 'Outbound Transactions') {
                outboundFound = true;
                const outboundDirs = await sftp.list('/Outbound Transactions');
            }
        }

        return {
            success: true,
            message: 'Successfully checked MN-ITS folder structure',
            folderStructure: {
                inboundFound,
                outboundFound
            }
        };
    } catch (error) {
        console.error('Error checking MN-ITS folder structure:', error);
        const errorDetails = interpretConnectionError(error);

        return {
            success: false,
            message: 'Error checking MN-ITS folder structure',
            error: error.message,
            errorDetails: errorDetails
        };
    } finally {
        sftp.end();
    }
};

export const scheduleMnItsOperations = () => {
    // Schedule daily upload at 11:30 PM (23:30)
    cron.schedule('30 23 * * *', async () => {
        try {
            const result = await processAndUploadMnItsEDIs();
        } catch (error) {
            console.error('[MN-ITS SCHEDULER] Daily upload failed:', error);
        }
    }, {
        timezone: 'America/Chicago' // Minnesota timezone
    });

    // Schedule response checking at 6:00 AM
    cron.schedule('0 6 * * *', async () => {
        try {
            const result = await checkTransactionResponsesViaSftp();
        } catch (error) {
            console.error('[MN-ITS SCHEDULER] Response check failed:', error);
        }
    }, {
        timezone: 'America/Chicago'
    });
};

export const testMnItsProductionConnection = async () => {
    try {
        const results = {
            sftp: null,
            folderStructure: null,
            browser: null
        };

        results.sftp = await testMnItsConnection();

        results.folderStructure = await checkMnItsFolderStructure();

        try {
            const browser = await puppeteer.launch({
                headless: "new",
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const page = await browser.newPage();

            await page.goto(MNITS_LOGIN_URL, { waitUntil: 'networkidle2' });
            // Check if login form is present
            const usernameSelector = 'input[name="username"]';
            const passwordSelector = 'input[name="password"]';

            await page.waitForSelector(usernameSelector);
            await page.waitForSelector(passwordSelector);
            await browser.close();

            results.browser = {
                success: true,
                message: 'Successfully connected to MN-ITS production login page'
            };
        } catch (error) {
            console.error('Error testing browser connection to MN-ITS production:', error);
            results.browser = {
                success: false,
                message: 'Error connecting to MN-ITS production login page',
                error: error.message,
                errorDetails: interpretConnectionError(error)
            };
        }

        results.diagnosis = await diagnoseMnItsConnection();

        return {
            success: results.diagnosis.overall.success || (results.sftp && results.sftp.success),
            message: 'MN-ITS production connection tests completed',
            results,
            fileZillaInstructions: getFileZillaInstructions()
        };
    } catch (error) {
        console.error('Error in comprehensive MN-ITS production test:', error);
        const errorDetails = interpretConnectionError(error);

        return {
            success: false,
            message: 'Error in comprehensive MN-ITS production test',
            error: error.message,
            errorDetails: errorDetails,
            fileZillaInstructions: getFileZillaInstructions()
        };
    }
};