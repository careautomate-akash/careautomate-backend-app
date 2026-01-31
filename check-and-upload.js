import { processAndUploadMnItsEDIs, testMnItsConnection } from './utils/mnitsUploader.js';
import fetch from 'node-fetch';

// Check if VPN is connected by testing MN-ITS web interface
const checkVpnConnection = async () => {
    try {
        const response = await fetch('https://mn-its.dhs.state.mn.us/gatewayweb/login', {
            method: 'HEAD',
            timeout: 10000
        });

        if (response.ok) {
            return true;
        } else {
            return false;
        }
    } catch (error) {
        return false;
    }
};

// Main function to check connection and upload
const checkAndUpload = async () => {
    // Step 1: Check VPN
    const vpnConnected = await checkVpnConnection();

    if (!vpnConnected) {
               return;
    }

    // Step 2: Test SFTP connection
    try {
        const connectionTest = await testMnItsConnection();

        if (connectionTest.success) {
        } else {
        }
    } catch (error) {
    }

    // Step 3: Process and upload EDI files
    try {
        const uploadResult = await processAndUploadMnItsEDIs();
        if (uploadResult.successCount) {
        }

        if (uploadResult.failureCount) {
        }

        if (uploadResult.uploadedFiles && uploadResult.uploadedFiles.length > 0) {
            uploadResult.uploadedFiles.forEach(file => {
            });
        }

        if (uploadResult.results) {
            uploadResult.results.forEach((result, index) => {
            });
        }

    } catch (error) {
    }

};

// Run the check and upload
checkAndUpload().catch(console.error); 