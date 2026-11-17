// Kept independent of the native harness so its comparison can be checked locally
// and serialized into the browser's per-frame sampler without a second implementation.
export function sameNotebookButtons(before, after) {
  // Checks 44147041641's three WebKit original-layout controls drifted only in y:
  // 0.16357421875, 0.079345703125 and 0.151123046875 CSS px. Round the maximum
  // up to the next hundredth: 0.17, not a whole pixel. Compare every coordinate
  // and size against the original baseline (never against the preceding frame).
  const tolerance = 0.17;
  const dimensions = ['x', 'y', 'width', 'height'];
  const labels = ['Text', 'Cards', 'Draft'];
  const valid = rows => Array.isArray(rows) && (rows.length === 2 || rows.length === 3) &&
    Array.from(rows).every((row, i) => row && !Array.isArray(row) && row.words === labels[i] &&
      Object.keys(row).sort().join(',') === 'height,width,words,x,y' &&
      dimensions.every(key => Number.isFinite(row[key])) &&
      row.width > 0 && row.height > 0);
  return valid(before) && valid(after) && before.length === after.length &&
    before.every((row, i) => dimensions.every(key => Math.abs(row[key] - after[i][key]) <= tolerance));
}
