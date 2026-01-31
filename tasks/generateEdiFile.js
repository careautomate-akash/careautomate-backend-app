import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getProcedureCodeAndModifier as mapProcedureCode } from '../utils/procedureCodeMapper.js';
// Get the current directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const generateEDI = async (bill) => {
    try {
        if (!bill) {
            throw new Error('Bill object is required');
        }

        bill.patientDetails = bill.patientDetails || {};
        bill.insurance = bill.insurance || {};
        bill.company = bill.company || {};
        bill.company.address = bill.company.address || {};
        bill.serviceLine = bill.serviceLine || {};
        bill.bill = bill.bill || {};
        bill.bill.claimInformation = bill.bill.claimInformation || {};
        bill.hcms = bill.hcms || [];

        const controlNumber = bill.controlNumber || Math.floor(100000000 + Math.random() * 900000000).toString();
        const companyNPI = bill.companyNPI || '000000';

        const birthDateISO = bill.patientDetails.birthDate || new Date().toISOString();
        const currentDate = new Date();
        const formattedDate = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        const formattedTime = currentDate.toTimeString().slice(0, 2) + currentDate.toTimeString().slice(3, 5);

        const birthDate = new Date(birthDateISO);
        const formattedBirthDate = !isNaN(birthDate.getTime()) ?
            birthDate.toISOString().slice(0, 10).replace(/-/g, '') :
            currentDate.toISOString().slice(0, 10).replace(/-/g, '');

        let serviceDate;
        try {
            serviceDate = new Date(bill.serviceLine.serviceDate || currentDate);
            if (isNaN(serviceDate.getTime())) {
                serviceDate = currentDate;
            }
        } catch (e) {
            serviceDate = currentDate;
        }
        const formattedServiceDate = serviceDate.toISOString().slice(0, 10).replace(/-/g, '');

        let patientBirthDate;
        try {
            const birthDate = new Date(bill.patientDetails.birthDate || currentDate);
            patientBirthDate = !isNaN(birthDate.getTime()) ?
                birthDate.toISOString().slice(0, 10).replace(/-/g, '') :
                currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        } catch (e) {
            patientBirthDate = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        }

        const insuranceName = (bill.insurance?.name || '').toLowerCase();
        const isGovernmentInsurance =
            insuranceName === 'medical assistance' ||
            insuranceName === 'medicaid mn';

        let senderId, receiverId, payerName, ourCompanyName, payerId, claimId;

        if (isGovernmentInsurance) {
            senderId = 'A634637200';
            receiverId = '41-1674742';
            payerName = 'MINNESOTA DEPT OF HUMAN SERVICES';
            ourCompanyName = 'CIRCINNO SOFTWARES INC';
            payerId = receiverId;
            claimId = bill.claimId || bill.patientDetails.pmiNumber || `${Date.now().toString().slice(-8)}`;
        } else {
            senderId = bill.company.umpi || companyNPI;
            receiverId = '000000';
            payerName = 'Waystar';
            ourCompanyName = bill.company.name || 'HEALTHCARE PROVIDER';
            payerId = bill.insurance.payerId || '55413';
            claimId = bill.claimId || `${Date.now().toString().slice(-8)}`;
        }

        const interchangeHeaderSegment = `ISA*00*          *00*          *ZZ*${senderId.padEnd(15)}*30*${receiverId.padEnd(15)}*${formattedDate.slice(2)}*${formattedTime}*^*00501*${controlNumber}*1*P*:~`;
        const functionalGroupHeaderSegment = `GS*HC*${senderId}*${receiverId}*${formattedDate}*${formattedTime}*${controlNumber}*X*005010X222A1~`;
        const transactionSetHeaderSegment = `ST*837*0001*005010X222A1~`;
        const beginningOfHierarchicalTransactionSegment = `BHT*0019*00*${controlNumber}*${formattedDate}*${formattedTime}*CH~`;
        const submitterInformationSegment = `NM1*41*2*${isGovernmentInsurance ? ourCompanyName : (bill.company.name || 'HEALTHCARE PROVIDER')}*****46*${senderId}~`;
        const receiverInformationSegment = `NM1*40*2*${payerName}*****46*${receiverId}~`;
        const subscriberHierarchicalLevelSegment = `HL*1**20*1~`;
        const taxonomyCode = bill.taxonomyCode ? `PRV*BI*PXC*${bill.taxonomyCode}~` : '';
        const insuranceTypeCode = isGovernmentInsurance ? 'MA' : 'CI';

        const companyName = bill.company?.name || 'HEALTHCARE PROVIDER';
        const companyAddr1 = bill.company?.address?.addressLine1 || '';
        const companyAddr2 = bill.company?.address?.addressLine2 || '';
        const companyCity = bill.company?.address?.city || '';
        const companyState = bill.company?.address?.state || '';
        const companyTaxId = bill.company?.taxId || '000000000';
        const finalCompanyAddr1 = companyAddr1 || 'ADDRESS NOT PROVIDED';

        let companyZipcode = '000000000';
        if (bill.company?.address?.zipcode) {
            if (bill.company.address.zipcode.length === 9) {
                companyZipcode = bill.company.address.zipcode;
            } else {
                companyZipcode = bill.company.address.zipcode.padStart(5, '0').padEnd(9, '0');
            }
        }

        const claimInitialInfo = `NM1*85*2*${companyName}*****XX*${companyNPI}~N3*${finalCompanyAddr1}*${companyAddr2}~N4*${companyCity}*${companyState}*${companyZipcode}~REF*EI*${companyTaxId}~HL*2*1*22*0~SBR*P*18*******${insuranceTypeCode}~`;
        const patientDetailsSegment = `NM1*IL*1*${bill.patientDetails?.lastName || 'DOE'}*${bill.patientDetails?.firstName || 'JOHN'}****MI*${bill.insurance?.identifier || '0000000000'}~`;

        const patientZipcode = bill.patientDetails?.address?.zipcode || '000000000';
        const patientAddr1 = bill.patientDetails?.address?.addressLine1 || 'ADDRESS NOT PROVIDED';
        const patientAddr2 = bill.patientDetails?.address?.addressLine2 || '';
        const patientCity = bill.patientDetails?.address?.city || '';
        const patientState = bill.patientDetails?.address?.state || '';
        const finalPatientAddr1 = patientAddr1 || 'ADDRESS NOT PROVIDED';

        const gender = (bill.patientDetails.gender === 'Male' || bill.patientDetails.gender === 'M') ? 'M' : 'F';
        const insuranceDetails = `N3*${finalPatientAddr1}*${patientAddr2}~N4*${patientCity}*${patientState}*${patientZipcode}~DMG*D8*${patientBirthDate}*${gender}~`;

        let insuranceCompanyDetails;
        if (isGovernmentInsurance) {
            insuranceCompanyDetails = `NM1*PR*2*${payerName}*****PI*${payerId}~N3*PO BOX 52~N4*MINNEAPOLIS*MN*55440~`;
        } else {
            const getPayerId = (insuranceName) => {
                if (!insuranceName) return '55413';

                const insuranceMap = {
                    'healthpartners': 'sx009',
                    'hennepinhealth': '60058',
                    'ucareofminnesota': '55413',
                    'primewest': '61604',
                    'medica': '94265',
                    'bcbs': 'z96439'
                };

                const normalizedName = insuranceName.toLowerCase().replace(/\s+/g, '');
                return insuranceMap[normalizedName] || '55413';
            };

            const insurancePayerId = getPayerId(bill.insurance?.name || '');
            insuranceCompanyDetails = `NM1*PR*2*${bill.insurance?.name || 'INSURANCE PROVIDER'}*****PI*${insurancePayerId}~REF*G2*${senderId}~`;
        }

        const claimAmount = parseFloat(bill.bill?.claimInformation?.lineItemChargeAmount ||
            bill.serviceLine?.lineItemChargeAmount || 0).toFixed(2);
        const claimInformationSegment = `CLM*${claimId}*${claimAmount}***11:B:1*N*A*Y*Y*P~`;

        let diagnosisCode = 'Z99.0';
        if (bill.patientDetails?.diagnosisCode) {
            const diagnosisParts = bill.patientDetails.diagnosisCode.split(' ');
            if (diagnosisParts.length > 0 && diagnosisParts[0]) {
                diagnosisCode = diagnosisParts[0];
            }
        }

        const patientInfo = `REF*EA*${claimId}~HI*ABK:${diagnosisCode}~`;

        let companyInfo;
        if (isGovernmentInsurance) {
            const hcmName = bill.hcms && bill.hcms.length > 0 && bill.hcms[0]?.name ?
                bill.hcms[0].name : 'PROVIDER NAME';
            companyInfo = `NM1*82*1*${hcmName}*Z~LX*1~`;
        } else {
            companyInfo = `NM1*82*2*${companyName}*****XX*ATYPICAL~REF*G2*${senderId}~LX*1~`;
        }

        const { code: singleProcedureCode, modifiers: singleModifiers, displayName: singleDescription } = mapProcedureCode(
            bill.serviceLine.serviceType || bill.serviceType,
            bill.serviceLine.methodOfContact || bill.methodOfContact
        );

        if (!singleProcedureCode) {
            throw new Error(`Unable to map procedure code for service type: ${bill.serviceLine.serviceType || bill.serviceType}`);
        }

        const lineItemChargeAmount = parseFloat(bill.serviceLine.lineItemChargeAmount || 0).toFixed(2);
        const serviceUnitCount = bill.serviceLine.serviceUnitCount || 1;

        const singleModifierString = singleModifiers && Array.isArray(singleModifiers) && singleModifiers.length > 0
            ? ':' + singleModifiers.join(':') : '';

        const serviceLineDetailsSegment = `SV1*HC:${singleProcedureCode}${singleModifierString}::::${singleDescription}*${lineItemChargeAmount}*UN*${serviceUnitCount}***1~`;
        const dateOfServiceSegment = `DTP*472*D8*${formattedServiceDate}~`;
        const finalPMiNum = `REF*6R*${claimId}~`;

        let transactionAndInterchangeEndSegment = `SE*PLACEHOLDER*0001~GE*1*${controlNumber}~IEA*1*${controlNumber}~`;

        const ediContent = [
            interchangeHeaderSegment,
            functionalGroupHeaderSegment,
            transactionSetHeaderSegment,
            beginningOfHierarchicalTransactionSegment,
            submitterInformationSegment,
            receiverInformationSegment,
            subscriberHierarchicalLevelSegment,
            taxonomyCode,
            claimInitialInfo,
            patientDetailsSegment,
            insuranceDetails,
            insuranceCompanyDetails,
            claimInformationSegment,
            patientInfo,
            companyInfo,
            serviceLineDetailsSegment,
            dateOfServiceSegment,
            finalPMiNum,
            transactionAndInterchangeEndSegment,
        ].filter(segment => segment !== '').join('');

        const segmentCount = ediContent.split('~').length + 1;
        transactionAndInterchangeEndSegment = transactionAndInterchangeEndSegment.replace('PLACEHOLDER', segmentCount);
        const finalEdiContent = ediContent.replace(/SE\*PLACEHOLDER\*0001~GE\*1\*.*~IEA\*1\*.*~$/, transactionAndInterchangeEndSegment);

        const ediFilesDir = path.join(__dirname, '../ediFiles');
        if (!fs.existsSync(ediFilesDir)) {
            fs.mkdirSync(ediFilesDir, { recursive: true });
        }

        bill.isGovernmentInsurance = isGovernmentInsurance;
        const companyNameForFile = (bill.company?.name || 'HEALTHCARE_PROVIDER').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
        const ediFileName = `${companyNPI}_837P_${formattedDate}_${formattedTime}_${companyNameForFile}.txt`;

        bill.ediContent = finalEdiContent;
        bill.ediFileName = ediFileName;

        return { ediContent: finalEdiContent, ediFileName };
    } catch (error) {
        return {
            ediContent: '',
            ediFileName: `fallback_${Date.now()}_error.dat`,
            error: error.message
        };
    }
};

