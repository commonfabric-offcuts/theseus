import assert from 'node:assert/strict';

const BODY_LIMIT = 2048;
// Only failure response evidence is retained: no request, headers or arguments.
function redact(text, secrets) {
  let safe = String(text);
  for (const secret of secrets) if (secret) safe = safe.split(secret).join('[redacted]');
  return safe.replace(/(Bearer\s+)[^\s"<>]+/gi, '$1[redacted]')
    .replace(/("(?:token|access_token|refresh_token|identity_key|authorization|cookie|session|password)"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2');
}

export async function readNativeViewResponse(response, view, observations, secrets = []) {
  let text, readError;
  try { text = await response.text(); }
  catch (error) { readError = redact(error.message, secrets).slice(0, BODY_LIMIT); }
  const safe = text === undefined ? null : redact(text, secrets);
  const evidence = { name: 'native view response failure', view, status: response.status,
    body: safe === null ? null : safe.slice(0, BODY_LIMIT), bodyLimit: BODY_LIMIT,
    truncated: safe !== null && safe.length > BODY_LIMIT, ...(readError ? { readError } : {}) };
  const fail = reason => {
    observations.push(evidence);
    const error = new assert.AssertionError({ message: `${view}: ${reason}; HTTP ${evidence.status}; body: ${evidence.body}; readError: ${readError ?? "none"}` });
    error.evidence = evidence;
    throw error;
  };
  if (text === undefined) fail('response body could not be read');
  if (!response.ok) fail('HTTP request did not succeed');
  let result;
  try { result = JSON.parse(text); } catch { fail('response is not valid JSON'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('response must be an object');
  if ('error' in result || result.recorded === false) fail('response carries an error/refusal');
  if (view === 'message_acts' && !Array.isArray(result.items)) fail('message_acts.items must be an array');
  return result;
}
