/**
 * Utility for mapping procedure codes to service types and modifiers
 * 
 * PRIMARY MAPPING: Procedure codes are the source of truth
 * - T2024 U8 → Housing Consultation (HC)
 * - H2015 U8 → Housing Transition (HT)
 * - H2015 U8 TS → Housing Sustaining (HS)
 * - T2038 U8 → Moving Expenses (ME)
 * 
 * For HC, HT, HS services, if the appointment/visit is Remote then add U4 modifier:
 * - HC Remote: T2024 U8 U4
 * - HT Remote: H2015 U8 U4
 * - HS Remote: H2015 U8 TS U4
 */

// PRIMARY MAPPING: Procedure codes as source of truth
export const PROCEDURE_CODE_MAPPINGS = {
    'T2024': {
        code: 'T2024',
        baseModifiers: ['U8'],
        displayName: 'Housing Consultation',
        abbreviation: 'HC',
        supportsRemote: true,
        description: 'Providing consultation and support for housing-related needs'
    },
    'H2015_U8': {
        code: 'H2015',
        baseModifiers: ['U8'],
        displayName: 'Housing Transition',
        abbreviation: 'HT',
        supportsRemote: true,
        description: 'Supporting individuals in transitioning to stable housing',
        identifier: 'H2015_U8' // Unique identifier for H2015 variants
    },
    'H2015_U8_TS': {
        code: 'H2015',
        baseModifiers: ['U8', 'TS'],
        displayName: 'Housing Sustaining',
        abbreviation: 'HS',
        supportsRemote: true,
        description: 'Providing ongoing support to maintain stable housing',
        identifier: 'H2015_U8_TS' // Unique identifier for H2015 variants
    },
    'T2038': {
        code: 'T2038',
        baseModifiers: ['U8'],
        displayName: 'Moving Expenses',
        abbreviation: 'ME',
        supportsRemote: false,
        description: 'Covering expenses related to relocation and moving'
    }
};

// Helper function to get procedure code identifier
const getProcedureCodeId = (code, modifiers) => {
    if (code === 'H2015') {
        return modifiers.includes('TS') ? 'H2015_U8_TS' : 'H2015_U8';
    }
    return code;
};

// REVERSE MAPPINGS: Built from primary mapping for backward compatibility
export const SERVICE_TYPE_MAPPINGS = {};
export const SERVICE_TYPE_ALIASES = {};
export const DISPLAY_NAME_TO_CODE = {};

// Build reverse mappings
Object.entries(PROCEDURE_CODE_MAPPINGS).forEach(([key, mapping]) => {
    SERVICE_TYPE_MAPPINGS[mapping.displayName] = {
        code: mapping.code,
        modifiers: mapping.baseModifiers,
        displayName: mapping.displayName,
        identifier: mapping.identifier || key
    };
    SERVICE_TYPE_ALIASES[mapping.abbreviation] = mapping.displayName;
    DISPLAY_NAME_TO_CODE[mapping.displayName] = key;
});

/**
 * Get service type display name from procedure code identifier
 * @param {string} procedureCodeId - The procedure code identifier (e.g., 'T2024', 'H2015_U8_TS')
 * @returns {string} The display name or the original identifier if not found
 */
export const getServiceTypeFromProcedureCode = (procedureCodeId) => {
    const mapping = PROCEDURE_CODE_MAPPINGS[procedureCodeId];
    return mapping ? mapping.displayName : procedureCodeId;
};

/**
 * Get procedure code identifier from service type name
 * @param {string} serviceType - The service type name or abbreviation
 * @returns {string} The procedure code identifier
 */
export const getProcedureCodeFromServiceType = (serviceType) => {
    // Check if it's an alias first
    const normalizedServiceType = SERVICE_TYPE_ALIASES[serviceType] || serviceType;
    return DISPLAY_NAME_TO_CODE[normalizedServiceType] || serviceType;
};

/**
 * Get complete procedure code information with modifiers
 * @param {string} serviceTypeOrCode - Service type name, abbreviation, or procedure code
 * @param {string} methodOfContact - The method of contact (remote, in-person, etc.)
 * @returns {Object} Object containing code, modifiers, and formatted string
 */
