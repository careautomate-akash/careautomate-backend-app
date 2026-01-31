import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mapProcedureCode } from '../utils/procedureCodeMapper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate EDI file with multiple patients (tenants) in one batch
 * This handles the scenario where multiple members and same/different employees work on different days
 */
export const generateMultiPatientEDI = async (bills) => {
    try {
        if (!bills || bills.length === 0) {
            throw new Error('Bills array is required and cannot be empty');
        }

        // Use the first bill for header information (assuming same company)
        const firstBill = bills[0];

        const controlNumber = firstBill.controlNumber || Math.floor(100000000 + Math.random() * 900000000).toString();
        const companyNPI = firstBill.companyNPI || '000000';

        const currentDate = new Date();
        const formattedDate = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
        const formattedTime = currentDate.toTimeString().slice(0, 2) + currentDate.toTimeString().slice(3, 5);

        // Determine insurance type from first bill
        const insuranceName = (firstBill.insurance?.name || '').toLowerCase();
        const isGovernmentInsurance = insuranceName === 'medical assistance' || insuranceName === 'medicaid mn';

        let senderId, receiverId, payerName, ourCompanyName;

        if (isGovernmentInsurance) {
            senderId = 'A634637200';
            receiverId = '41-1674742';
            payerName = 'MINNESOTA DEPT OF HUMAN SERVICES';
            ourCompanyName = 'CIRCINNO SOFTWARES INC';
        } else {
            senderId = firstBill.company.umpi || companyNPI;
            receiverId = '000000';
            payerName = 'Waystar';
            ourCompanyName = firstBill.company.name || 'HEALTHCARE PROVIDER';
        }

        // Header segments (same for all scenarios)
        const interchangeHeaderSegment = `ISA*00*          *00*          *ZZ*${senderId.padEnd(15)}*30*${receiverId.padEnd(15)}*${formattedDate.slice(2)}*${formattedTime}*^*00501*${controlNumber}*1*P*:~`;
        const functionalGroupHeaderSegment = `GS*HC*${senderId}*${receiverId}*${formattedDate}*${formattedTime}*${controlNumber}*X*005010X222A1~`;
        const transactionSetHeaderSegment = `ST*837*0001*005010X222A1~`;
        const beginningOfHierarchicalTransactionSegment = `BHT*0019*00*${controlNumber}*${formattedDate}*${formattedTime}*CH~`;

        // Submitter and receiver information
        const submitterInformationSegment = `NM1*41*2*${ourCompanyName}*****46*${senderId}~`;
        const contactInformationSegment = isGovernmentInsurance ?
            `PER*IC*Muna Abdisamad*TE*952-564-1128~` : '';
        const receiverInformationSegment = `NM1*40*2*${payerName}*****46*${receiverId}~`;

        // Provider hierarchy
        const subscriberHierarchicalLevelSegment = `HL*1**20*1~`;
        const taxonomyCode = firstBill.taxonomyCode ? `PRV*BI*PXC*${firstBill.taxonomyCode}~` : 'PRV*BI*PXC*261Q00000X~';

        // Company information
        const companyName = firstBill.company?.name || 'HEALTHCARE PROVIDER';
        const companyAddr1 = firstBill.company?.address?.addressLine1 || '';
        const companyAddr2 = firstBill.company?.address?.addressLine2 || '';
        const companyCity = firstBill.company?.address?.city || '';
        const companyState = firstBill.company?.address?.state || '';
        const companyTaxId = firstBill.company?.taxId || '000000000';
        const finalCompanyAddr1 = companyAddr1 || 'ADDRESS NOT PROVIDED';

        let companyZipcode = '000000000';
        if (firstBill.company?.address?.zipcode) {
            companyZipcode = firstBill.company.address.zipcode.length === 9 ?
                firstBill.company.address.zipcode :
                firstBill.company.address.zipcode.padStart(5, '0').padEnd(9, '0');
        }

        const billingProviderSegment = `NM1*85*2*${companyName}*****XX*${companyNPI}~N3*${finalCompanyAddr1}*${companyAddr2}~N4*${companyCity}*${companyState}*${companyZipcode}~REF*EI*${companyTaxId}~`;

        // Generate patient sections for each bill
        let patientSections = '';
        let hierarchyLevel = 2; // Start from HL*2 for first patient

        for (const bill of bills) {
            const patientSection = generatePatientSection(bill, hierarchyLevel, senderId, isGovernmentInsurance);
            patientSections += patientSection;
            hierarchyLevel++; // Increment for next patient
        }

        // Calculate total segment count
        const headerSegments = [
            interchangeHeaderSegment,
            functionalGroupHeaderSegment,
            transactionSetHeaderSegment,
            beginningOfHierarchicalTransactionSegment,
            submitterInformationSegment,
            contactInformationSegment,
            receiverInformationSegment,
            subscriberHierarchicalLevelSegment,
            taxonomyCode,
            billingProviderSegment
        ].filter(seg => seg !== '').join('');

        const totalContent = headerSegments + patientSections;
        const segmentCount = totalContent.split('~').length - 1 + 2; // +2 for SE and trailer segments

        // Trailer segments
        const transactionTrailerSegment = `SE*${segmentCount}*0001~`;
        const functionalGroupTrailerSegment = `GE*1*${controlNumber}~`;
        const interchangeTrailerSegment = `IEA*1*${controlNumber}~`;

        // Assemble final EDI content
        const finalEdiContent = [
            headerSegments,
            patientSections,
            transactionTrailerSegment,
            functionalGroupTrailerSegment,
            interchangeTrailerSegment
        ].join('');

        // Generate file name
        const companyNameForFile = (firstBill.company?.name || 'HEALTHCARE_PROVIDER').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
        const ediFileName = `${companyNPI}_837P_${formattedDate}_${formattedTime}_${companyNameForFile}_BATCH.dat`;

        return {
            ediContent: finalEdiContent,
            ediFileName: ediFileName
        };
    } catch (error) {
        console.error('Error generating multi-patient EDI:', error);
        return {
            ediContent: '',
            ediFileName: `fallback_multipatient_${Date.now()}_error.dat`,
            error: error.message
        };
    }
};