// Import the centralized procedure code mapper
import { getProcedureCodeAndModifier } from '../utils/procedureCodeMapper.js';

export const generateBatchEDI = async (bills) => {
    try {
        if (!bills || !Array.isArray(bills) || bills.length === 0) {
            throw new Error('No bills provided for batch processing');
        }

        const currentDate = new Date();
        const formattedDate = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        const formattedTime = currentDate.toTimeString().slice(0, 2) + currentDate.toTimeString().slice(3, 5);

        // Use the first bill's control number for the batch
        const controlNumber = bills[0].controlNumber;

        // Group bills by insurance type
        const govBills = bills.filter(bill =>
            bill.insurance.name?.toLowerCase() === 'medical assistance' ||
            bill.insurance.name?.toLowerCase() === 'medicaid mn'
        );

        const commBills = bills.filter(bill =>
            !(bill.insurance.name?.toLowerCase() === 'medical assistance' ||
                bill.insurance.name?.toLowerCase() === 'medicaid mn')
        );

        // Generate separate batch files for government and commercial insurance
        const results = [];

        if (govBills.length > 0) {
            const govEdiContent = await createBatchContent(govBills, controlNumber, true, formattedDate, formattedTime);
            const fileDescription = 'gov_trans';
            const ediFileName = `A634637200_837P_${formattedDate}_${fileDescription}.dat`;
            results.push({ ediContent: govEdiContent, ediFileName, isGovernmentInsurance: true });
        }

        if (commBills.length > 0) {
            const commEdiContent = await createBatchContent(commBills, controlNumber, false, formattedDate, formattedTime);
            const fileDescription = 'priv_trans';
            const ediFileName = `A634637200_837P_${formattedDate}_${fileDescription}.dat`;
            results.push({ ediContent: commEdiContent, ediFileName, isGovernmentInsurance: false });
        }

        // Ensure the ediFiles directory exists
        const ediFilesDir = path.join(__dirname, '../ediFiles');
        if (!fs.existsSync(ediFilesDir)) {
            fs.mkdirSync(ediFilesDir, { recursive: true });
        }

        return results;
    } catch (error) {
        console.error('Error generating batch EDI files:', error);
        throw error;
    }
};

