// helpers/ediGenerator.js

function generateEDI(bill) {
    const {
        interchangeControlHeader,
        functionalGroupHeader,
        transactionSetHeader,
        hierarchicalTransaction,
        submitterName,
        receiverName,
        billingProvider,
        subscriber,
        payerName,
        claimInformation,
        renderingProvider,
        serviceLine
    } = bill;

    return `
ISA*00*          *00*          *ZZ*${interchangeControlHeader.senderId}     *30*${interchangeControlHeader.receiverId}         *${formatDate(interchangeControlHeader.date)}*${interchangeControlHeader.time}*^*${interchangeControlHeader.controlVersionNumber}*${interchangeControlHeader.controlNumber}*1*P*:~
GS*HC*${functionalGroupHeader.senderCode}*${functionalGroupHeader.receiverCode}*${formatDate(functionalGroupHeader.date)}*${functionalGroupHeader.time}*${functionalGroupHeader.groupControlNumber}*X*${functionalGroupHeader.versionIdentifierCode}~
ST*${transactionSetHeader.identifierCode}*${transactionSetHeader.controlNumber}*${transactionSetHeader.conventionReference}~
BHT*${hierarchicalTransaction.structureCode}*${hierarchicalTransaction.purposeCode}*${hierarchicalTransaction.originalTransactionId}*${formatDate(hierarchicalTransaction.creationDate)}*${hierarchicalTransaction.transactionTypeCode}~
NM1*41*2*${submitterName.name}*****46*${submitterName.identifier}~
PER*IC*${submitterName.contactName}*TE*${submitterName.communicationNumber}~
NM1*40*2*${receiverName.name}*****46*${receiverName.primaryIdentifier}~
HL*1**20*1~
PRV*BI*PXC*${billingProvider.taxonomyCode}~
NM1*85*2*${billingProvider.name}*****XX*${billingProvider.identifier}~
N3*${billingProvider.address.line1}*${billingProvider.address.line2}~
N4*${billingProvider.address.city}*${billingProvider.address.state}*${billingProvider.address.zipCode}~
REF*EI*${billingProvider.additionalIdentifier}~
HL*2*1*22*0~
SBR*P*18*******CI~
NM1*IL*1*${subscriber.lastName}*${subscriber.firstName}****MI*${subscriber.primaryIdentifier}~
N3*${subscriber.address.line1}*${subscriber.address.line2}~
N4*${subscriber.address.city}*${subscriber.address.state}*${subscriber.address.zipCode}~
DMG*D8*${formatDate(subscriber.dob)}*${subscriber.gender}~
NM1*PR*2*${payerName.name}*****PI*${payerName.identifier}~
REF*G2*${billingProvider.identifier}~
CLM*${claimInformation.patientAccountNumber}*${claimInformation.totalClaimChargeAmount}***11:B:1*N*A*Y*Y*P~
REF*EA*${claimInformation.patientAccountNumber}~
HI*ABK:${claimInformation.diagnosisCode}~
NM1*82*2*${renderingProvider.name}*****XX*${renderingProvider.identifier}~
REF*G2*${billingProvider.identifier}~
LX*1~
SV1*HC:${serviceLine[0].procedureCode}:${serviceLine[0].modifier}:::${serviceLine[0].description}*${serviceLine[0].lineItemChargeAmount}*UN*${serviceLine[0].serviceUnitCount}***${serviceLine[0].diagnosisCodePointer}~
DTP*472*D8*${formatDate(serviceLine[0].serviceDate)}~
REF*6R*${serviceLine[0].lineItemControlNumber}~
SE*29*${transactionSetHeader.controlNumber}~
GE*1*${functionalGroupHeader.groupControlNumber}~
IEA*1*${interchangeControlHeader.controlNumber}~
  `.trim();
}

function formatDate(date) {
    const d = new Date(date);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export default generateEDI;