/**
 * Generate patient section for multi-patient EDI
 */
function generatePatientSection(bill, hierarchyLevel, senderId, isGovernmentInsurance) {
    const insuranceTypeCode = isGovernmentInsurance ? 'MA' : 'CI';
    const claimId = bill.claimId || `${Date.now().toString().slice(-8)}`;

    // Patient birth date formatting
    const birthDateISO = bill.patientDetails?.birthDate || new Date().toISOString();
    const birthDate = new Date(birthDateISO);
    const formattedBirthDate = !isNaN(birthDate.getTime()) ?
        birthDate.toISOString().slice(0, 10).replace(/-/g, '') :
        new Date().toISOString().slice(0, 10).replace(/-/g, '');

    // Calculate total claim amount for this patient
    const totalClaimAmount = bill.serviceLines?.reduce((sum, line) => sum + (line.lineItemChargeAmount || 0), 0) ||
        bill.serviceLine?.lineItemChargeAmount || 0;

    // Patient hierarchy and subscriber information
    const patientHierarchySegment = `HL*${hierarchyLevel}*1*22*0~SBR*P*18*******${insuranceTypeCode}~`;

    // Patient details
    const patientDetailsSegment = `NM1*IL*1*${bill.patientDetails?.lastName || 'DOE'}*${bill.patientDetails?.firstName || 'JOHN'}****MI*${bill.insurance?.identifier || '0000000000'}~`;

    // Patient address
    const patientZipcode = bill.patientDetails?.address?.zipcode || '000000000';
    const patientAddr1 = bill.patientDetails?.address?.addressLine1 || 'ADDRESS NOT PROVIDED';
    const patientAddr2 = bill.patientDetails?.address?.addressLine2 || '';
    const patientCity = bill.patientDetails?.address?.city || '';
    const patientState = bill.patientDetails?.address?.state || '';

    const gender = (bill.patientDetails?.gender === 'Male' || bill.patientDetails?.gender === 'M') ? 'M' : 'F';
    const patientAddressSegment = `N3*${patientAddr1}*${patientAddr2}~N4*${patientCity}*${patientState}*${patientZipcode}~DMG*D8*${formattedBirthDate}*${gender}~`;

    // Insurance company details
    let insuranceCompanyDetails;
    if (isGovernmentInsurance) {
        insuranceCompanyDetails = `NM1*PR*2*MINNESOTA DEPT OF HUMAN SERVICES*****PI*41-1674742~N3*PO BOX 52~N4*MINNEAPOLIS*MN*55440~`;
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
        insuranceCompanyDetails = `NM1*PR*2*${bill.insurance?.name || 'UCARE'}*****PI*${insurancePayerId}~REF*G2*${senderId}~`;
    }

    // Claim information
    const claimInformationSegment = `CLM*${claimId}*${totalClaimAmount.toFixed(2)}***11:B:1*N*A*Y*Y*P~`;

    // Diagnosis information
    let diagnosisCode = 'F99';
    if (bill.patientDetails?.diagnosisCode) {
        const diagnosisParts = bill.patientDetails.diagnosisCode.split(' ');
        if (diagnosisParts.length > 0 && diagnosisParts[0]) {
            diagnosisCode = diagnosisParts[0].replace('.', '');
        }
    }

    const patientReferenceSegment = `REF*EA*${claimId}~HI*ABK:${diagnosisCode}~`;

    // Rendering provider information
    let renderingProviderSegment;
    if (isGovernmentInsurance) {
        const hcmName = bill.hcms && bill.hcms.length > 0 && bill.hcms[0]?.name ?
            bill.hcms[0].name : 'PROVIDER NAME';
        renderingProviderSegment = `NM1*82*1*${hcmName}*Z~`;
    } else {
        renderingProviderSegment = `NM1*82*2*${bill.company?.name || 'HEALTHCARE PROVIDER'}*****XX*ATYPICAL~REF*G2*${senderId}~`;
    }

    // Generate service lines for this patient
    let serviceLineSegments = '';
    let lineCounter = 1;

    // Use serviceLines if available, otherwise fall back to single serviceLine
    const servicesToProcess = bill.serviceLines && bill.serviceLines.length > 0 ?
        bill.serviceLines : [bill.serviceLine];

    // Group service lines by date and service type for same-day consolidation
    const groupedServices = new Map();

    servicesToProcess.forEach(line => {
        if (!line) return;

        const serviceDate = new Date(line.serviceDate);
        const formattedServiceDate = serviceDate.toISOString().slice(0, 10).replace(/-/g, '');
        const key = `${formattedServiceDate}_${line.serviceType}`;

        if (groupedServices.has(key)) {
            const existing = groupedServices.get(key);
            existing.serviceUnitCount += (line.serviceUnitCount || 0);
            existing.lineItemChargeAmount += (line.lineItemChargeAmount || 0);
        } else {
            groupedServices.set(key, {
                ...line,
                formattedServiceDate
            });
        }
    });

    // Generate service line segments for each unique date/service combination
    for (const [key, serviceData] of groupedServices) {
        const { code: procedureCode, modifiers, displayName } = mapProcedureCode(
            serviceData.serviceName || serviceData.serviceType,
            serviceData.methodOfContact || 'in_person'
        );

        const modifierString = modifiers && Array.isArray(modifiers) && modifiers.length > 0
            ? ':' + modifiers.join(':') : '';

        serviceLineSegments += `LX*${lineCounter}~`;
        serviceLineSegments += `SV1*HC:${procedureCode}${modifierString}:::${displayName}*${serviceData.lineItemChargeAmount.toFixed(2)}*UN*${serviceData.serviceUnitCount}***1~`;
        serviceLineSegments += `DTP*472*D8*${serviceData.formattedServiceDate}~`;
        serviceLineSegments += `REF*6R*${serviceData.claimId || claimId}~`;

        lineCounter++;
    }

    // Combine all patient segments
    return [
        patientHierarchySegment,
        patientDetailsSegment,
        patientAddressSegment,
        insuranceCompanyDetails,
        claimInformationSegment,
        patientReferenceSegment,
        renderingProviderSegment,
        serviceLineSegments
    ].join('');
} 