export const generateMultiHCMEDI = async (bill) => {
    try {
        if (!bill) {
            throw new Error('Bill object is required');
        }

        bill.patientDetails = bill.patientDetails || {};
        bill.insurance = bill.insurance || {};
        bill.company = bill.company || {};
        bill.company.address = bill.company.address || {};
        bill.serviceLine = bill.serviceLine || {};
        bill.bill = bill.bill || {};
        bill.bill.claimInformation = bill.bill.claimInformation || {};
        bill.hcms = bill.hcms || [];

        const controlNumber = bill.controlNumber || Math.floor(100000000 + Math.random() * 900000000).toString();
        const companyNPI = bill.companyNPI || '000000';
        const currentDate = new Date();
        const formattedDate = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        const formattedTime = currentDate.toTimeString().slice(0, 2) + currentDate.toTimeString().slice(3, 5);

        const insuranceName = (bill.insurance?.name || '').toLowerCase();
        const isGovernmentInsurance = insuranceName === 'medical assistance' || insuranceName === 'medicaid mn';

        let senderId, receiverId, payerName, ourCompanyName, payerId, claimId;

        if (isGovernmentInsurance) {
            senderId = 'A634637200';
            receiverId = '41-1674742';
            payerName = 'MINNESOTA DEPT OF HUMAN SERVICES';
            ourCompanyName = 'CIRCINNO SOFTWARES INC';
            payerId = receiverId;
            claimId = bill.claimId || bill.patientDetails.pmiNumber || `${Date.now().toString().slice(-8)}`;
        } else {
            senderId = bill.company.umpi || companyNPI;
            receiverId = '000000';
            payerName = 'Waystar';
            ourCompanyName = bill.company.name || 'HEALTHCARE PROVIDER';
            payerId = bill.insurance.payerId || '55413';
            claimId = bill.claimId || `${Date.now().toString().slice(-8)}`;
        }

        const interchangeHeaderSegment = `ISA*00*          *00*          *ZZ*${senderId.padEnd(15)}*30*${receiverId.padEnd(15)}*${formattedDate.slice(2)}*${formattedTime}*^*00501*${controlNumber}*1*P*:~`;
        const functionalGroupHeaderSegment = `GS*HC*${senderId}*${receiverId}*${formattedDate}*${formattedTime}*${controlNumber}*X*005010X222A1~`;
        const transactionSetHeaderSegment = `ST*837*0001*005010X222A1~`;
        const beginningOfHierarchicalTransactionSegment = `BHT*0019*00*${controlNumber}*${formattedDate}*${formattedTime}*CH~`;
        const submitterInformationSegment = `NM1*41*2*${isGovernmentInsurance ? ourCompanyName : (bill.company.name || 'HEALTHCARE PROVIDER')}*****46*${senderId}~`;
        const receiverInformationSegment = `NM1*40*2*${payerName}*****46*${receiverId}~`;
        const subscriberHierarchicalLevelSegment = `HL*1**20*1~`;
        const taxonomyCode = bill.taxonomyCode ? `PRV*BI*PXC*${bill.taxonomyCode}~` : '';

        const insuranceTypeCode = isGovernmentInsurance ? 'MA' : 'CI';
        const companyName = bill.company?.name || 'HEALTHCARE PROVIDER';
        const companyAddr1 = bill.company?.address?.addressLine1 || 'ADDRESS NOT PROVIDED';
        const companyAddr2 = bill.company?.address?.addressLine2 || '';
        const companyCity = bill.company?.address?.city || '';
        const companyState = bill.company?.address?.state || '';
        const companyTaxId = bill.company?.taxId || '000000000';

        let companyZipcode = '000000000';
        if (bill.company?.address?.zipcode) {
            if (bill.company.address.zipcode.length === 9) {
                companyZipcode = bill.company.address.zipcode;
            } else {
                companyZipcode = bill.company.address.zipcode.padStart(5, '0').padEnd(9, '0');
            }
        }

        const claimInitialInfo = `NM1*85*2*${companyName}*****XX*${companyNPI}~N3*${companyAddr1}*${companyAddr2}~N4*${companyCity}*${companyState}*${companyZipcode}~REF*EI*${companyTaxId}~HL*2*1*22*0~SBR*P*18*******${insuranceTypeCode}~`;

        const patientDetailsSegment = `NM1*IL*1*${bill.patientDetails?.lastName || 'DOE'}*${bill.patientDetails?.firstName || 'JOHN'}****MI*${bill.insurance?.identifier || '0000000000'}~`;

        const patientZipcode = bill.patientDetails?.address?.zipcode || '000000000';
        const patientAddr1 = bill.patientDetails?.address?.addressLine1 || 'ADDRESS NOT PROVIDED';
        const patientAddr2 = bill.patientDetails?.address?.addressLine2 || '';
        const patientCity = bill.patientDetails?.address?.city || '';
        const patientState = bill.patientDetails?.address?.state || '';

        let patientBirthDate;
        try {
            const birthDate = new Date(bill.patientDetails.birthDate || currentDate);
            patientBirthDate = !isNaN(birthDate.getTime()) ?
                birthDate.toISOString().slice(0, 10).replace(/-/g, '') :
                currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        } catch (e) {
            patientBirthDate = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        }

        const gender = (bill.patientDetails.gender === 'Male' || bill.patientDetails.gender === 'M') ? 'M' : 'F';
        const insuranceDetails = `N3*${patientAddr1}*${patientAddr2}~N4*${patientCity}*${patientState}*${patientZipcode}~DMG*D8*${patientBirthDate}*${gender}~`;

        let insuranceCompanyDetails;
        if (isGovernmentInsurance) {
            insuranceCompanyDetails = `NM1*PR*2*${payerName}*****PI*${payerId}~N3*PO BOX 52~N4*MINNEAPOLIS*MN*55440~`;
        } else {
            const getPayerId = (insuranceName) => {
                if (!insuranceName) return '55413';
                const insuranceMap = {
                    'healthpartners': 'sx009',
                    'hennepinhealth': '60058',
                    'ucareofminnesota': '55413',
                    'primewest': '61604',
                    'medica': '94265',
                    'bcbs': 'z96439'
                };
                const normalizedName = insuranceName.toLowerCase().replace(/\s+/g, '');
                return insuranceMap[normalizedName] || '55413'; // Default to UCare if not found
            };

            const insurancePayerId = getPayerId(bill.insurance?.name || '');
            insuranceCompanyDetails = `NM1*PR*2*${bill.insurance?.name || 'INSURANCE PROVIDER'}*****PI*${insurancePayerId}~REF*G2*${senderId}~`;
        }

        const claimAmount = parseFloat(bill.serviceLine?.lineItemChargeAmount || 0).toFixed(2);
        const claimInformationSegment = `CLM*${claimId}*${claimAmount}***11:B:1*N*A*Y*Y*P~`;

        let diagnosisCode = 'Z99.0';
        if (bill.patientDetails?.diagnosisCode) {
            const diagnosisParts = bill.patientDetails.diagnosisCode.split(' ');
            if (diagnosisParts.length > 0 && diagnosisParts[0]) {
                diagnosisCode = diagnosisParts[0];
            }
        }

        const patientInfo = `REF*EA*${claimId}~HI*ABK:${diagnosisCode}~`;

        let companyInfo;
        if (isGovernmentInsurance) {
            const hcmName = bill.hcms && bill.hcms.length > 0 && bill.hcms[0]?.name ?
                bill.hcms[0].name : 'PROVIDER NAME';
            companyInfo = `NM1*82*1*${hcmName}*Z~`;
        } else {
            companyInfo = `NM1*82*2*${companyName}*****XX*ATYPICAL~REF*G2*${senderId}~`;
        }

        let serviceLineSegments = '';
        let lineNumber = 1;

        const groupedServices = {};
        bill.hcms.forEach(hcm => {
            const serviceKey = `${hcm.serviceDate}_${bill.serviceType}`;
            if (!groupedServices[serviceKey]) {
                groupedServices[serviceKey] = {
                    serviceDate: hcm.serviceDate,
                    serviceType: bill.serviceType,
                    totalUnits: 0,
                    totalAmount: 0,
                    claimId: claimId
                };
            }
            groupedServices[serviceKey].totalUnits += hcm.workedUnits || 0;
            groupedServices[serviceKey].totalAmount += hcm.billAmount || 0;
        });

        Object.values(groupedServices).forEach(service => {
            const { code: procedureCode, modifiers } = getProcedureCodeAndModifier(service.serviceType);
            const modifierString = modifiers && Array.isArray(modifiers) && modifiers.length > 0
                ? ':' + modifiers.join(':') : '';

            let serviceDate;
            try {
                serviceDate = new Date(service.serviceDate);
                if (isNaN(serviceDate.getTime())) {
                    serviceDate = currentDate;
                }
            } catch (e) {
                serviceDate = currentDate;
            }

            const formattedServiceDate = serviceDate.toISOString().slice(0, 10).replace(/-/g, '');
            const serviceAmount = parseFloat(service.totalAmount).toFixed(2);
            const serviceUnits = Math.round(service.totalUnits);

            serviceLineSegments += `LX*${lineNumber}~`;
            serviceLineSegments += `SV1*HC:${procedureCode}${modifierString}:::${service.serviceType.toUpperCase()}*${serviceAmount}*UN*${serviceUnits}***1~`;
            serviceLineSegments += `DTP*472*D8*${formattedServiceDate}~`;
            serviceLineSegments += `REF*6R*${service.claimId}~`;

            lineNumber++;
        });

        let transactionAndInterchangeEndSegment = `SE*PLACEHOLDER*0001~GE*1*${controlNumber}~IEA*1*${controlNumber}~`;

        const ediContent = [
            interchangeHeaderSegment,
            functionalGroupHeaderSegment,
            transactionSetHeaderSegment,
            beginningOfHierarchicalTransactionSegment,
            submitterInformationSegment,
            receiverInformationSegment,
            subscriberHierarchicalLevelSegment,
            taxonomyCode,
            claimInitialInfo,
            patientDetailsSegment,
            insuranceDetails,
            insuranceCompanyDetails,
            claimInformationSegment,
            patientInfo,
            companyInfo,
            serviceLineSegments,
            transactionAndInterchangeEndSegment,
        ].filter(segment => segment !== '').join('');

        const segmentCount = ediContent.split('~').length + 1;
        transactionAndInterchangeEndSegment = transactionAndInterchangeEndSegment.replace('PLACEHOLDER', segmentCount);
        const finalEdiContent = ediContent.replace(/SE\*PLACEHOLDER\*0001~GE\*1\*.*~IEA\*1\*.*~$/, transactionAndInterchangeEndSegment);

        const companyNameForFile = (bill.company?.name || 'HEALTHCARE_PROVIDER').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
        const ediFileName = `${companyNPI}_837P_${formattedDate}_${formattedTime}_${companyNameForFile}_MULTI.dat`;

        bill.ediContent = finalEdiContent;
        bill.ediFileName = ediFileName;

        return { ediContent: finalEdiContent, ediFileName };
    } catch (error) {
        return {
            ediContent: '',
            ediFileName: `fallback_${Date.now()}_error.dat`,
            error: error.message
        };
    }
};

