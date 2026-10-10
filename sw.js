/* JR Prestamito PRO - Service Worker v5
   - Abre la app AL INSTANTE (con o sin internet) usando la copia guardada.
   - Por detrás revisa si en GitHub hay una versión nueva; si la hay, la guarda APARTE y la app muestra
     un aviso "Hay una versión nueva · Actualizar". La app NO cambia de versión hasta que toques
     "Actualizar" (ni al recargar, ni al cerrar y abrir). Mientras tanto el aviso vuelve a salir al abrir.
   - Tus datos (clientes, préstamos) NO viven aquí: están en el almacenamiento del navegador.
   Para forzar que todos los celulares empiecen de cero, cambia CACHE_VERSION (v5, v6...). */
const CACHE_VERSION = "jrp-pro-v5";
const APP = "./index.html";
const NUEVA = "./index-nueva.html";   // versión nueva guardada aparte, en espera de que toques Actualizar

self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(c){
      // cache:"reload" = baja una copia fresca (no la que el navegador tenga a medias)
      return c.add(new Request(APP, { cache: "reload" })).catch(function(){});
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(ks){
      // Solo borra copias viejas DE ESTA app (jrp-pro-...), nunca las de otras apps del mismo sitio.
      return Promise.all(ks.filter(function(k){ return k.indexOf("jrp-pro-") === 0 && k !== CACHE_VERSION; })
                           .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// "Huella" del contenido para saber si la app cambió (más fiable que comparar fechas).
async function huella(resp){
  const buf = await resp.clone().arrayBuffer();
  const h = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(h)).map(function(x){ return x.toString(16).padStart(2, "0"); }).join("");
}

function avisarNuevaVersion(){
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(cs){
    cs.forEach(function(c){ c.postMessage({ tipo: "jr-nueva-version" }); });
  });
}

// Por detrás: pregunta a GitHub si hay algo nuevo. "no-cache" = pregunta si cambió y, si no
// cambió, casi no gasta datos. La versión nueva se guarda APARTE (NUEVA): no reemplaza a la
// que estás usando hasta que toques "Actualizar".
async function buscarNueva(url){
  try{
    const resp = await fetch(new Request(url, { cache: "no-cache" }));
    if(!resp || !resp.ok || resp.redirected) return;
    const cache = await caches.open(CACHE_VERSION);
    const actual = await cache.match(APP);
    if(actual && (await huella(actual)) === (await huella(resp))){
      await cache.delete(NUEVA);                  // ya estás en la última: nada pendiente
      return;
    }
    if(!actual){ await cache.put(APP, resp.clone()); return; }   // no había copia: se usa directo
    await cache.put(NUEVA, resp.clone());
    await avisarNuevaVersion();
  }catch(err){}
}

// Al tocar "Actualizar": la versión nueva pasa a ser la que se usa.
async function aplicarNueva(){
  const cache = await caches.open(CACHE_VERSION);
  let nueva = await cache.match(NUEVA);
  if(!nueva){                                      // por si se perdió: se vuelve a pedir
    try{
      const r = await fetch(new Request(APP, { cache: "reload" }));
      if(r && r.ok && !r.redirected) nueva = r;
    }catch(err){}
  }
  if(nueva){ await cache.put(APP, nueva.clone()); }
  await cache.delete(NUEVA);
}

self.addEventListener("message", function(e){
  if(!e.data || e.data.tipo !== "jr-aplicar") return;
  const origen = e.source;
  e.waitUntil(aplicarNueva().then(function(){
    if(origen) origen.postMessage({ tipo: "jr-aplicada" });
  }));
});

function paginaSinConexion(){
  const html = "<!doctype html><html lang='es'><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width,initial-scale=1'><title>JR Prestamito</title></head>" +
    "<body style=\"margin:0;font-family:sans-serif;background:#1B2A4A;color:#fff;text-align:center;padding:60px 24px\">" +
    "<h2>Sin conexión</h2><p>Abre la app una vez con internet para poder usarla sin conexión.</p>" +
    "<button onclick='location.reload()' style='margin-top:18px;padding:12px 26px;border:0;border-radius:12px;" +
    "background:#C9973E;color:#1B2A4A;font-weight:700;font-size:16px'>Reintentar</button></body></html>";
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function paginaApp(e, req){
  const cache = await caches.open(CACHE_VERSION);
  const guardada = await cache.match(APP);
  if(guardada){
    e.waitUntil(buscarNueva(req.url));      // en segundo plano, sin hacerte esperar
    return guardada;                        // abre al instante
  }
  try{                                      // primera vez (todavía no hay copia)
    const resp = await fetch(req);
    if(resp && resp.ok && !resp.redirected) await cache.put(APP, resp.clone());
    return resp;
  }catch(err){
    return paginaSinConexion();
  }
}

function archivoLocal(req){
  return caches.open(CACHE_VERSION).then(function(c){
    return c.match(req).then(function(hit){
      const red = fetch(req).then(function(resp){
        if(resp && resp.ok) c.put(req, resp.clone());
        return resp;
      }).catch(function(){ return null; });
      return hit || red.then(function(r){ return r || Response.error(); });
    });
  });
}

self.addEventListener("fetch", function(e){
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;   // la nube (Supabase), WhatsApp, etc.: directo a la red
  if(req.mode === "navigate"){ e.respondWith(paginaApp(e, req)); return; }
  e.respondWith(archivoLocal(req));                  // iconos y demás archivos de la misma carpeta
});
