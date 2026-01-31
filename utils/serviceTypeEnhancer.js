import { getProcedureCodeAndModifier } from './procedureCodeMapper.js';

/**
 * Enhance service type with additional metadata
 * @param {Object} serviceType - Original service type object
 * @returns {Object} Enhanced service type with additional details
 */
export const enhanceServiceType = (serviceType) => {
    try {
        // Extract procedure code details
        const procedureCodeInfo = getProcedureCodeAndModifier(serviceType.serviceType);

        return {
            ...serviceType,
            serviceName: procedureCodeInfo.displayName,
            procedureCode: procedureCodeInfo.code,
            identifier: procedureCodeInfo.procedureCodeId,
            abbreviation: procedureCodeInfo.abbreviation,
            supportsRemote: procedureCodeInfo.supportsRemote,
            description: procedureCodeInfo.description || 'No description available',
            formattedProcedureCode: procedureCodeInfo.formattedString
        };
    } catch (error) {
        console.error('Error enhancing service type:', error);
        return {
            ...serviceType,
            serviceName: serviceType.serviceType,
            procedureCode: 'UNKNOWN',
            identifier: serviceType.serviceType,
            description: 'Unable to parse service type'
        };
    }
};

/**
 * Enhance multiple service types
 * @param {Array} serviceTypes - Array of service type objects
 * @returns {Array} Array of enhanced service types
 */
export const enhanceServiceTypes = (serviceTypes) => {
    return serviceTypes.map(enhanceServiceType);
};

export default {
    enhanceServiceType,
    enhanceServiceTypes
}; 