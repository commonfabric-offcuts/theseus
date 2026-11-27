// Media reads verify the bytes and their association with this exact source.
// Use the verified bytes as a download, including for file types a browser
// could otherwise run as an active document.
export async function openAttachment(control, { name, read, current, notice }) {
  if (control.getAttribute('aria-busy') === 'true' || !current()) return;
  control.setAttribute('aria-busy', 'true');
  try {
    const bytes = await read();
    if (!current()) return;
    const doc = control.ownerDocument;
    const url = doc.defaultView.URL.createObjectURL(bytes);
    const link = doc.createElement('a');
    link.href = url;
    link.download = name;
    try { link.click(); }
    finally { doc.defaultView.setTimeout(() => doc.defaultView.URL.revokeObjectURL(url), 1000); }
    notice('');
  } catch (error) {
    if (current()) notice(error);
  } finally {
    control.removeAttribute('aria-busy');
  }
}
