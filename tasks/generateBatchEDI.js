import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mapProcedureCode } from '../utils/procedureCodeMapper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to get default procedure code based on service type
function getDefaultProcedureCode(serviceType) {
  const serviceCodeMap = {
    'Housing Transition': 'H2015',
    'Individual Employment': 'H2023',
    'Group Employment': 'H2025',
    'Individual Skills': 'H2014',
    'Group Skills': 'H2021',
    'Individual Community': 'H2017',
    'Group Community': 'H2021',
    default: 'H2015',
  };

  return serviceCodeMap[serviceType] || serviceCodeMap['default'];
}

// Helper function to format date for EDI
function formatEDIDate(date) {
  if (!date) return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const d = new Date(date);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export const generateBatchEDI = async (bill) => {
  try {
    if (!bill) {
      console.error('Bill object is required');
      throw new Error('Bill object is required');
    }

    // Deep validation of bill object
    // Check if bill is a plain object
    if (typeof bill !== 'object' || Array.isArray(bill) || bill === null) {
      console.error('Bill must be a valid object');
      bill = {}; // Create empty bill to avoid further errors
    }

    // Initialize bill properties with defaults
    bill.patientDetails = bill.patientDetails || {};
    bill.insurance = bill.insurance || {};
    bill.company = bill.company || {};
    bill.company.address = bill.company.address || {};
    bill.serviceLine = bill.serviceLine || {};
    bill.bill = bill.bill || {};
    bill.bill.claimInformation = bill.bill.claimInformation || {};
    bill.hcms = bill.hcms || [];
    bill.serviceLines = bill.serviceLines || [];

    // Ensure serviceLines is always an array
    if (!Array.isArray(bill.serviceLines)) {
      console.warn('serviceLines is not an array, initializing as empty array');
      bill.serviceLines = [];
    }

    // Validate each service line has required properties
    bill.serviceLines = bill.serviceLines.filter((line) => {
      if (!line || typeof line !== 'object') {
        console.warn('Removing invalid service line (not an object)');
        return false;
      }

      // Ensure required numeric fields have valid values
      if (typeof line.lineItemChargeAmount !== 'number') {
        console.warn(
          `Service line missing lineItemChargeAmount, defaulting to 0`
        );
        line.lineItemChargeAmount = 0;
      }

      if (typeof line.serviceUnitCount !== 'number') {
        console.warn(`Service line missing serviceUnitCount, defaulting to 1`);
        line.serviceUnitCount = 1;
      }

      return true;
    });

    const controlNumber =
      bill.controlNumber ||
      Math.floor(100000000 + Math.random() * 900000000).toString();
    const companyNPI = bill.companyNPI || '000000';

    const currentDate = new Date();
    const formattedDate = currentDate
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
    const formattedTime =
      currentDate.toTimeString().slice(0, 2) +
      currentDate.toTimeString().slice(3, 5);

    // Patient birth date formatting
    const birthDateISO =
      bill.patientDetails.birthDate || new Date().toISOString();
    const birthDate = new Date(birthDateISO);
    const formattedBirthDate = !isNaN(birthDate.getTime())
      ? birthDate.toISOString().slice(0, 10).replace(/-/g, '')
      : currentDate.toISOString().slice(0, 10).replace(/-/g, '');

    // Determine insurance type
    const insuranceName = (bill.insurance?.name || '').toLowerCase();
    const isGovernmentInsurance =
      insuranceName === 'medical assistance' || insuranceName === 'medicaid mn';

    let senderId, receiverId, payerName, ourCompanyName, payerId, claimId;

    if (isGovernmentInsurance) {
      senderId = 'A634637200';
      receiverId = '41-1674742';
      payerName = 'MINNESOTA DEPT OF HUMAN SERVICES';
      ourCompanyName = 'CIRCINNO SOFTWARES INC';
      payerId = receiverId;
      claimId =
        bill.claimId ||
        bill.patientDetails.pmiNumber ||
        `${Date.now().toString().slice(-8)}`;
    } else {
      senderId = bill.company.umpi || companyNPI;
      receiverId = '000000';
      payerName = 'Waystar';
      ourCompanyName = bill.company.name || 'HEALTHCARE PROVIDER';
      payerId = bill.insurance.payerId || '55413';
      claimId = bill.claimId || `${Date.now().toString().slice(-8)}`;
    }

    // Calculate total claim amount from all service lines
    let totalClaimAmount = 0;
    try {
      totalClaimAmount = bill.serviceLines.reduce((sum, line) => {
        const amount =
          typeof line.lineItemChargeAmount === 'number'
            ? line.lineItemChargeAmount
            : 0;
        return sum + amount;
      }, 0);

      // Ensure we have a valid amount
      if (isNaN(totalClaimAmount) || totalClaimAmount <= 0) {
        console.warn(
          'Total claim amount is invalid, calculating from service lines...'
        );
        // Try alternative calculation methods
        if (
          bill.serviceLine &&
          typeof bill.serviceLine.lineItemChargeAmount === 'number'
        ) {
          totalClaimAmount = bill.serviceLine.lineItemChargeAmount;
        } else if (
          bill.bill &&
          bill.bill.claimInformation &&
          typeof bill.bill.claimInformation.totalClaimChargeAmount === 'number'
        ) {
          totalClaimAmount = bill.bill.claimInformation.totalClaimChargeAmount;
        } else {
          // Calculate from individual service lines manually
          totalClaimAmount = 0;
          bill.serviceLines.forEach((line) => {
            if (line && typeof line.lineItemChargeAmount === 'number') {
              totalClaimAmount += line.lineItemChargeAmount;
            }
          });
        }
      }
    } catch (error) {
      console.error('Error calculating total claim amount:', error);
      totalClaimAmount = 0;
    }

    // Header segments
    const interchangeHeaderSegment = `ISA*00*          *00*          *ZZ*${senderId.padEnd(
      15
    )}*30*${receiverId.padEnd(15)}*${formattedDate.slice(
      2
    )}*${formattedTime}*^*00501*${controlNumber}*1*P*:~`;
    const functionalGroupHeaderSegment = `GS*HC*${senderId}*${receiverId}*${formattedDate}*${formattedTime}*${controlNumber}*X*005010X222A1~`;
    const transactionSetHeaderSegment = `ST*837*0001*005010X222A1~`;
    const beginningOfHierarchicalTransactionSegment = `BHT*0019*00*${controlNumber}*${formattedDate}*${formattedTime}*CH~`;

    // Submitter and receiver information
    const submitterInformationSegment = `NM1*41*2*${
      isGovernmentInsurance
        ? ourCompanyName
        : bill.company.name || 'HEALTHCARE PROVIDER'
    }*****46*${senderId}~`;
    const contactInformationSegment = isGovernmentInsurance
      ? `PER*IC*Muna Abdisamad*TE*952-564-1128~`
      : '';
    const receiverInformationSegment = `NM1*40*2*${payerName}*****46*${receiverId}~`;

    // Provider hierarchy
    const subscriberHierarchicalLevelSegment = `HL*1**20*1~`;
    const taxonomyCode = bill.taxonomyCode
      ? `PRV*BI*PXC*${bill.taxonomyCode}~`
      : 'PRV*BI*PXC*261Q00000X~';
    const insuranceTypeCode = isGovernmentInsurance ? 'MA' : 'CI';

    // Company information
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
        companyZipcode = bill.company.address.zipcode
          .padStart(5, '0')
          .padEnd(9, '0');
      }
    }

    const billingProviderSegment = `NM1*85*2*${companyName}*****XX*${companyNPI}~N3*${finalCompanyAddr1}*${companyAddr2}~N4*${companyCity}*${companyState}*${companyZipcode}~REF*EI*${companyTaxId}~`;

    // Patient hierarchy and subscriber information
    const patientHierarchySegment = `HL*2*1*22*0~SBR*P*18*******${insuranceTypeCode}~`;

    // Patient details
    const patientDetailsSegment = `NM1*IL*1*${
      bill.patientDetails?.lastName || 'DOE'
    }*${bill.patientDetails?.firstName || 'JOHN'}****MI*${
      bill.insurance?.identifier || '0000000000'
    }~`;

    const patientZipcode = bill.patientDetails?.address?.zipcode || '000000000';
    const patientAddr1 =
      bill.patientDetails?.address?.addressLine1 || 'ADDRESS NOT PROVIDED';
    const patientAddr2 = bill.patientDetails?.address?.addressLine2 || '';
    const patientCity = bill.patientDetails?.address?.city || '';
    const patientState = bill.patientDetails?.address?.state || '';
    const finalPatientAddr1 = patientAddr1 || 'ADDRESS NOT PROVIDED';

    const gender =
      bill.patientDetails.gender === 'Male' ||
      bill.patientDetails.gender === 'M'
        ? 'M'
        : 'F';
    const patientAddressSegment = `N3*${finalPatientAddr1}*${patientAddr2}~N4*${patientCity}*${patientState}*${patientZipcode}~DMG*D8*${formattedBirthDate}*${gender}~`;

    // Insurance company details
    let insuranceCompanyDetails;
    if (isGovernmentInsurance) {
      insuranceCompanyDetails = `NM1*PR*2*${payerName}*****PI*${payerId}~N3*PO BOX 52~N4*MINNEAPOLIS*MN*55440~`;
    } else {
      const getPayerId = (insuranceName) => {
        if (!insuranceName) return '55413';
        const insuranceMap = {
          healthpartners: 'sx009',
          hennepinhealth: '60058',
          ucareofminnesota: '55413',
          primewest: '61604',
          medica: '94265',
          bcbs: 'z96439',
        };
        const normalizedName = insuranceName.toLowerCase().replace(/\s+/g, '');
        return insuranceMap[normalizedName] || '55413';
      };

      const insurancePayerId = getPayerId(bill.insurance?.name || '');
      insuranceCompanyDetails = `NM1*PR*2*${
        bill.insurance?.name || 'UCARE'
      }*****PI*${insurancePayerId}~REF*G2*${senderId}~`;
    }

    // Claim information
    const claimInformationSegment = `CLM*${claimId}*${totalClaimAmount.toFixed(
      2
    )}***11:B:1*N*A*Y*Y*P~`;

    // Diagnosis and reference information
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
      const hcmName =
        bill.hcms && bill.hcms.length > 0 && bill.hcms[0]?.name
          ? bill.hcms[0].name
          : 'PROVIDER NAME';
      renderingProviderSegment = `NM1*82*1*${hcmName}*Z~`;
    } else {
      renderingProviderSegment = `NM1*82*2*${companyName}*****XX*ATYPICAL~REF*G2*${senderId}~`;
    }

    // Process service lines with proper LX segment generation
    let lxCounter = 1;
    let serviceLineSegments = ''; // Initialize serviceLineSegments properly
    for (const serviceLine of bill.serviceLines) {
      // LX segment - Service Line Number
      serviceLineSegments += `LX*${lxCounter}~`;

      // SV1 segment - Professional Service
      const procedureCode =
        serviceLine.procedureCode ||
        getDefaultProcedureCode(serviceLine.serviceType);
      const lineItemAmount = serviceLine.lineItemChargeAmount || 0;
      const units = serviceLine.serviceUnitCount || 1;

      // Ensure we have a valid amount
      if (lineItemAmount <= 0) {
        console.warn(
          `Service line ${lxCounter} has invalid amount: ${lineItemAmount}. Check visit amount calculation.`
        );
      }

      let cleanedModifier = '';
      if (serviceLine.modifier) {
        cleanedModifier = [...new Set(serviceLine.modifier.split(':'))]
          .filter(Boolean)
          .join(':');
      }
      serviceLineSegments += `SV1*${procedureCode}${
        cleanedModifier ? ':' + cleanedModifier : ''
      }*${lineItemAmount.toFixed(2)}*UN*${units}***1~`;

      // DTP segment - Service Date
      const serviceDate = serviceLine.serviceDate || serviceLine.visitDate;
      const formattedServiceDate = serviceDate
        ? formatEDIDate(serviceDate)
        : formatEDIDate(new Date());
      serviceLineSegments += `DTP*472*D8*${formattedServiceDate}~`;

      // REF segment - Service Line Reference
      const serviceLineRefId = `${Math.floor(
        100000000 + Math.random() * 900000000
      )}`;
      serviceLineSegments += `REF*6R*${serviceLineRefId}~`;

      lxCounter++;
    }

    // Calculate segment count for transaction trailer
    const segments = [
      interchangeHeaderSegment,
      functionalGroupHeaderSegment,
      transactionSetHeaderSegment,
      beginningOfHierarchicalTransactionSegment,
      submitterInformationSegment,
      contactInformationSegment,
      receiverInformationSegment,
      subscriberHierarchicalLevelSegment,
      taxonomyCode,
      billingProviderSegment,
      patientHierarchySegment,
      patientDetailsSegment,
      patientAddressSegment,
      insuranceCompanyDetails,
      claimInformationSegment,
      patientReferenceSegment,
      renderingProviderSegment,
      serviceLineSegments,
    ]
      .filter((segment) => segment !== '')
      .join('');
    const ediContentWithoutTrailers = segments;
    const segmentCount =
      ediContentWithoutTrailers.split('~').filter((s) => s.trim()).length + 1;

    const transactionTrailerSegment = `SE*${segmentCount}*0001~`;
    const functionalGroupTrailerSegment = `GE*1*${controlNumber}~`;
    const interchangeTrailerSegment = `IEA*1*${controlNumber}~`;

    // Assemble final EDI content
    const finalEdiContent = [
      interchangeHeaderSegment,
      functionalGroupHeaderSegment,
      transactionSetHeaderSegment,
      beginningOfHierarchicalTransactionSegment,
      submitterInformationSegment,
      contactInformationSegment,
      receiverInformationSegment,
      subscriberHierarchicalLevelSegment,
      taxonomyCode,
      billingProviderSegment,
      patientHierarchySegment,
      patientDetailsSegment,
      patientAddressSegment,
      insuranceCompanyDetails,
      claimInformationSegment,
      patientReferenceSegment,
      renderingProviderSegment,
      serviceLineSegments,
      transactionTrailerSegment,
      functionalGroupTrailerSegment,
      interchangeTrailerSegment,
    ]
      .filter((segment) => segment !== '')
      .join('');

    // Generate file name - save as .txt file instead of .dat
    const companyNameForFile = (bill.company?.name || 'HEALTHCARE_PROVIDER')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toUpperCase();
    const ediFileName = `${companyNPI}_837P_${formattedDate}_${formattedTime}_${companyNameForFile}.txt`;

    return {
      ediContent: finalEdiContent,
      ediFileName: ediFileName,
    };
  } catch (error) {
    console.error('Error generating batch EDI:', error);
    return {
      ediContent: '',
      ediFileName: `fallback_${Date.now()}_error.txt`,
      error: error.message,
    };
  }
};
