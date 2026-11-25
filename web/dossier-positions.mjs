// Response-local decoding only. Core supplies every root, cover and revision.
export const POSITION_FORMAT = 'root-table-v1';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const refused = () => { throw Error('The dossier positions could not be confirmed.'); };
export const offeredPositionFormat = answer =>
  Array.isArray(answer?.read_formats?.dossier_positions) &&
  answer.read_formats.dossier_positions.includes(POSITION_FORMAT) ? POSITION_FORMAT : null;

export function expandPositions(answer) {
  if (!object(answer) || answer.error) return answer;
  if (!own(answer, 'position_format')) {
    // A complete legacy answer is a valid fallback, never a partial reference.
    if (own(answer, 'positions') || answer.items?.some(row => own(row, 'stack_position_ref') || own(row?.acts ?? {}, 'cover_ref'))) refused();
    return answer;
  }
  if (answer.position_format !== POSITION_FORMAT || !object(answer.positions) || !Array.isArray(answer.items)) refused();
  const used = new Set(), rows = answer.items.map(row => {
    if (!object(row) || typeof (row.id ?? row.message_id) !== 'string' || !(row.id ?? row.message_id) || own(row, 'stack_position') || typeof row.stack_position_ref !== 'string' || !row.stack_position_ref) refused();
    const root = row.stack_position_ref;
    if (!own(answer.positions, root)) refused();
    const position = answer.positions[root];
    if (!object(position) || position.root_id !== root || !own(position, 'cover') ||
        position.cover !== null && (!object(position.cover) || position.cover.root_id !== root)) refused();
    used.add(root);
    const expanded = { ...row, stack_position: copy(position) };
    delete expanded.stack_position_ref;
    if (object(row.acts) && own(row.acts, 'cover_ref')) {
      if (row.acts.cover_ref !== root || row.id !== root || own(row.acts, 'cover') || position.cover === null) refused();
      expanded.acts = { ...row.acts, cover: copy(position.cover) };
      delete expanded.acts.cover_ref;
    }
    return expanded;
  });
  if (Object.keys(answer.positions).some(root => !used.has(root))) refused();
  const expanded = { ...answer, items: rows };
  delete expanded.positions;
  delete expanded.position_format;
  return expanded;
}