// Helper function to create batch EDI content
async function createBatchContent(bills, controlNumber, isGovernmentInsurance, formattedDate, formattedTime) {
    // Get common data from the first bill
    const firstBill = bills[0];
    const companyNPI = firstBill.companyNPI || '000000';
    const company = firstBill.company;

    // Set appropriate IDs based on insurance type
    let senderId, receiverId, payerName, ourCompanyName, payerId;

    if (isGovernmentInsurance) {
        senderId = 'A634637200'; // Circinno Softwares INC UMPI
        receiverId = '41-1674742'; // MN Dept of Human Services
        payerName = 'MINNESOTA DEPT OF HUMAN SERVICES';
        ourCompanyName = 'CIRCINNO SOFTWARES INC';
        payerId = receiverId;
    } else {
        senderId = company.umpi || companyNPI; // Housing Company NPI/UMPI
        receiverId = '000000'; // Default for commercial
        payerName = firstBill.insurance.name || 'Waystar';
        ourCompanyName = company.name;
        payerId = firstBill.insurance.payerId || '55413'; // Insurance Company Payer ID
    }

    // File header segments
    const interchangeHeaderSegment = `ISA*00*          *00*          *ZZ*${senderId}     *30*${receiverId}         *${formattedDate.slice(2)}*${formattedTime}*^*00501*${controlNumber}*1*P*:~`;
    const functionalGroupHeaderSegment = `GS*HC*${senderId}*${receiverId}*${formattedDate}*${formattedTime}*${controlNumber}*X*005010X222A1~`;
    const transactionSetHeaderSegment = `ST*837*0001*005010X222A1~`;
    const beginningOfHierarchicalTransactionSegment = `BHT*0019*00*${controlNumber}*${formattedDate}*${formattedTime}*CH~`;

    // Submitter and Receiver segments
    const submitterInformationSegment = `NM1*41*2*${ourCompanyName}*****46*${senderId}~`;
    // Optional PER segment for contact information
    const contactInfoSegment = company.contactPerson ?
        `PER*IC*${company.contactPerson}*TE*${company.contactPhone || '000-000-0000'}~` : '';
    const receiverInformationSegment = `NM1*40*2*${payerName}*****46*${receiverId}~`;

    // Build the EDI content
    let ediSegments = [
        interchangeHeaderSegment,
        functionalGroupHeaderSegment,
        transactionSetHeaderSegment,
        beginningOfHierarchicalTransactionSegment,
        submitterInformationSegment,
        contactInfoSegment,
        receiverInformationSegment
    ];

    // Initialize HL segment counter and total SE segment counter
    let hlCounter = 1;
    let segmentCounter = 7; // Initial segments already added

    // Begin subscriber level content
    const subscriberHierarchicalLevelSegment = `HL*${hlCounter}**20*1~`;
    ediSegments.push(subscriberHierarchicalLevelSegment);
    segmentCounter++;

    // Add taxonomy code if present
    if (firstBill.taxonomyCode) {
        const taxonomyCode = `PRV*BI*PXC*${firstBill.taxonomyCode}~`;
        ediSegments.push(taxonomyCode);
        segmentCounter++;
    }

    // Add billing provider info (common for all claims)
    const billingProviderSegment = `NM1*85*2*${company.name}*****XX*${companyNPI}~N3*${company.address.addressLine1}*${company.address.addressLine2}~N4*${company.address.city}*${company.address.state}*${companyZipcode}~REF*EI*${company.taxId}~`;
    ediSegments.push(billingProviderSegment);
    segmentCounter += 4; // 4 segments added

    // Process each patient's claims
    for (let i = 0; i < bills.length; i++) {
        const bill = bills[i];
        hlCounter++;

        // Insurance type code
        const insuranceTypeCode = isGovernmentInsurance ? 'MA' : 'CI';

        // Patient HL segment
        const patientHLSegment = `HL*${hlCounter}*1*22*0~SBR*P*18*******${insuranceTypeCode}~`;
        ediSegments.push(patientHLSegment);
        segmentCounter++;

        // Patient demographic data
        const patientBirthDate = new Date(bill.patientDetails.birthDate).toISOString().slice(0, 10).replace(/-/g, '');
        const patientDetailsSegment = `NM1*IL*1*${bill.patientDetails.lastName}*${bill.patientDetails.firstName}****MI*${bill.insurance.identifier}~`;
        const patientAddressSegment = `N3*${bill.patientDetails.address.addressLine1 || 'Minnesota'}*${bill.patientDetails.address.addressLine2 || ''}~N4*${bill.patientDetails.address.city}*${bill.patientDetails.address.state}*${patientZipcode}~DMG*D8*${patientBirthDate}*${bill.patientDetails.gender === 'Male' ? 'M' : 'F'}~`;
        ediSegments.push(patientDetailsSegment, patientAddressSegment);
        segmentCounter += 4;

        // Insurance company details
        let insuranceCompanyDetails;
        if (isGovernmentInsurance) {
            insuranceCompanyDetails = `NM1*PR*2*${payerName}*****PI*${payerId}~N3*PO BOX 52~N4*MINNEAPOLIS*MN*55440~`;
            segmentCounter += 3;
        } else {
            // Get payerId based on insurance name
            const getPayerId = (insuranceName) => {
                const insuranceMap = {
                    'healthpartners': 'sx009',
                    'hennepinhealth': '60058',
                    'ucareofminnesota': '55413',
                    'primewest': '61604',
                    'medica': '94265',
                    'bcbs': 'z96439'
                };

                const normalizedName = insuranceName.toLowerCase().replace(/\s+/g, '');
                return insuranceMap[normalizedName] || '55413'; // Default to UCare if not found
            };

            const payerId = getPayerId(bill.insurance?.name || 'PRIVATE INSURER');
            insuranceCompanyDetails = `NM1*PR*2*${bill.insurance?.name || 'PRIVATE INSURER'}*****PI*${payerId}~REF*G2*${senderId}~`;
            segmentCounter += 2;
        }
        ediSegments.push(insuranceCompanyDetails);

        // Claim identifier
        const claimId = bill.patientDetails.pmiNumber;

        // Calculate total charge for all service lines
        let totalChargeAmount = 0;
        if (Array.isArray(bill.serviceLines)) {
            // If multiple service lines
            totalChargeAmount = bill.serviceLines.reduce((sum, line) => sum + parseFloat(line.lineItemChargeAmount), 0);
        } else {
            // If just one service line
            totalChargeAmount = parseFloat(bill.bill?.claimInformation?.lineItemChargeAmount || bill.serviceLine.lineItemChargeAmount);
        }

        // Claim information
        const claimInformationSegment = `CLM*${claimId}*${totalChargeAmount.toFixed(2)}***11:B:1*N*A*Y*Y*P~`;
        const patientInfo = `REF*EA*${claimId}~HI*ABK:${bill.patientDetails.diagnosisCode}~`;
        ediSegments.push(claimInformationSegment, patientInfo);
        segmentCounter += 3;

        // Provider or HCM Info
        let companyInfo;
        if (isGovernmentInsurance) {
            companyInfo = `NM1*82*1*${bill.hcms[0]?.name || ''}*Z~`;
            segmentCounter += 1;
        } else {
            companyInfo = `NM1*82*2*${company.name}*****XX*ATYPICAL~REF*G2*${senderId}~`;
            segmentCounter += 2;
        }
        ediSegments.push(companyInfo);

        // Process service lines
        if (Array.isArray(bill.serviceLines)) {
            // Multiple service lines
            for (let j = 0; j < bill.serviceLines.length; j++) {
                const serviceLine = bill.serviceLines[j];
                const lxSegment = `LX*${j + 1}~`;
                ediSegments.push(lxSegment);
                segmentCounter++;

                const serviceDate = new Date(serviceLine.serviceDate);
                const formattedServiceDate = serviceDate.toISOString().slice(0, 10).replace(/-/g, '');

                // Get proper procedure codes and modifiers for this service line
                const { code: batchProcedureCode, modifiers: batchModifiers, displayName: batchDescription } = mapProcedureCode(
                    serviceLine.serviceType || bill.serviceType,
                    serviceLine.methodOfContact || bill.methodOfContact
                );

                // Format modifiers for batch service line
                const batchModifierString = batchModifiers && Array.isArray(batchModifiers) && batchModifiers.length > 0
                    ? ':' + batchModifiers.join(':') : '';

                const serviceLineSegment = `SV1*HC:${batchProcedureCode}${batchModifierString}::::${batchDescription}*${serviceLine.lineItemChargeAmount}*UN*${serviceLine.serviceUnitCount}***1~`;
                const dateOfServiceSegment = `DTP*472*D8*${formattedServiceDate}~`;
                ediSegments.push(serviceLineSegment, dateOfServiceSegment);
                segmentCounter += 2;

                // Reference number for claims
                if (isGovernmentInsurance) {
                    const refSegment = `REF*6R*${serviceLine.claimId || claimId}~`;
                    ediSegments.push(refSegment);
                    segmentCounter++;
                }
            }
        } else {
            // Single service line
            const lxSegment = `LX*1~`;
            ediSegments.push(lxSegment);
            segmentCounter++;

            const serviceLine = bill.serviceLine;
            const serviceDate = new Date(serviceLine.serviceDate);
            const formattedServiceDate = serviceDate.toISOString().slice(0, 10).replace(/-/g, '');

            // Get proper procedure codes and modifiers for this service line
            const { code: batchSingleProcedureCode, modifiers: batchSingleModifiers, displayName: batchSingleDescription } = mapProcedureCode(
                serviceLine.serviceType || bill.serviceType,
                serviceLine.methodOfContact || bill.methodOfContact
            );

            // Format modifiers for batch single service line
            const batchSingleModifierString = batchSingleModifiers && Array.isArray(batchSingleModifiers) && batchSingleModifiers.length > 0
                ? ':' + batchSingleModifiers.join(':') : '';

            const serviceLineSegment = `SV1*HC:${batchSingleProcedureCode}${batchSingleModifierString}::::${batchSingleDescription}*${parseFloat(serviceLine.lineItemChargeAmount || 0).toFixed(2)}*UN*${serviceLine.serviceUnitCount}***1~`;
            const dateOfServiceSegment = `DTP*472*D8*${formattedServiceDate}~`;
            ediSegments.push(serviceLineSegment, dateOfServiceSegment);
            segmentCounter += 2;

            // Reference number for claims
            if (isGovernmentInsurance) {
                const refSegment = `REF*6R*${claimId}~`;
                ediSegments.push(refSegment);
                segmentCounter++;
            }
        }
    }

    // Transaction & Interchange End with correct segment count
    const transactionAndInterchangeEndSegment = `SE*${segmentCount + 1}*0001~GE*1*${controlNumber}~IEA*1*${controlNumber}~`;
    ediSegments.push(transactionAndInterchangeEndSegment);

    // Join all segments and filter out empty ones
    return ediSegments.filter(segment => segment !== '').join('');
}

