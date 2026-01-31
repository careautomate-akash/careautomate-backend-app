import socketManager from './socketManager';

/**
 * View a document using socket connection
 * @param {string} documentId - ID of the document to view
 * @returns {Promise<Object>} Promise resolving to document view data
 */
export const viewDocumentViaSocket = (documentId) => {
    return new Promise((resolve, reject) => {
        if (!documentId) {
            reject(new Error('Document ID is required'));
            return;
        }

        // Setup one-time listener for the document response
        const handleDocumentReady = (data) => {
            if (data.documentId === documentId && data.type === 'view') {
                // Remove listeners to avoid memory leaks
                socketManager.off('document_ready', handleDocumentReady);
                socketManager.off('document_error', handleDocumentError);

                if (data.success === false) {
                    reject(new Error(data.message || 'Failed to view document'));
                    return;
                }

                // If successful, open the URL in a new tab
                if (data.document && data.document.viewUrl) {
                    window.open(data.document.viewUrl, '_blank');
                    resolve(data);
                } else {
                    // Fallback to direct server endpoint if no URL is provided
                    const token = localStorage.getItem('token');
                    const directUrl = `/document/serve/${documentId}?token=${token}`;
                    window.open(directUrl, '_blank');
                    resolve({
                        success: true,
                        message: 'Opened document via direct server endpoint',
                        document: { id: documentId }
                    });
                }
            }
        };

        const handleDocumentError = (error) => {
            if (error.documentId === documentId) {
                // Remove listeners to avoid memory leaks
                socketManager.off('document_ready', handleDocumentReady);
                socketManager.off('document_error', handleDocumentError);

                // Try the fallback method
                try {
                    const token = localStorage.getItem('token');
                    const directUrl = `/document/serve/${documentId}?token=${token}`;
                    window.open(directUrl, '_blank');
                    resolve({
                        success: true,
                        message: 'Opened document via direct server endpoint',
                        document: { id: documentId }
                    });
                } catch (err) {
                    reject(error);
                }
            }
        };

        // Set up the listeners
        socketManager.on('document_ready', handleDocumentReady);
        socketManager.on('document_error', handleDocumentError);

        // Request the document
        socketManager.requestDocumentView(documentId);

        // Set a timeout for the request
        setTimeout(() => {
            socketManager.off('document_ready', handleDocumentReady);
            socketManager.off('document_error', handleDocumentError);

            // Try the fallback method
            try {
                const token = localStorage.getItem('token');
                const directUrl = `/document/serve/${documentId}?token=${token}`;
                window.open(directUrl, '_blank');
                resolve({
                    success: true,
                    message: 'Opened document via direct server endpoint (after timeout)',
                    document: { id: documentId }
                });
            } catch (err) {
                reject(new Error('Request timed out and fallback failed'));
            }
        }, 5000); // 5 second timeout
    });
};

/**
 * Download a document using socket connection
 * @param {string} documentId - ID of the document to download
 * @returns {Promise<Object>} Promise resolving to document download data
 */
export const downloadDocumentViaSocket = (documentId) => {
    return new Promise((resolve, reject) => {
        if (!documentId) {
            reject(new Error('Document ID is required'));
            return;
        }

        // Setup one-time listener for the document response
        const handleDocumentReady = (data) => {
            if (data.documentId === documentId && data.type === 'download') {
                // Remove listeners to avoid memory leaks
                socketManager.off('document_ready', handleDocumentReady);
                socketManager.off('document_error', handleDocumentError);

                if (data.success === false) {
                    reject(new Error(data.message || 'Failed to download document'));
                    return;
                }

                // If successful, open the URL in a new tab
                if (data.document && data.document.downloadUrl) {
                    window.open(data.document.downloadUrl, '_blank');
                    resolve(data);
                } else {
                    // Fallback to direct server endpoint if no URL is provided
                    const token = localStorage.getItem('token');
                    const directUrl = `/document/download-direct/${documentId}?token=${token}`;
                    window.open(directUrl, '_blank');
                    resolve({
                        success: true,
                        message: 'Downloaded document via direct server endpoint',
                        document: { id: documentId }
                    });
                }
            }
        };

        const handleDocumentError = (error) => {
            if (error.documentId === documentId) {
                // Remove listeners to avoid memory leaks
                socketManager.off('document_ready', handleDocumentReady);
                socketManager.off('document_error', handleDocumentError);

                // Try the fallback method
                try {
                    const token = localStorage.getItem('token');
                    const directUrl = `/document/download-direct/${documentId}?token=${token}`;
                    window.open(directUrl, '_blank');
                    resolve({
                        success: true,
                        message: 'Downloaded document via direct server endpoint',
                        document: { id: documentId }
                    });
                } catch (err) {
                    reject(error);
                }
            }
        };

        // Set up the listeners
        socketManager.on('document_ready', handleDocumentReady);
        socketManager.on('document_error', handleDocumentError);

        // Request the document
        socketManager.requestDocumentDownload(documentId);

        // Set a timeout for the request
        setTimeout(() => {
            socketManager.off('document_ready', handleDocumentReady);
            socketManager.off('document_error', handleDocumentError);

            // Try the fallback method
            try {
                const token = localStorage.getItem('token');
                const directUrl = `/document/download-direct/${documentId}?token=${token}`;
                window.open(directUrl, '_blank');
                resolve({
                    success: true,
                    message: 'Downloaded document via direct server endpoint (after timeout)',
                    document: { id: documentId }
                });
            } catch (err) {
                reject(new Error('Request timed out and fallback failed'));
            }
        }, 5000); // 5 second timeout
    });
};

export default {
    viewDocumentViaSocket,
    downloadDocumentViaSocket
}; 