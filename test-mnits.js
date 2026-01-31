import { testMnItsProductionConnection, diagnoseMnItsConnection } from './utils/mnitsUploader.js';
try {
    const result = await testMnItsProductionConnection();
    if (result.results?.diagnosis) {
        const diag = result.results.diagnosis;

        if (diag.dns?.message) console.log('  └─', diag.dns.message);

        if (diag.tcp?.message) console.log('  └─', diag.tcp.message);

        if (diag.authentication?.message) console.log('  └─', diag.authentication.message);

        if (diag.folderAccess?.message) console.log('  └─', diag.folderAccess.message);
    }

    if (result.results?.sftp) {
        
    }

    // Show troubleshooting if there are issues
    if (!result.success) {

        if (result.results?.diagnosis?.authentication?.error?.possibleSolutions) {
            result.results.diagnosis.authentication.error.possibleSolutions.forEach((solution, index) => {
            });
        }

        if (result.results?.diagnosis?.tcp?.error?.possibleSolutions) {
            result.results.diagnosis.tcp.error.possibleSolutions.forEach((solution, index) => {
            });
        }
    }

} catch (error) {
    console.error('❌ Error running connection test:', error.message);
    console.error('Stack trace:', error.stack);
} 