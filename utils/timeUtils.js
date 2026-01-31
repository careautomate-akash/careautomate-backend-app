/**
 * Backend utility functions for time formatting and conversion
 */

/**
 * Convert 12-hour time to 24-hour format
 * @param {string} hour - Hour (1-12)
 * @param {string} minute - Minute (00-59)
 * @param {string} period - AM or PM
 * @returns {string} - Time in 24-hour format (e.g., "14:30")
 */
export const convert12To24Hour = (hour, minute, period) => {
    if (!hour || !minute || !period) return null;

    let hour24 = parseInt(hour, 10);

    if (period === 'AM' && hour24 === 12) {
        hour24 = 0;
    } else if (period === 'PM' && hour24 !== 12) {
        hour24 += 12;
    }

    return `${hour24.toString().padStart(2, '0')}:${minute}`;
};

/**
 * Convert 24-hour time to 12-hour format
 * @param {string} time24 - Time in 24-hour format (e.g., "14:30")
 * @returns {object} - Object with hour, minute, period
 */
export const convert24To12Hour = (time24) => {
    if (!time24) return { hour: '', minute: '', period: 'AM' };

    const [hour24, minute] = time24.split(':');
    const hour = parseInt(hour24, 10);
    const minute12 = minute || '00';

    let hour12 = hour % 12;
    if (hour12 === 0) hour12 = 12;

    const period = hour >= 12 ? 'PM' : 'AM';

    return {
        hour: hour12.toString().padStart(2, '0'),
        minute: minute12,
        period
    };
};

/**
 * Parse time from Date object and return 12-hour format
 * @param {Date} dateObj - Date object
 * @returns {object} - Object with hour, minute, period
 */
export const parseDateTo12Hour = (dateObj) => {
    if (!dateObj || !(dateObj instanceof Date)) {
        return { hour: '', minute: '', period: 'AM' };
    }

    const hours = dateObj.getHours();
    const minutes = dateObj.getMinutes();

    let hour12 = hours % 12;
    if (hour12 === 0) hour12 = 12;

    const period = hours >= 12 ? 'PM' : 'AM';

    return {
        hour: hour12.toString().padStart(2, '0'),
        minute: minutes.toString().padStart(2, '0'),
        period
    };
};

/**
 * Format time for display in 12-hour format
 * @param {Date|string} timeInput - Time input
 * @returns {string} - Formatted time string (e.g., "2:30 PM")
 */
export const formatTime12Hour = (timeInput) => {
    if (!timeInput) return '';

    let dateObj;
    if (typeof timeInput === 'string') {
        dateObj = new Date(timeInput);
    } else {
        dateObj = timeInput;
    }

    if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
        return '';
    }

    const { hour, minute, period } = parseDateTo12Hour(dateObj);

    // Remove leading zero from hour for display
    const displayHour = parseInt(hour, 10).toString();

    return `${displayHour}:${minute} ${period}`;
};

/**
 * Validate time components
 * @param {string} hour - Hour (1-12)
 * @param {string} minute - Minute (00-59)
 * @param {string} period - AM or PM
 * @returns {boolean} - True if valid
 */
export const isValidTime = (hour, minute, period) => {
    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);

    return (
        hourNum >= 1 && hourNum <= 12 &&
        minuteNum >= 0 && minuteNum <= 59 &&
        (period === 'AM' || period === 'PM')
    );
};

/**
 * Create UTC date with time components
 * @param {number} year - Year
 * @param {number} month - Month (0-11)
 * @param {number} day - Day (1-31)
 * @param {string} hour - Hour (1-12)
 * @param {string} minute - Minute (00-59)
 * @param {string} period - AM or PM
 * @returns {Date} - UTC Date object
 */
export const createUTCDateWithTime = (year, month, day, hour, minute, period) => {
    const time24 = convert12To24Hour(hour, minute, period);
    if (!time24) return null;

    const [hour24, minute24] = time24.split(':').map(Number);
    return new Date(Date.UTC(year, month, day, hour24, minute24));
};

/**
 * Parse ISO date string and extract date components
 * @param {string} isoDateString - ISO date string
 * @returns {object} - Object with year, month, day
 */
export const parseISODate = (isoDateString) => {
    if (!isoDateString) return null;

    const dateObj = new Date(isoDateString);
    if (isNaN(dateObj.getTime())) return null;

    return {
        year: dateObj.getFullYear(),
        month: dateObj.getMonth(),
        day: dateObj.getDate()
    };
};

/**
 * Convert local time to UTC preserving date
 * @param {string} dateString - Date string
 * @param {string} timeString - Time string in 24-hour format
 * @returns {Date} - UTC Date object
 */
export const createUTCDateTime = (dateString, timeString) => {
    if (!dateString || !timeString) return null;

    const dateObj = new Date(dateString);
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth();
    const day = dateObj.getDate();

    const [hours, minutes] = timeString.split(':').map(Number);

    return new Date(Date.UTC(year, month, day, hours, minutes));
}; 