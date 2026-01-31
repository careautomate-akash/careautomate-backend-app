import { set } from 'mongoose';

// EDIGenerator.js - Updated version to match the sample format
class EDIGenerator {
  constructor() {
    this.EDI_VERSION = '005010X222A1';
    this.SENDER_ID = '1164134086';
    this.RECEIVER_ID = '0000000000';
    this.RECEIVER_NAME = 'Waystar';
    this.PROVIDER_NAME = 'Sample Provider Name';
    this.PROVIDER_NPI = '0000000000';
    this.PROVIDER_TAX_ID = '000000000';
    this.PROVIDER_ADDRESS = {
      line1: '123 Sample St',
      city: 'Sample City',
      state: 'Sample State',
      zip: '12345',
    };
    this.CONTACT = {
      name: 'John Doe',
      phone: '1234567890',
    };
  }

  // Format date as YYYYMMDD
  formatDate(date = new Date()) {
    const d = new Date(date);
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('');
  }

  // Format time as HHMM
  formatTime(date = new Date()) {
    const d = new Date(date);
    return [
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
    ].join('');
  }

  // Generate random 9-digit number for control numbers
  generateControlNumber() {
    return Math.floor(100000000 + Math.random() * 900000000).toString();
  }

  // Generate ISA segment
  generateISA(controlNumber) {
    const date = this.formatDate();
    const time = this.formatTime();
    return `ISA*00*          *00*          *ZZ*${this.SENDER_ID.padEnd(
      15
    )}*30*${this.RECEIVER_ID.padEnd(15)}*${date.slice(
      2
    )}*${time}*^*00501*${controlNumber}*1*P*:~`;
  }

  // Generate GS segment
  generateGS(controlNumber) {
    const date = this.formatDate();
    const time = this.formatTime();
    return `GS*HC*${this.SENDER_ID}*${this.RECEIVER_ID}*${date}*${time}*${controlNumber}*X*${this.EDI_VERSION}~`;
  }

  // Generate ST segment
  generateST() {
    return `ST*837*0001*${this.EDI_VERSION}~`;
  }

  // Generate BHT segment
  generateBHT(controlNumber) {
    const date = this.formatDate();
    const time = this.formatTime();
    return `BHT*0019*00*${controlNumber}*${date}*${time}*CH~`;
  }

  generateFileName(bhtControl) {
    const date = this.formatDate(); // YYYYMMDD
    const time = this.formatTime(); // HHMM
    const timestamp = `${date}${time}22`; // YYYYMMDDHHMM22 (adding '22' at end)

    // Extract the last part from provider name (e.g., "EASE HOUSING LLC" -> "EaseHousing")
    const providerSuffix = this.PROVIDER_NAME.split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('')
      .replace(/LLC$/, ''); // Remove LLC if present

    return `${this.SENDER_ID}_837_${
      bhtControl || '000000'
    }_${timestamp}_CT${providerSuffix}.dat`;
  }

  // Generate provider information segments
  generateProviderInfo() {
    return [
      `NM1*41*2*${this.PROVIDER_NAME}*****46*${this.SENDER_ID}~`,
      `PER*IC*${this.CONTACT.name}*TE*${this.CONTACT.phone}~`,
      `NM1*40*2*${this.RECEIVER_NAME}*****46*${this.RECEIVER_ID}~`,
    ].join('');
  }

  // Generate billing provider segments
  generateBillingProvider() {
    return [
      `HL*1**20*1~`,
      `PRV*BI*PXC*261Q00000X~`,
      `NM1*85*2*${this.PROVIDER_NAME}*****XX*${this.PROVIDER_NPI}~`,
      `N3*${this.PROVIDER_ADDRESS.line1}~`,
      `N4*${this.PROVIDER_ADDRESS.city}*${this.PROVIDER_ADDRESS.state}*${this.PROVIDER_ADDRESS.zip}~`,
      `REF*EI*${this.PROVIDER_TAX_ID}~`,
    ].join('');
  }

  // Generate patient segments
  generatePatient(patient, claimId, index) {
    const payerId = this.getPayerId(patient.admissionInfo.insurance);
    const diagnosisCode = patient.admissionInfo.diagnosisCode
      .split(' ')[0]
      .replace('.', '');

    return [
      // Subscriber HL
      `HL*${index + 1}*1*22*0~`,
      // Subscriber info
      `SBR*P*18*******CI~`,
      // Patient info
      `NM1*IL*1*${patient.personalInfo.lastName || 'UNKNOWN'}*${
        patient.personalInfo.firstName
      }****MI*${patient.admissionInfo.insuranceNumber || '000000000'}~`,
      `N3*${patient.address.addressLine1}${
        patient.address.addressLine2 ? '*' + patient.address.addressLine2 : ''
      }~`,
      `N4*${patient.address.city}*${patient.address.state}*${patient.address.zipCode}~`,
      `DMG*D8*${this.formatDate(
        patient.personalInfo.dob
      )}*${patient.personalInfo.gender.charAt(0).toUpperCase()}~`,
      // Payer info
      `NM1*PR*2*${patient.admissionInfo.insurance.toUpperCase()}*****PI*${payerId}~`,
      `REF*G2*${this.SENDER_ID}~`,
      // Claim info
      `CLM*${claimId}*${patient.totalAmount.toFixed(2)}***11:B:1*N*A*Y*Y*P~`,
      `REF*EA*${claimId}~`,
      `HI*ABK:${diagnosisCode}~`,
      // Rendering provider
      `NM1*82*2*${this.PROVIDER_NAME}*****XX*ATYPICAL~`,
      `REF*G2*${this.SENDER_ID}~`,
    ].join('');
  }

