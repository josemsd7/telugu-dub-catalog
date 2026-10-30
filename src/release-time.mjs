export const RELEASE_TIME_ZONE='Asia/Kolkata';
const calendar=new Intl.DateTimeFormat('en-US',{timeZone:RELEASE_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});

// Release labels use India's calendar day. Audit timestamps and cache ages stay
// absolute instants, so moving the release calendar never changes cache TTLs.
export function indiaDate(value=Date.now()) {
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return null;
  const parts=Object.fromEntries(calendar.formatToParts(date).map(x=>[x.type,x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
