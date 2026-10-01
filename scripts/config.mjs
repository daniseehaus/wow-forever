// Gemeinsame Konfiguration für fetch.mjs und switch-forever.mjs.

// Ab dem Starttag (oder mit force) überschreibt der Block forever die übrigen Werte.
// forever.switchAt legt den genauen Zeitpunkt fest, sonst gilt der Starttag ab 00:00 UTC.
// Ohne eigene Charakterliste in forever bleibt die normale Liste.
export function resolveConfig(base, force = false, now = Date.now()) {
  const { forever, ...rest } = base;
  if (!forever) return rest;
  const at = Date.parse(forever.switchAt ?? `${base.launch}T00:00:00Z`);
  if (!force && !(now >= at)) return rest;
  const { switchAt, characters, ...values } = forever;
  return {
    ...rest,
    ...values,
    namespaces: { ...rest.namespaces, ...values.namespaces },
    characters: characters?.length ? characters : rest.characters,
  };
}
