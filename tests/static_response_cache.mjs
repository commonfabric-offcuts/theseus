// Native harness optimization only. Keep original successful HTTP bytes;
// errors remain visible and never become cached success on a later page.
export function staticResponseCache() {
  const entries = new Map();
  let tail = Promise.resolve();
  return {
    entries,
    async response(url, fetch) {
      const previous = tail;
      let release;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      try {
        let value = entries.get(url);
        if (!value) {
          const response = await fetch();
          value = { status: response.status(), body: await response.body(), headers: response.headers(), hits: 0 };
          if (value.status === 200) entries.set(url, value);
        }
        value.hits++;
        return value;
      } finally { release(); }
    },
  };
}
