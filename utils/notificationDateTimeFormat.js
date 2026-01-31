export function formatDateAndTimeForNotificationWithTimezone(
  dateString,
  timeString,
  timezone
) {
  const date = new Date(dateString);
  const time = new Date(timeString);

  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return formatter.format(time); // or use both date/time together if needed
}
