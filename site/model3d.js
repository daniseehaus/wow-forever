// Animierte 3D-Modelle über den Wowhead-Modellviewer (ZamModelViewer).
// Die Modelldateien liegen gespiegelt unter modelviewer/<env>/ (siehe scripts/mirror-models.mjs).
// Fehlt die Spiegelung oder WebGL, zeigt die Seite die 2D-Renders.
//
// Die Viewer bauen nacheinander auf: Ein Modell braucht 10 bis 30 MB Dateien und viel Rechenzeit.
// Laufen alle gleichzeitig, teilen sie sich die Leitung und alle Modelle ruckeln, bis das letzte fertig ist.
// Ein Viewer bleibt unsichtbar, bis sein Modell vollständig geladen ist.
//
// Jeder Viewer zeichnet in einer eigenen Schleife, auch außerhalb des Bildes. Sechs Viewer belegen so den
// halben Hauptthread. pace() begrenzt deshalb die Bildrate und lässt Viewer außerhalb des Bildes aus.

window.Model3D = (() => {
  let ready = null;
  let gl = null;
  const queue = [];
  let busy = false;
  let lastFile = 0;
  // Ein Rand von 200 px: Der Viewer läuft schon, bevor er ins Bild scrollt. Man sieht ihn nie stehen.
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => entries.forEach((e) => { e.target.inView = e.isIntersecting; }), { rootMargin: '200px 0px' })
    : null;

  function load(env) {
    if (ready) return ready;
    const base = `modelviewer/${env}/`;
    window.CONTENT_PATH = base;
    window.WH = window.WH || {};
    Object.assign(window.WH, {
      debug() {},
      defaultAnimation: 'Stand',
      WebP: { getImageExtension: () => '.webp' },
      Wow: { Item: { INVENTORY_TYPE_SHOULDERS: 3, INVENTORY_TYPE_ROBE: 20, INVENTORY_TYPE_CHEST: 5 } },
    });
    // Die letzte fertig geladene Modelldatei zeigt, ob der aktuelle Viewer noch Dateien nachlädt.
    try {
      new PerformanceObserver((list) => {
        if (list.getEntries().some((e) => e.name.includes('/modelviewer/'))) lastFile = performance.now();
      }).observe({ type: 'resource' });
    } catch {}
    ready = (async () => {
      const probe = await fetch(`${base}viewer/viewer.min.js`, { method: 'HEAD' }).catch(() => null);
      if (!probe?.ok) throw new Error('Keine gespiegelten Modelldateien gefunden.');
      if (!window.jQuery) await script('https://code.jquery.com/jquery-3.7.1.min.js');
      await script(`${base}viewer/viewer.min.js`);
    })();
    return ready;
  }

  function script(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Skript nicht geladen: ${src}`));
      document.head.append(s);
    });
  }

  // Einmal prüfen und den Test-Kontext gleich wieder freigeben. Der Browser erlaubt nur wenige WebGL-Kontexte.
  function supported() {
    if (gl != null) return gl;
    try {
      const ctx = document.createElement('canvas').getContext('webgl');
      gl = !!ctx;
      ctx?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      gl = false;
    }
    return gl;
  }

  // container braucht beim Aufruf eine feste Größe in Pixeln.
  // Das Versprechen erfüllt sich erst, wenn das Modell fertig geladen ist.
  // priority stellt den Viewer an den Anfang der Warteschlange (Loadout vor den Kacheln).
  // fps begrenzt die Bildrate nach dem Laden. onStart meldet, wann der Aufbau wirklich beginnt.
  function mount(container, model, env, { priority = false, fps = 60, onStart = null } = {}) {
    return new Promise((resolve, reject) => {
      const job = { container, model, env, fps, onStart, resolve, reject };
      if (priority) queue.unshift(job);
      else queue.push(job);
      // Erst nach dem aktuellen Aufbau der Seite starten, damit ein Loadout im selben Durchlauf vorne steht.
      setTimeout(next);
    });
  }

  async function next() {
    if (busy || !queue.length) return;
    busy = true;
    const job = queue.shift();
    let viewer = null;
    try {
      // Inzwischen aus der Seite entfernt (anderer Charakter gewählt, 3D aus): nicht mehr laden.
      if (!document.body.contains(job.container)) throw new Error('Viewer nicht mehr benötigt.');
      job.onStart?.();
      viewer = await create(job.container, job.model, job.env);
      await loaded(viewer, job.container);
      pace(viewer, job.container, job.fps);
      job.container.classList.add('ready');
      job.resolve(viewer);
    } catch (err) {
      destroy(viewer);
      job.reject(err);
    } finally {
      busy = false;
      next();
    }
  }

  async function create(container, model, env) {
    await load(env);
    const rect = container.getBoundingClientRect();
    return new window.ZamModelViewer({
      type: 2,
      contentPath: window.CONTENT_PATH,
      container: window.jQuery(container),
      aspect: rect.width / Math.max(rect.height, 1),
      hd: env === 'live',
      ...(env === 'classic' ? { dataEnv: 'classic', env: 'classic', gameDataEnv: 'classic' } : {}),
      models: { id: model.race * 2 - 1 + model.gender, type: 16 },
      charCustomization: { options: model.options },
      items: model.items,
    });
  }

  // Fertig heißt: Modell geladen und seit einer halben Sekunde keine neue Datei (Items, Texturen).
  // Nach 30 Sekunden geht es trotzdem weiter, damit ein hängendes Modell die anderen nicht blockiert.
  async function loaded(viewer, container) {
    const start = performance.now();
    lastFile = start;
    while (performance.now() - start < 30000) {
      await new Promise((r) => setTimeout(r, 150));
      if (!document.body.contains(container) || viewer.renderer?.stop) throw new Error('Viewer nicht mehr benötigt.');
      const actors = viewer.renderer?.actors ?? [];
      const done = actors.length && actors.every((a) => a.isLoaded?.());
      if (done && performance.now() - lastFile > 500) return;
    }
    throw new Error('3D-Modell nicht vollständig geladen.');
  }

  // Der Viewer ruft draw(t) in jedem Bild auf. Hier zeichnet er höchstens fps-mal pro Sekunde
  // und gar nicht, solange seine Bühne weit außerhalb des Bildes liegt.
  // draw(t) rechnet mit dem Abstand zum letzten Bild. Ausgelassene Bilder ändern das Tempo der Animation nicht.
  function pace(viewer, box, fps) {
    const r = viewer.renderer;
    if (typeof r?.draw !== 'function') return;
    const draw = r.draw.bind(r);
    const frame = 1000 / fps;
    let last = 0;
    let paused = false;
    io?.observe(box);
    viewer.box = box;
    r.draw = (t) => {
      if (box.inView === false) { paused = true; return; }
      // 2 ms Spielraum: Die Zeitstempel der Bilder schwanken leicht.
      if (t - last < frame - 2) return;
      // Nach einer Pause läuft die Animation dort weiter, wo sie stand.
      if (paused) { r.time = t - frame; paused = false; }
      last = t;
      draw(t);
    };
  }

  function play(viewer, animation) {
    try {
      viewer.renderer.actors[0].setAnimation(animation);
    } catch {
      // Modell noch nicht vollständig geladen.
    }
  }

  function destroy(viewer) {
    if (viewer?.box) io?.unobserve(viewer.box);
    try {
      viewer?.destroy();
    } catch {
      // Viewer schon entfernt.
    }
  }

  return { supported, mount, play, destroy };
})();
