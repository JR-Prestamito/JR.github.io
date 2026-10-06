const CACHE = "jr-prestamito-v1";
const BASE = ["./", "./index.html"];

self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return Promise.all(BASE.map(function(u){ return c.add(u).catch(function(){}); }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(ks){
      return Promise.all(ks.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(e){
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  if(req.mode === "navigate"){
    e.respondWith(
      new Promise(function(resolve){
        let listo = false;
        const usarCopia = function(){
          caches.match(req, {ignoreSearch:true})
            .then(function(r){ return r || caches.match("./index.html") || caches.match("./"); })
            .then(function(r){ if(!listo){ listo = true; resolve(r || Response.error()); } });
        };
        const t = setTimeout(usarCopia, 4000);
        // cache:"no-cache" obliga al navegador a preguntarle al servidor si hay version nueva,
        // asi una actualizacion se ve al abrir la app y no unos minutos despues.
        fetch(req, {cache:"no-cache"}).then(function(resp){
          clearTimeout(t);
          if(resp && resp.ok){
            const copia = resp.clone();
            caches.open(CACHE).then(function(c){ c.put(req, copia.clone()); c.put("./index.html", copia); });
          }
          if(!listo){ listo = true; resolve(resp); }
        }).catch(function(){ clearTimeout(t); usarCopia(); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function(hit){
      const red = fetch(req).then(function(resp){
        if(resp && resp.ok){ const copia = resp.clone(); caches.open(CACHE).then(function(c){ c.put(req, copia); }); }
        return resp;
      }).catch(function(){ return hit; });
      return hit || red;
    })
  );
});
