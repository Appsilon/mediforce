const ISO_DURATION = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Milliseconds in an ISO 8601 duration (`P14D`, `PT2H30M`, `P1W`), or `null`
 * when the text is not one. Years and months are refused: their length depends
 * on the calendar, so the same timeout would mean different things per run.
 */
export function parseIsoDurationMs(text: string): number | null {
  const match = ISO_DURATION.exec(text);
  if (match === null || text === 'P' || text.endsWith('T')) return null;
  const [weeks, days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  return (
    (weeks * 7 + days) * MS_PER_DAY +
    hours * MS_PER_HOUR +
    minutes * MS_PER_MINUTE +
    seconds * MS_PER_SECOND
  );
}