/**
 * Generate EDI file for multiple patients with multiple visits
 * Handles different HCMs working on different days for the same or different patients
 * @param {Array} bills - Array of bill objects, each potentially containing multiple service lines
 * @returns {Object} Object containing ediContent and ediFileName
 */
export const generateMultiPatientEDI = async (bills) => {
    try {
        if (!bills || !Array.isArray(bills) || bills.length === 0) {
            throw new Error('No bills provided for multi-patient EDI generation');
        }

        // Validate and set defaults for all bills
        bills.forEach(bill => {
            bill.patientDetails = bill.patientDetails || {};
            bill.insurance = bill.insurance || {};
            bill.company = bill.company || {};
            bill.company.address = bill.company.address || {};
            bill.serviceLines = bill.serviceLines || [bill.serviceLine || {}];
            bill.hcms = bill.hcms || [];
        });

        const currentDate = new Date();
        const formattedDate = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        const formattedTime = currentDate.toTimeString().slice(0, 2) + currentDate.toTimeString().slice(3, 5);

        // Generate a unique control number
        const controlNumber = bills[0].controlNumber || Math.floor(100000000 + Math.random() * 900000000).toString();

        // Use first bill's company info as the primary billing provider
        const firstBill = bills[0];
        const companyNPI = firstBill.companyNPI || firstBill.company.npi || '000000';

        // Check if this is government insurance
        const insuranceName = (firstBill.insurance?.name || '').toLowerCase();
        const isGovernmentInsurance =
            insuranceName === 'medical assistance' ||
            insuranceName === 'medicaid mn';

        // Set appropriate IDs based on insurance type
        let senderId, receiverId, payerName, ourCompanyName, payerId;

        if (isGovernmentInsurance) {
            senderId = 'A634637200'; // Circinno Softwares INC UMPI
            receiverId = '41-1674742'; // MN Dept of Human Services
            payerName = 'MINNESOTA DEPT OF HUMAN SERVICES';
            ourCompanyName = 'CIRCINNO SOFTWARES INC';
            payerId = receiverId;
        } else {
            senderId = firstBill.company.umpi || companyNPI;
            receiverId = '000000';
            payerName = 'Waystar';
            ourCompanyName = firstBill.company.name || 'HEALTHCARE PROVIDER';
            payerId = firstBill.insurance.payerId || '55413';
        }

        // Build EDI segments array
        let ediSegments = [];
        let segmentCount = 0;

        // File header segments
        const interchangeHeaderSegment = `ISA*00*          *00*          *ZZ*${senderId.padEnd(15)}*30*${receiverId.padEnd(15)}*${formattedDate.slice(2)}*${formattedTime}*^*00501*${controlNumber}*1*P*:~`;
        const functionalGroupHeaderSegment = `GS*HC*${senderId}*${receiverId}*${formattedDate}*${formattedTime}*${controlNumber}*X*005010X222A1~`;
        const transactionSetHeaderSegment = `ST*837*0001*005010X222A1~`;
        const beginningOfHierarchicalTransactionSegment = `BHT*0019*00*${controlNumber}*${formattedDate}*${formattedTime}*CH~`;

        ediSegments.push(
            interchangeHeaderSegment,
            functionalGroupHeaderSegment,
            transactionSetHeaderSegment,
            beginningOfHierarchicalTransactionSegment
        );
        segmentCount += 4;

        // Submitter Information
        const submitterInformationSegment = `NM1*41*2*${ourCompanyName}*****46*${senderId}~`;
        ediSegments.push(submitterInformationSegment);
        segmentCount++;

        // Contact Information (PER segment)
        if (firstBill.company.contactPerson && firstBill.company.contactPhone) {
            const contactInfoSegment = `PER*IC*${firstBill.company.contactPerson}*TE*${firstBill.company.contactPhone}~`;
            ediSegments.push(contactInfoSegment);
            segmentCount++;
        }

        // Receiver Information
        const receiverInformationSegment = `NM1*40*2*${payerName}*****46*${receiverId}~`;
        ediSegments.push(receiverInformationSegment);
        segmentCount++;

        // Subscriber Hierarchical Level (HL*1)
        const subscriberHierarchicalLevelSegment = `HL*1**20*1~`;
        ediSegments.push(subscriberHierarchicalLevelSegment);
        segmentCount++;

        // Taxonomy code if present
        if (firstBill.taxonomyCode) {
            const taxonomyCode = `PRV*BI*PXC*${firstBill.taxonomyCode}~`;
            ediSegments.push(taxonomyCode);
            segmentCount++;
        }

        // Billing Provider Information
        const companyName = firstBill.company.name || 'HEALTHCARE PROVIDER';
        const companyAddr1 = firstBill.company.address.addressLine1 || 'ADDRESS NOT PROVIDED';
        const companyAddr2 = firstBill.company.address.addressLine2 || '';
        const companyCity = firstBill.company.address.city || '';
        const companyState = firstBill.company.address.state || '';
        const companyTaxId = firstBill.company.taxId || '000000000';

        // Handle zipcode safely
        let companyZipcode = '000000000';
        if (firstBill.company?.address?.zipcode) {
            if (firstBill.company.address.zipcode.length === 9) {
                companyZipcode = firstBill.company.address.zipcode;
            } else {
                companyZipcode = firstBill.company.address.zipcode.padStart(5, '0').padEnd(9, '0');
            }
        }

        const billingProviderSegments = [
            `NM1*85*2*${companyName}*****XX*${companyNPI}~`,
            `N3*${companyAddr1}*${companyAddr2}~`,
            `N4*${companyCity}*${companyState}*${companyZipcode}~`,
            `REF*EI*${companyTaxId}~`
        ];
        ediSegments.push(...billingProviderSegments);
        segmentCount += 4;

        // Process each patient (member)
        let hlCounter = 1; // Start from 2 since HL*1 is already used

        for (let patientIndex = 0; patientIndex < bills.length; patientIndex++) {
            const bill = bills[patientIndex];
            hlCounter++;

            // Insurance type code
            const insuranceTypeCode = isGovernmentInsurance ? 'MA' : 'CI';

            // Patient HL segment
            const patientHLSegment = `HL*${hlCounter}*1*22*0~`;
            const sbrSegment = `SBR*P*18*******${insuranceTypeCode}~`;
            ediSegments.push(patientHLSegment, sbrSegment);
            segmentCount++;

            // Patient Details
            const patientBirthDate = new Date(bill.patientDetails.birthDate || currentDate)
                .toISOString().slice(0, 10).replace(/-/g, '');
            const gender = (bill.patientDetails.gender === 'Male' || bill.patientDetails.gender === 'M') ? 'M' : 'F';

            const patientDetailsSegment = `NM1*IL*1*${bill.patientDetails.lastName || 'DOE'}*${bill.patientDetails.firstName || 'JOHN'}****MI*${bill.insurance.identifier || '0000000000'}~`;
            ediSegments.push(patientDetailsSegment);
            segmentCount++;

            // Patient Address
            const patientAddr1 = bill.patientDetails.address?.addressLine1 || 'ADDRESS NOT PROVIDED';
            const patientAddr2 = bill.patientDetails.address?.addressLine2 || '';
            const patientCity = bill.patientDetails.address?.city || '';
            const patientState = bill.patientDetails.address?.state || '';
            const patientZipcode = bill.patientDetails.address?.zipcode || '000000000';

            const patientAddressSegments = [
                `N3*${patientAddr1}*${patientAddr2}~`,
                `N4*${patientCity}*${patientState}*${patientZipcode}~`,
                `DMG*D8*${patientBirthDate}*${gender}~`
            ];
            ediSegments.push(...patientAddressSegments);
            segmentCount += 3;

            // Insurance Company Details
            let insuranceCompanyDetails;
            if (isGovernmentInsurance) {
                insuranceCompanyDetails = [
                    `NM1*PR*2*${payerName}*****PI*${payerId}~`,
                    `N3*PO BOX 52~`,
                    `N4*MINNEAPOLIS*MN*55440~`
                ];
                segmentCount += 3;
            } else {
                // Get payerId based on insurance name
                const getPayerId = (insuranceName) => {
                    if (!insuranceName) return '55413';
                    const insuranceMap = {
                        'healthpartners': 'sx009',
                        'hennepinhealth': '60058',
                        'ucareofminnesota': '55413',
                        'ucare': '55413',
                        'primewest': '61604',
                        'medica': '94265',
                        'bcbs': 'z96439'
                    };
                    const normalizedName = insuranceName.toLowerCase().replace(/\s+/g, '');
                    return insuranceMap[normalizedName] || '55413';
                };

                const insurancePayerId = getPayerId(bill.insurance?.name || '');
                insuranceCompanyDetails = [
                    `NM1*PR*2*${bill.insurance?.name || 'UCARE'}*****PI*${insurancePayerId}~`,
                    `REF*G2*${senderId}~`
                ];
                segmentCount += 2;
            }
            ediSegments.push(...insuranceCompanyDetails);

            // Calculate total claim amount for this patient
            let totalClaimAmount = 0;
            if (Array.isArray(bill.serviceLines)) {
                totalClaimAmount = bill.serviceLines.reduce((sum, line) =>
                    sum + parseFloat(line.lineItemChargeAmount || 0), 0);
            } else if (bill.serviceLine) {
                totalClaimAmount = parseFloat(bill.serviceLine.lineItemChargeAmount || 0);
            }

            // Main claim ID (use patient's PMI or generate one)
            const mainClaimId = bill.patientDetails.pmiNumber ||
                bill.claimId ||
                `${Date.now().toString().slice(-8)}${patientIndex}`;

            // Claim Information
            const claimInformationSegment = `CLM*${mainClaimId}*${totalClaimAmount.toFixed(2)}***11:B:1*N*A*Y*Y*P~`;
            const claimRefSegment = `REF*EA*${mainClaimId}~`;

            // Diagnosis code
            let diagnosisCode = 'F99'; // Default
            if (bill.patientDetails?.diagnosisCode) {
                const diagnosisParts = bill.patientDetails.diagnosisCode.split(' ');
                if (diagnosisParts.length > 0 && diagnosisParts[0]) {
                    diagnosisCode = diagnosisParts[0];
                }
            }
            const diagnosisSegment = `HI*ABK:${diagnosisCode}~`;

            ediSegments.push(claimInformationSegment, claimRefSegment, diagnosisSegment);
            segmentCount += 3;

            // Provider/HCM Info
            let providerInfo;
            if (isGovernmentInsurance) {
                const hcmName = bill.hcms && bill.hcms.length > 0 && bill.hcms[0]?.name ?
                    bill.hcms[0].name : 'PROVIDER NAME';
                providerInfo = [`NM1*82*2*${companyName}*****XX*ATYPICAL~`, `REF*G2*${senderId}~`];
                segmentCount += 2;
            } else {
                providerInfo = [`NM1*82*2*${companyName}*****XX*ATYPICAL~`, `REF*G2*${senderId}~`];
                segmentCount += 2;
            }
            ediSegments.push(...providerInfo);

            // Process Service Lines for this patient
            const serviceLines = Array.isArray(bill.serviceLines) ? bill.serviceLines : [bill.serviceLine];

            for (let lineIndex = 0; lineIndex < serviceLines.length; lineIndex++) {
                const serviceLine = serviceLines[lineIndex];
                if (!serviceLine) continue;

                const lxSegment = `LX*${lineIndex + 1}~`;
                ediSegments.push(lxSegment);
                segmentCount++;

                // Get procedure code and modifiers
                const { code: multiProcedureCode, modifiers: multiModifiers, displayName: multiDescription } = mapProcedureCode(
                    serviceLine.serviceType || bill.serviceType,
                    serviceLine.methodOfContact || bill.methodOfContact
                );

                // Format modifiers properly - handle array of modifiers
                let modifierString = '';
                if (multiModifiers && Array.isArray(multiModifiers) && multiModifiers.length > 0) {
                    modifierString = ':' + multiModifiers.join(':');
                }
                const serviceAmount = parseFloat(serviceLine.lineItemChargeAmount || 0).toFixed(2);
                const serviceUnits = serviceLine.serviceUnitCount || 1;

                const serviceLineSegment = `SV1*HC:${multiProcedureCode}${modifierString}::::${multiDescription || 'HOMEMAKER'}*${serviceAmount}*UN*${serviceUnits}***1~`;
                ediSegments.push(serviceLineSegment);
                segmentCount++;

                // Service Date
                const serviceDate = new Date(serviceLine.serviceDate || currentDate);
                const formattedServiceDate = serviceDate.toISOString().slice(0, 10).replace(/-/g, '');
                const dateOfServiceSegment = `DTP*472*D8*${formattedServiceDate}~`;
                ediSegments.push(dateOfServiceSegment);
                segmentCount++;

                // Reference number for each service line (unique claim ID)
                const serviceClaimId = serviceLine.claimId ||
                    `${mainClaimId}${lineIndex > 0 ? lineIndex : ''}`;
                const refSegment = `REF*6R*${serviceClaimId}~`;
                ediSegments.push(refSegment);
                segmentCount++;
            }
        }

        // Transaction End Segments
        const transactionEndSegment = `SE*${segmentCount + 1}*0001~`; // +1 for the SE segment itself
        const functionalGroupEndSegment = `GE*1*${controlNumber}~`;
        const interchangeEndSegment = `IEA*1*${controlNumber}~`;

        ediSegments.push(transactionEndSegment, functionalGroupEndSegment, interchangeEndSegment);

        // Join all segments
        const finalEdiContent = ediSegments.join('');

        // Create filename with new format: CompanyNPI_837P_Date&Time_CompanyName
        const companyNameForFile = (firstBill.company?.name || 'HEALTHCARE_PROVIDER').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
        const ediFileName = `${companyNPI}_837P_${formattedDate}_${formattedTime}_${companyNameForFile}.dat`;

        // Ensure the ediFiles directory exists
        const ediFilesDir = path.join(__dirname, '../ediFiles');
        if (!fs.existsSync(ediFilesDir)) {
            fs.mkdirSync(ediFilesDir, { recursive: true });
        }

        return {
            ediContent: finalEdiContent,
            ediFileName,
            isGovernmentInsurance,
            patientCount: bills.length,
            totalServiceLines: bills.reduce((sum, bill) => {
                const serviceLines = Array.isArray(bill.serviceLines) ? bill.serviceLines : [bill.serviceLine];
                return sum + serviceLines.filter(line => line).length;
            }, 0)
        };

    } catch (error) {
        console.error('Error generating multi-patient EDI file:', error);
        return {
            ediContent: '',
            ediFileName: `fallback_${Date.now()}_error.dat`,
            error: error.message
        };
    }
};

