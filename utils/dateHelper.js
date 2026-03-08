/**
 * Format a Date to 'YYYY-MM-DD' in LOCAL timezone.
 * Avoids the UTC shift bug from .toISOString().split('T')[0].
 */
function localDateStr(d) {
  if (!d) return null;
  if (!(d instanceof Date)) d = new Date(d);
  if (isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

module.exports = { localDateStr };
