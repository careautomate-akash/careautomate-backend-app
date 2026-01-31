/**
 * Calculates scheduled units based on service duration type
 * @param {String} durationType - "Daily" or "15 Minutes"
 * @param {Date} appointmentStartTime
 * @param {Date} appointmentEndTime
 * @param {Boolean} alreadyScheduledForDay - true if unit already counted for that same day
 * @returns {Number} unitsToAdd
 */
export function calculateScheduledUnits(
  durationType,
  appointmentStartTime,
  appointmentEndTime,
  alreadyScheduledForDay
) {
  // If daily duration, only charge once per day
  if (durationType === 'Daily') {
    if (alreadyScheduledForDay) {
      return 0;
    }
    return 1;
  }

  // Default processing for 15-min services
  const durationInMinutes =
    (appointmentEndTime - appointmentStartTime) / (1000 * 60);
  const unitCount = Math.ceil(durationInMinutes / 15);
  return unitCount;
}
