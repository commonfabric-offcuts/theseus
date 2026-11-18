// Native harness optimization only. Keep original successful HTTP bytes;
// errors remain visible and never become cached success on a later page.
export function staticResponseCache() {
  const entries = new Map();
  return {
    entries,
    async response(url, fetch) {
      let value = entries.get(url);
      if (!value) {
        const response = await fetch();
        value = { status: response.status(), body: await response.body(), headers: response.headers(), hits: 0 };
        if (value.status === 200) entries.set(url, value);
      }
      value.hits++;
      return value;
    },
  };
}
