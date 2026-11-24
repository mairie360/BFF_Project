// Due dates (MAIR-559): the fronts' date pickers send a date alone (`2026-11-05`) while Project API stores a
// date-time. The BFF accepts both and always sends Project API a full UTC date-time.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
// ISO 8601 date-time with an explicit offset or `Z`, as `Date.toISOString()` and Project API write it.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Midnight UTC of a `YYYY-MM-DD` day, or `null` when it is not a real calendar day (`2026-02-30`). */
function dateOnlyToIso(value: string): string | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const sameDay = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return sameDay ? date.toISOString() : null;
}

function dateTimeToIso(value: string): string | null {
  if (!DATE_TIME.test(value)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** A due date the BFF accepts: empty (none), a date alone or an ISO 8601 date-time. */
export function isDueDate(value: string): boolean {
  return value === '' || dateOnlyToIso(value) !== null || dateTimeToIso(value) !== null;
}

/** The date-time to send Project API for a due date accepted by `isDueDate`, `null` when it is empty. */
export function toBackendDueDate(value: string): string | null {
  if (value === '') return null;
  return dateOnlyToIso(value) ?? dateTimeToIso(value);
}

/**
 * The day Project API records as the deadline of a project (`YYYY-MM-DD`) for a due date accepted by `isDueDate`,
 * `null` when it is empty. A date-time keeps the day it was written for (`2027-06-30T00:00:00+02:00` is the 30th),
 * not its UTC day.
 */
export function toBackendDeadline(value: string): string | null {
  if (value === '') return null;
  return dateOnlyToIso(value.slice(0, 10)) ? value.slice(0, 10) : null;
}

/** The project due date the contract returns for a recorded deadline: midnight UTC of that day. */
export function deadlineToIso(deadline: string): string {
  return `${deadline}T00:00:00.000Z`;
}