  // Generate service lines
  generateServiceLines(services) {
    return services
      .map((service, i) => {
        return [
          `LX*${i + 1}~`,
          `SV1*HC:${service._doc.serviceType}:U8:U4:::${
            service._doc.serviceTypeName || 'HOMEMAKER'
          }*${service.amount.toFixed(2)}*UN*${service.units}***1~`,
          `DTP*472*D8*${this.formatDate(service._doc.date)}~`,
          `REF*6R*${service.claimId}~`,
        ].join('');
      })
      .join('');
  }

  // Generate trailer segments
  generateTrailers(controlNumber, segmentCount) {
    return [
      `SE*${segmentCount}*0001~`,
      `GE*1*${controlNumber}~`,
      `IEA*1*${controlNumber}~`,
    ].join('');
  }

  // Get payer ID mapping
  getPayerId(insuranceName) {
    const mappings = {
      ucare: '55413',
      medica: '94265',
      'medical assistance': '41-1674742',
    };

    const lowerName = insuranceName.toLowerCase();
    return mappings[lowerName] || '55413'; // Default to UCare
  }

  setProviderInfo(providerInfo) {
    if (providerInfo) {
      this.PROVIDER_NAME = providerInfo.companyName || this.PROVIDER_NAME;
      this.PROVIDER_NPI = providerInfo.idnpiUmpi || this.PROVIDER_NPI;
      this.SENDER_ID = providerInfo.idnpiUmpi || this.SENDER_ID;
      this.PROVIDER_TAX_ID = providerInfo.federalTaxId || this.PROVIDER_TAX_ID;
      this.PROVIDER_ADDRESS = {
        line1: providerInfo.address.addressLine1 || this.PROVIDER_ADDRESS.line1,
        city: providerInfo.address.city || this.PROVIDER_ADDRESS.city,
        state: providerInfo.address.state || this.PROVIDER_ADDRESS.state,
        zip: providerInfo.address.zipCode || this.PROVIDER_ADDRESS.zip,
      };
      this.CONTACT = {
        name:
          providerInfo.firstName + ' ' + providerInfo.lastName ||
          this.CONTACT.name,
        phone: providerInfo.contact.cellPhoneNumber || this.CONTACT.phone,
      };
      this.RECEIVER_ID =
        providerInfo.payerId === 'medical assistance'
          ? '41-1674742'
          : providerInfo.payerId || this.RECEIVER_ID;
      this.RECEIVER_NAME =
        providerInfo.payerId === 'medical assistance'
          ? 'MINNESOTA DEPT OF HUMAN SERVICES'
          : providerInfo.payerName || this.RECEIVER_NAME;
    }
  }
  // Main generation function
  async generateEDI(visits, batchIdentifier) {
    try {
      // Group visits by patient
      const patients = {};
      visits.forEach((visit) => {
        const providerInfo = visit.companyInfo || {};
        providerInfo.payerId =
          visit.tenantId.admissionInfo.insurance.toLowerCase();
        this.setProviderInfo(providerInfo);
        const tenantId = visit.tenantId._id.toString();

        if (!patients[tenantId]) {
          patients[tenantId] = {
            ...visit.tenantId,
            visits: [],
            totalAmount: 0,
          };
        }

        let timeInHours = 0;
        if (visit.startTime && visit.endTime) {
          const startTime = new Date(visit.startTime);
          const endTime = new Date(visit.endTime);
          timeInHours = (endTime - startTime) / (1000 * 60 * 60);
        } else {
          timeInHours = 1;
        }

        const units = Math.max(1, Math.ceil((timeInHours * 60) / 15));
        const ratePerUnit = 17.17;
        const amount = units * ratePerUnit;

        patients[tenantId].visits.push({
          ...visit,
          units,
          amount,
        });
        patients[tenantId].totalAmount += amount;
      });

      // Generate control numbers
      const isaControl = this.generateControlNumber();
      const gsControl = this.generateControlNumber();
      const bhtControl = this.generateControlNumber();

      // Start building EDI content
      const segments = [
        this.generateISA(isaControl),
        this.generateGS(gsControl),
        this.generateST(),
        this.generateBHT(bhtControl),
        this.generateProviderInfo(),
        this.generateBillingProvider(),
      ];

      // Add patient claims
      Object.values(patients).forEach((patient, index) => {
        const claimId = this.generateControlNumber();
        segments.push(this.generatePatient(patient, claimId, index));
        segments.push(
          this.generateServiceLines(
            patient.visits.map((v) => ({
              ...v,
              claimId,
              serviceType: v.serviceTypeName || 'HOMEMAKER',
            }))
          )
        );
      });

      // Calculate segment count (current segments + SE/GE/IEA)
      const segmentCount = segments.length + 3;

      // Add trailers
      segments.push(this.generateTrailers(gsControl, segmentCount));

      // Combine all segments
      const ediContent = segments.join('');

      return {
        success: true,
        content: ediContent,
        fileName: this.generateFileName(bhtControl),
      };
    } catch (error) {
      console.error('EDI Generation Error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

export default new EDIGenerator();