export const getProcedureCodeAndModifier = (serviceTypeOrCode, methodOfContact = '') => {
    try {
        // Handle undefined or null serviceTypeOrCode
        if (!serviceTypeOrCode) {
            console.warn('Service type or code is undefined or null, using default H2015_U8');
            serviceTypeOrCode = 'H2015_U8'; // Default to Housing Transition
            return {
                code: 'H2015',
                modifiers: ['U8'],
                formattedString: 'H2015 U8',
                displayName: 'Housing Transition',
                abbreviation: 'HT',
                procedureCodeId: 'H2015_U8'
            };
        }

        let procedureCodeId;

        // ✅ FIXED: Handle common procedure codes that come in as just the base code
        if (serviceTypeOrCode === 'H2015') {
            console.log('⚠️ Service type "H2015" detected, defaulting to "H2015_U8" (Housing Transition)');
            procedureCodeId = 'H2015_U8';
        } else if (serviceTypeOrCode === 'T2024') {
            procedureCodeId = 'T2024';
        } else if (serviceTypeOrCode === 'T2038') {
            procedureCodeId = 'T2038';
        }
        // Determine if input is already a procedure code or needs conversion
        else if (PROCEDURE_CODE_MAPPINGS[serviceTypeOrCode]) {
            procedureCodeId = serviceTypeOrCode;
        } else {
            procedureCodeId = getProcedureCodeFromServiceType(serviceTypeOrCode);
        }

        // Get the mapping
        const mapping = PROCEDURE_CODE_MAPPINGS[procedureCodeId];

        if (!mapping) {
            console.warn(`No procedure code mapping found for: ${serviceTypeOrCode}`);
            // ✅ FIXED: Provide a fallback for H2015 codes
            if (serviceTypeOrCode && typeof serviceTypeOrCode === 'string' && serviceTypeOrCode.includes('H2015')) {
                const fallbackMapping = PROCEDURE_CODE_MAPPINGS['H2015_U8'];
                return {
                    code: fallbackMapping.code,
                    modifiers: [...fallbackMapping.baseModifiers],
                    formattedString: `${fallbackMapping.code} ${fallbackMapping.baseModifiers.join(' ')}`,
                    displayName: fallbackMapping.displayName,
                    abbreviation: fallbackMapping.abbreviation,
                    procedureCodeId: 'H2015_U8'
                };
            }

            // Default fallback for any unrecognized service type
            return {
                code: 'H2015',
                modifiers: ['U8'],
                formattedString: 'H2015 U8',
                displayName: 'Housing Transition',
                abbreviation: 'HT',
                procedureCodeId: 'H2015_U8'
            };
        }

        // Start with base modifiers
        let modifiers = [...mapping.baseModifiers];

        // Add U4 modifier for remote services
        const isRemote = methodOfContact && typeof methodOfContact === 'string' && methodOfContact.toLowerCase().includes('remote');

        if (isRemote && mapping.supportsRemote) {
            modifiers.push('U4');
        }

        // Create formatted string
        const formattedString = `${mapping.code} ${modifiers.join(' ')}`;

        return {
            code: mapping.code,
            modifiers: modifiers,
            formattedString: formattedString,
            displayName: mapping.displayName,
            abbreviation: mapping.abbreviation,
            procedureCodeId: procedureCodeId,
            isRemote: isRemote,
            supportsRemote: mapping.supportsRemote
        };

    } catch (error) {
        console.error('Error in getProcedureCodeAndModifier:', error);
        // Return a safe default in case of any error
        return {
            code: 'H2015',
            modifiers: ['U8'],
            formattedString: 'H2015 U8',
            displayName: 'Housing Transition',
            abbreviation: 'HT',
            procedureCodeId: 'H2015_U8'
        };
    }
};

/**
 * Get all available procedure codes with their service types
 * @returns {Array} Array of procedure code objects
 */
export const getAllProcedureCodes = () => {
    return Object.entries(PROCEDURE_CODE_MAPPINGS).map(([procedureCodeId, mapping]) => ({
        procedureCodeId,
        code: mapping.code,
        modifiers: mapping.baseModifiers,
        displayName: mapping.displayName,
        abbreviation: mapping.abbreviation,
        formattedString: `${mapping.code} ${mapping.baseModifiers.join(' ')}`,
        supportsRemote: mapping.supportsRemote
    }));
};

/**
 * Get all available service types (for backward compatibility)
 * @returns {Array} Array of service type objects
 */
export const getAllServiceTypes = () => {
    return getAllProcedureCodes().map(item => ({
        serviceType: item.displayName,
        code: item.code,
        modifiers: item.modifiers,
        displayName: item.displayName,
        formattedString: item.formattedString
    }));
};

/**
 * Validate if a service type or procedure code is supported
 * @param {string} serviceTypeOrCode - The service type or procedure code to validate
 * @returns {boolean} True if supported, false otherwise
 */
export const isValidServiceType = (serviceTypeOrCode) => {
    // Check if it's a procedure code
    if (PROCEDURE_CODE_MAPPINGS[serviceTypeOrCode]) {
        return true;
    }

    // Check if it's a service type name or alias
    const normalizedServiceType = SERVICE_TYPE_ALIASES[serviceTypeOrCode] || serviceTypeOrCode;
    return SERVICE_TYPE_MAPPINGS.hasOwnProperty(normalizedServiceType);
};

/**
 * Get service type from procedure code (legacy function)
 * @param {string} procedureCode - The procedure code to lookup
 * @returns {string|null} The service type name or null if not found
 */
export const getServiceTypeFromCode = (procedureCode) => {
    for (const [procedureCodeId, mapping] of Object.entries(PROCEDURE_CODE_MAPPINGS)) {
        if (mapping.code === procedureCode) {
            return mapping.displayName;
        }
    }
    return null;
};

// Export mapProcedureCode as an alias for getProcedureCodeAndModifier for backward compatibility
export const mapProcedureCode = getProcedureCodeAndModifier;

// Enhanced function to get full service type details
export const getServiceTypeDetails = (procedureCodeId) => {
    const mapping = PROCEDURE_CODE_MAPPINGS[procedureCodeId];
    if (!mapping) {
        return {
            displayName: procedureCodeId,
            code: procedureCodeId,
            description: 'Unknown service type',
            abbreviation: 'UN'
        };
    }
    return {
        displayName: mapping.displayName,
        code: mapping.code,
        modifiers: mapping.baseModifiers,
        description: mapping.description,
        abbreviation: mapping.abbreviation,
        supportsRemote: mapping.supportsRemote
    };
};

export default {
    PROCEDURE_CODE_MAPPINGS,
    SERVICE_TYPE_MAPPINGS,
    SERVICE_TYPE_ALIASES,
    DISPLAY_NAME_TO_CODE,
    getProcedureCodeAndModifier,
    mapProcedureCode,
    getServiceTypeFromProcedureCode,
    getProcedureCodeFromServiceType,
    getAllProcedureCodes,
    getAllServiceTypes,
    isValidServiceType,
    getServiceTypeFromCode,
    getServiceTypeDetails
}; 