/**
 * Generate EDI with proper billing rules:
 * - Same member, multiple employees, same day: Consolidate into one service line with total amount
 * - Same member, different days/services: Multiple service lines
 * - Multiple members: Multiple HL segments
 * - Separate EDIs by payer (no mixing of payers)
 */
export const generateConsolidatedEDI = async (bills) => {
    try {
        if (!bills || !Array.isArray(bills) || bills.length === 0) {
            throw new Error('No bills provided for consolidated EDI generation');
        }

        // Group bills by payer to ensure separate EDIs for different payers
        const billsByPayer = {};
        bills.forEach(bill => {
            const payerKey = bill.insurance?.name?.toLowerCase() || 'unknown';
            if (!billsByPayer[payerKey]) {
                billsByPayer[payerKey] = [];
            }
            billsByPayer[payerKey].push(bill);
        });

        const results = [];

        // Generate separate EDI for each payer
        for (const [payerName, payerBills] of Object.entries(billsByPayer)) {
            // Group bills by patient (member)
            const billsByPatient = {};
            payerBills.forEach(bill => {
                const patientKey = bill.patientDetails?.pmiNumber || bill.tenantId || bill.patientDetails?.firstName + '_' + bill.patientDetails?.lastName;
                if (!billsByPatient[patientKey]) {
                    billsByPatient[patientKey] = [];
                }
                billsByPatient[patientKey].push(bill);
            });

            // Process each patient's bills and consolidate same-day visits
            const consolidatedBills = [];

            for (const [patientKey, patientBills] of Object.entries(billsByPatient)) {
                // Group by service date and service type
                const billsByDateAndService = {};
                patientBills.forEach(bill => {
                    const serviceDate = new Date(bill.serviceLine?.serviceDate || bill.serviceDate).toDateString();
                    const serviceType = bill.serviceLine?.serviceType || bill.serviceType;
                    const key = `${serviceDate}_${serviceType}`;

                    if (!billsByDateAndService[key]) {
                        billsByDateAndService[key] = [];
                    }
                    billsByDateAndService[key].push(bill);
                });

                // Consolidate same-day, same-service visits
                for (const [dateServiceKey, sameDayBills] of Object.entries(billsByDateAndService)) {
                    if (sameDayBills.length === 1) {
                        // Single visit - use as is
                        consolidatedBills.push(sameDayBills[0]);
                    } else {
                        // Multiple visits on same day for same service - consolidate
                        const consolidatedBill = { ...sameDayBills[0] }; // Use first bill as template

                        // Calculate total units and amount
                        let totalUnits = 0;
                        let totalAmount = 0;
                        const allHcms = [];

                        sameDayBills.forEach(bill => {
                            const units = bill.serviceLine?.serviceUnitCount || 0;
                            const amount = parseFloat(bill.serviceLine?.lineItemChargeAmount || 0);

                            totalUnits += units;
                            totalAmount += amount;

                            // Collect all HCMs
                            if (bill.hcms && Array.isArray(bill.hcms)) {
                                allHcms.push(...bill.hcms);
                            }
                        });

                        // Update consolidated bill
                        consolidatedBill.serviceLine.serviceUnitCount = totalUnits;
                        consolidatedBill.serviceLine.lineItemChargeAmount = totalAmount.toFixed(2);
                        consolidatedBill.hcms = allHcms;

                        // Use the main claim ID from the first bill
                        consolidatedBill.claimId = sameDayBills[0].claimId || sameDayBills[0].patientDetails?.pmiNumber;

                        consolidatedBills.push(consolidatedBill);
                    }
                }
            }

            // Generate EDI for this payer
            const ediResult = await generateMultiPatientEDI(consolidatedBills);

            if (ediResult.ediContent) {
                results.push({
                    ...ediResult,
                    payerName: payerName,
                    originalBillCount: payerBills.length,
                    consolidatedBillCount: consolidatedBills.length
                });
            }
        }

        return {
            success: true,
            results: results,
            totalPayers: Object.keys(billsByPayer).length,
            message: `Generated ${results.length} EDI files for ${Object.keys(billsByPayer).length} payers`
        };

    } catch (error) {
        console.error('[CONSOLIDATED EDI] Error generating consolidated EDI:', error);
        return {
            success: false,
            error: error.message,
            results: []
        };
    }
};

