// Animierte 3D-Modelle über den Wowhead-Modellviewer (ZamModelViewer).
// Die Modelldateien liegen gespiegelt unter modelviewer/<env>/ (siehe scripts/mirror-models.mjs).
// Fehlt die Spiegelung oder WebGL, zeigt die Seite die 2D-Renders.

window.Model3D = (() => {
  let ready = null;

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

  function supported() {
    try {
      return !!document.createElement('canvas').getContext('webgl');
    } catch {
      return false;
    }
  }

  // container braucht beim Aufruf eine feste Größe in Pixeln.
  async function mount(container, model, env) {
    await load(env);
    const rect = container.getBoundingClientRect();
    const viewer = await new window.ZamModelViewer({
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
    return viewer;
  }

  function play(viewer, animation) {
    try {
      viewer.renderer.actors[0].setAnimation(animation);
    } catch {
      // Modell noch nicht vollständig geladen.
    }
  }

  function destroy(viewer) {
    try {
      viewer?.destroy();
    } catch {
      // Viewer schon entfernt.
    }
  }

  return { supported, mount, play, destroy };
})();
