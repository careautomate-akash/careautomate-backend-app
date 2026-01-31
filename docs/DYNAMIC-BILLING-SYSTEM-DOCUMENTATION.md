# Dynamic Billing System Documentation

## Table of Contents
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Data Flow](#data-flow)
4. [Visit Processing](#visit-processing)
5. [Batch and Claim Organization](#batch-and-claim-organization)
6. [EDI Generation](#edi-generation)
7. [Status Management](#status-management)
8. [API Endpoints](#api-endpoints)
9. [Database Schema](#database-schema)
10. [Error Handling](#error-handling)
11. [Performance Considerations](#performance-considerations)

## Overview

The Dynamic Billing System is a comprehensive healthcare billing solution that processes visits, organizes them into batches and claims, and generates EDI (Electronic Data Interchange) files for insurance submission. The system handles the complete lifecycle from visit approval to final billing.

### Key Features
- **Dynamic Filtering**: Real-time filtering of visits based on multiple criteria
- **Automated Batching**: Intelligent grouping of visits into billing batches
- **Claim Generation**: Automatic creation of insurance claims
- **EDI Generation**: Standard X12 837P EDI file generation
- **Status Tracking**: Complete audit trail of all billing actions
- **Multi-tenant Support**: Handles multiple healthcare providers

## System Architecture

### Core Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   API Layer     │    │   Database      │
│   (React)       │◄──►│   (Express)     │◄──►│   (MongoDB)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   EDI Generator │
                       │   (X12 837P)    │
                       └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   File System   │
                       │   (EDI Files)   │
                       └─────────────────┘
```

### Technology Stack
- **Backend**: Node.js with Express.js
- **Database**: MongoDB with Mongoose ODM
- **EDI Processing**: Custom X12 837P implementation
- **File Storage**: Local filesystem with organized directory structure
- **Authentication**: JWT-based authentication
- **Logging**: Comprehensive audit logging system

## Data Flow

### 1. Visit Approval to Billing Flow

```
Visit Created → Visit Approved → Dynamic Filtering → Batch Organization → 
Claim Generation → EDI Generation → Status Updates → File Storage
```

### 2. Detailed Process Flow

1. **Visit Approval**: HCM visits are approved by administrators
2. **Dynamic Filtering**: System applies filters based on:
   - Date ranges
   - Tenant IDs
   - HCM IDs
   - Service types
   - Visit statuses
   - Claim statuses

3. **Visit Enhancement**: Each visit is enhanced with:
   - Time calculations (hours)
   - Unit calculations (15-minute units)
   - Amount calculations ($17.17 per unit)
   - Status tracking

4. **Grouping and Organization**:
   - Visits grouped by tenant, service type, and HCM
   - Date-based sub-batching
   - Claim generation with unique identifiers

5. **EDI Generation**:
   - Service lines created for each unique day/HCM/service combination
   - X12 837P format compliance
   - File generation and storage

## Visit Processing

### Visit Enhancement Algorithm

```javascript
// Time Calculation
if (visit.startTime && visit.endTime) {
    timeInHours = (endTime - startTime) / (1000 * 60 * 60);
} else {
    timeInHours = 1; // Default
}

// Unit Calculation (15 minutes = 1 unit)
units = Math.max(1, Math.ceil((timeInHours * 60) / 15));

// Amount Calculation ($17.17 per unit)
const ratePerUnit = 17.17;
calculatedAmount = units * ratePerUnit;
```

### Visit Status Lifecycle

```
not_scheduled → scheduled → submitted → billed
      ↓
  cancelled (can happen at any stage except billed)
```

## Batch and Claim Organization

### Batching Strategy

1. **Primary Grouping**: By tenant, service type, and HCM
2. **Secondary Grouping**: By date ranges (configurable periods)
3. **Time Period Calculation**:
   - ≤7 days: Group all together
   - 8-15 days: 15-day periods
   - 16-30 days: 15-day periods
   - >30 days: 15-day periods

### Claim Structure

```javascript
const claim = {
    claimId: "CLAIM_XXX_YYYY_MM_XXX",
    batchId: "BATCH_XXX_YYYY_MM_XXX",
    tenantId: ObjectId,
    serviceType: String,
    visits: [Visit],
    totalVisits: Number,
    totalAmount: Number,
    totalUnits: Number,
    status: String,
    hcms: [HCM],
    startDate: Date,
    endDate: Date,
    ediGenerated: Boolean,
    ediFileName: String
};
```

### Batch Structure

```javascript
const batch = {
    batchId: "BATCH_XXX_YYYY_MM_XXX",
    tenantId: ObjectId,
    serviceType: String,
    visits: [Visit],
    claims: [Claim],
    totalVisits: Number,
    totalAmount: Number,
    totalUnits: Number,
    status: String,
    hcmCount: Number,
    startDate: Date,
    endDate: Date
};
```

## EDI Generation

### Service Line Grouping for EDI

The system creates separate LX (Service Line) segments for each unique combination of:
- **Date**: Each service date gets its own line
- **HCM**: Each healthcare provider gets separate lines
- **Service Type**: Different services are separated

### EDI Structure (X12 837P)

```
ISA (Interchange Control Header)
  GS (Functional Group Header)
    ST (Transaction Set Header)
      BHT (Beginning of Hierarchical Transaction)
      
      // Submitter Information
      NM1*41 (Submitter Name)
      PER*IC (Submitter Contact)
      
      // Receiver Information  
      NM1*40 (Receiver Name)
      
      // Billing Provider
      HL*1 (Billing Provider Hierarchy)
      NM1*85 (Billing Provider Name)
      N3 (Billing Provider Address)
      N4 (Billing Provider City/State/ZIP)
      REF*EI (Billing Provider Tax ID)
      
      // Subscriber Information
      HL*2 (Subscriber Hierarchy)
      SBR (Subscriber Information)
      NM1*IL (Subscriber Name)
      N3 (Subscriber Address)
      N4 (Subscriber City/State/ZIP)
      DMG (Subscriber Demographics)
      
      // Patient Information (if different from subscriber)
      HL*3 (Patient Hierarchy)
      PAT (Patient Information)
      NM1*QC (Patient Name)
      
      // Claim Information
      HL*4 (Claim Hierarchy)
      CLM (Claim Information)
      DTP*434 (Statement From Date)
      DTP*435 (Statement To Date)
      
      // Service Lines (Multiple LX segments)
      LX*1 (Service Line Number 1)
      SV1 (Professional Service 1)
      DTP*472 (Service Date 1)
      REF*6R (Service Line Reference 1)
      
      LX*2 (Service Line Number 2)
      SV1 (Professional Service 2)
      DTP*472 (Service Date 2)
      REF*6R (Service Line Reference 2)
      
      // ... Additional LX segments for each service
      
    SE (Transaction Set Trailer)
  GE (Functional Group Trailer)
IEA (Interchange Control Trailer)
```

### Procedure Code Mapping

```javascript
const serviceCodeMap = {
    'Housing Transition': 'H2015',
    'Individual Employment': 'H2023',
    'Group Employment': 'H2025',
    'Individual Skills': 'H2014',
    'Group Skills': 'H2021',
    'Individual Community': 'H2017',
    'Group Community': 'H2021',
    'default': 'H2015'
};
```

### EDI File Naming Convention

```
Format: {IDENTIFIER}_{TIMESTAMP}.txt
Example: CLAIM_12345_1640995200000.txt
        BATCH_67890_1640995200000.txt
```

## Status Management

### Visit Status Updates

```javascript
// Available Actions
const actions = ['schedule', 'submit', 'cancel', 'bill'];

// Status Validation Rules
const validTransitions = {
    'not_scheduled': ['scheduled', 'cancelled'],
    'scheduled': ['submitted', 'cancelled'],
    'submitted': ['billed', 'cancelled'],
    'billed': [], // Final state
    'cancelled': [] // Final state
};
```

### Audit Logging

Every action is logged with:
- User ID and Company ID
- Entity type and ID
- Action performed
- Timestamp
- Metadata (previous state, new state, etc.)
- Performance metrics

## API Endpoints

### Core Endpoints

#### 1. Apply Dynamic Filters
```
POST /api/dynamic-bills/apply-filters
```

**Request Body:**
```javascript
{
    "companyId": "string",
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD", 
    "tenantIds": ["string"],
    "hcmIds": ["string"],
    "serviceTypes": ["string"],
    "visitStatuses": ["approved"],
    "claimStatuses": ["not_scheduled", "scheduled"],
    "includeSubmitted": boolean,
    "page": 1,
    "limit": 1000
}
```

**Response:**
```javascript
{
    "success": true,
    "message": "Filters applied successfully",
    "data": {
        "visits": [Visit],
        "groupedVisits": [GroupedVisit],
        "batches": [Batch],
        "claims": [Claim],
        "ediGenerationResults": {
            "successful": number,
            "errors": [Error]
        },
        "summary": {
            "totalVisits": number,
            "totalBatches": number,
            "totalClaims": number,
            "statusBreakdown": Object,
            "ediGenerated": number,
            "ediErrors": number
        },
        "pagination": Object,
        "performance": Object
    }
}
```

#### 2. Update Visit Status
```
POST /api/dynamic-bills/update-status
```

**Request Body:**
```javascript
{
    "visitIds": ["string"],
    "action": "schedule|submit|cancel|bill",
    "scheduledDate": "ISO Date String",
    "cancellationReason": "string",
    "companyId": "string"
}
```

#### 3. Generate Individual Visit EDI
```
POST /api/dynamic-bills/generate-edi/:visitId
```

#### 4. Generate Batch/Claim EDI
```
POST /api/dynamic-bills/generate-batch-edi/:batchId
```

## Database Schema

### Visits Collection
```javascript
{
    _id: ObjectId,
    companyId: ObjectId,
    tenantId: ObjectId,
    hcmId: ObjectId,
    date: Date,
    startTime: Date,
    endTime: Date,
    serviceType: String,
    activity: String,
    methodOfContact: String,
    status: String, // Visit approval status
    claimStatus: String, // Billing status
    claimAmount: Number,
    claimUnits: Number,
    calculatedAmount: Number,
    calculatedUnits: Number,
    timeInHours: Number,
    batchId: String,
    claimId: String,
    ediGenerated: Boolean,
    ediGeneratedDate: Date,
    ediFileName: String,
    ediContent: String,
    scheduledDate: Date,
    scheduledBy: ObjectId,
    submittedDate: Date,
    submittedBy: ObjectId,
    cancelledDate: Date,
    cancelledBy: ObjectId,
    cancellationReason: String,
    billedDate: Date,
    billedBy: ObjectId,
    createdAt: Date,
    updatedAt: Date
}
```

### Audit Log Collection
```javascript
{
    _id: ObjectId,
    companyId: ObjectId,
    userId: ObjectId,
    entityType: String, // 'visit', 'batch', 'claim', 'filter'
    entityId: String,
    action: String,
    description: String,
    metadata: Object,
    timestamp: Date
}
```

## Error Handling

### Common Error Scenarios

1. **Invalid Date Ranges**
   - Start date after end date
   - Future dates for completed visits
   - Invalid date formats

2. **Status Transition Errors**
   - Invalid status transitions
   - Missing required data for status updates
   - Concurrent modification conflicts

3. **EDI Generation Errors**
   - Missing required patient information
   - Invalid service codes
   - File system write errors

4. **Data Validation Errors**
   - Missing required fields
   - Invalid data types
   - Business rule violations

### Error Response Format
```javascript
{
    "success": false,
    "message": "Error description",
    "error": "Detailed error message",
    "code": "ERROR_CODE",
    "timestamp": "ISO Date String",
    "requestId": "unique-request-id"
}
```

## Performance Considerations

### Database Optimization

1. **Indexes**
   ```javascript
   // Compound indexes for efficient filtering
   { companyId: 1, date: 1, claimStatus: 1 }
   { companyId: 1, tenantId: 1, hcmId: 1 }
   { companyId: 1, serviceType: 1, date: 1 }
   { batchId: 1 }
   { claimId: 1 }
   ```

2. **Query Optimization**
   - Use lean() for read-only operations
   - Populate only required fields
   - Implement pagination for large datasets
   - Use aggregation pipelines for complex queries

3. **Caching Strategy**
   - Cache frequently accessed reference data
   - Cache EDI templates
   - Implement Redis for session management

### Scalability Considerations

1. **Horizontal Scaling**
   - Stateless API design
   - Database sharding by company
   - Load balancing for API endpoints

2. **Vertical Scaling**
   - Optimize memory usage
   - CPU-intensive operations in background jobs
   - Database connection pooling

3. **Background Processing**
   - Queue EDI generation for large batches
   - Asynchronous status updates
   - Batch processing for bulk operations

## Security Considerations

### Authentication & Authorization
- JWT-based authentication
- Role-based access control
- Company-based data isolation
- API rate limiting

### Data Protection
- Encryption at rest
- Encryption in transit (HTTPS)
- PII data masking in logs
- HIPAA compliance measures

### Audit Trail
- Complete action logging
- User activity tracking
- Data access monitoring
- Compliance reporting

## Monitoring & Logging

### Performance Metrics
- API response times
- Database query performance
- EDI generation times
- Error rates by endpoint

### Business Metrics
- Visit processing volumes
- Claim generation rates
- EDI success rates
- Status transition patterns

### Alerting
- System error alerts
- Performance degradation alerts
- Business rule violation alerts
- Compliance monitoring alerts

## Deployment & Configuration

### Environment Variables
```bash
# Database
MONGODB_URI=mongodb://localhost:27017/care-automate
MONGODB_OPTIONS={}

# File Storage
UPLOADS_DIR=/path/to/uploads
EDI_FILES_DIR=/path/to/edi-files

# EDI Configuration
EDI_SENDER_ID=SENDER123
EDI_RECEIVER_ID=RECEIVER456
EDI_TEST_MODE=false

# Performance
MAX_VISITS_PER_BATCH=1000
EDI_GENERATION_TIMEOUT=30000
```

### File System Structure
```
uploads/
├── ediFiles/
│   ├── CLAIM_12345_1640995200000.txt
│   ├── BATCH_67890_1640995200000.txt
│   └── ...
├── documents/
├── ftpBatch/
├── mnItsBatch/
└── mnItsReady/
```

## Testing Strategy

### Unit Tests
- Individual function testing
- Data validation testing
- Business logic testing
- Error handling testing

### Integration Tests
- API endpoint testing
- Database integration testing
- EDI generation testing
- File system operations testing

### Performance Tests
- Load testing for high-volume scenarios
- Stress testing for peak loads
- Memory usage testing
- Database performance testing

## Maintenance & Support

### Regular Maintenance Tasks
1. Database cleanup of old audit logs
2. File system cleanup of old EDI files
3. Index optimization
4. Performance monitoring review

### Support Procedures
1. Error investigation workflows
2. Data recovery procedures
3. Performance troubleshooting
4. Compliance audit support

### Documentation Updates
- API documentation maintenance
- Business rule documentation
- Technical architecture updates
- User guide updates

---

## Conclusion

The Dynamic Billing System provides a comprehensive solution for healthcare billing automation. Its modular design, robust error handling, and scalable architecture make it suitable for healthcare organizations of various sizes. The system's emphasis on audit trails, compliance, and performance ensures reliable operation in production environments.

For technical support or feature requests, please refer to the development team or create an issue in the project repository.