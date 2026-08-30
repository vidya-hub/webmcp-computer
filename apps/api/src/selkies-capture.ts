// Observe-only record capture for the Selkies (H.264) viewer. Same postMessage
// contract as vncViewerHtml(): record-step / record-flushed, origin-checked.
// Map coordinates through the <video> (or canvas) so they stay guest pixels.

export function selkiesCaptureScript(): string {
  return `
(function(){
  if (window.__webmcpRecord) return;
  window.__webmcpRecord = true;
  let recording = false;
  let replayLock = false;
  const KEYMAP = { Enter:"Return", Tab:"Tab", Backspace:"BackSpace", Escape:"Escape",
    Delete:"Delete", ArrowUp:"Up", ArrowDown:"Down", ArrowLeft:"Left", ArrowRight:"Right",
    Home:"Home", End:"End", PageUp:"Prior", PageDown:"Next", " ":"space" };
  let typeBuf = "";
  let typeTimer = 0;
  let down = null;
  function post(step){ try { window.parent.postMessage({ source:"webmcp", type:"record-step", step }, location.origin); } catch(e){} }
  function flushType(){ if(typeBuf){ post({ kind:"type", text: typeBuf }); typeBuf=""; } if(typeTimer){ clearTimeout(typeTimer); typeTimer=0; } }
  function surface(){ return document.querySelector("video") || document.querySelector("canvas"); }
  function fb(ev){
    const el = surface(); if(!el) return null;
    const r = el.getBoundingClientRect();
    if(!r.width || !r.height) return null;
    const w = el.videoWidth || el.width || 1280;
    const h = el.videoHeight || el.height || 800;
    return { x: Math.round((ev.clientX - r.left) * w / r.width),
             y: Math.round((ev.clientY - r.top) * h / r.height) };
  }
  const btn = (b) => b===2?"right":b===1?"middle":"left";
  function onDown(ev){ const p=fb(ev); if(!p) return; flushType(); down={ x:p.x, y:p.y, t:Date.now(), button:ev.button, moved:false }; }
  function onMove(ev){ if(!down) return; const p=fb(ev); if(!p) return; if(Math.abs(p.x-down.x)>4||Math.abs(p.y-down.y)>4) down.moved=true; }
  let lastClick = null;
  function onUp(ev){ if(!down) return; const p=fb(ev)||down;
    if(down.moved){ post({ kind:"drag", fromX:down.x, fromY:down.y, toX:p.x, toY:p.y }); lastClick=null; }
    else { const dbl = lastClick && (Date.now()-lastClick.t<400) && Math.abs(p.x-lastClick.x)<=4 && Math.abs(p.y-lastClick.y)<=4;
      post({ kind:"click", x:p.x, y:p.y, button:btn(down.button), clicks: dbl?2:1 });
      lastClick = dbl ? null : { x:p.x, y:p.y, t:Date.now() }; }
    down=null; }
  function onWheel(ev){ const p=fb(ev); if(!p) return; flushType(); post({ kind:"scroll", x:p.x, y:p.y, dy: ev.deltaY<0?-1:1 }); }
  function onKey(ev){
    const mods=[]; if(ev.ctrlKey)mods.push("ctrl"); if(ev.altKey)mods.push("alt"); if(ev.metaKey)mods.push("super");
    const printable = ev.key.length===1 && mods.length===0;
    if(printable && ev.key!==" "){ typeBuf+=ev.key; if(typeTimer)clearTimeout(typeTimer); typeTimer=setTimeout(flushType,400); return; }
    flushType();
    const base = KEYMAP[ev.key] || (ev.key.length===1 ? ev.key.toLowerCase() : ev.key);
    const chord = ev.shiftKey && mods.length ? [...mods,"shift",base].join("+") : [...mods,base].join("+");
    post({ kind:"key", keys: chord });
  }
  function setRecording(on){
    if(on===recording) return;
    recording = on;
    const opts = { capture:true, passive:true };
    const root = document;
    if(on){
      root.addEventListener("pointerdown",onDown,opts);
      root.addEventListener("pointermove",onMove,opts);
      root.addEventListener("pointerup",onUp,opts);
      root.addEventListener("wheel",onWheel,opts);
      window.addEventListener("keydown",onKey,{ capture:true });
    } else {
      flushType();
      root.removeEventListener("pointerdown",onDown,opts);
      root.removeEventListener("pointermove",onMove,opts);
      root.removeEventListener("pointerup",onUp,opts);
      root.removeEventListener("wheel",onWheel,opts);
      window.removeEventListener("keydown",onKey,{ capture:true });
      down=null; lastClick=null;
      try { window.parent.postMessage({ source:"webmcp", type:"record-flushed" }, location.origin); } catch(e){}
    }
  }
  window.addEventListener("message",(ev)=>{
    if(ev.origin!==location.origin) return;
    const d=ev.data;
    if(!d || d.source!=="webmcp") return;
    if(d.type==="record") setRecording(!!d.on);
    else if(d.type==="replay"){ replayLock=!!d.on; }
  });
})();
`;
}

export function selkiesTakeoverScript(): string {
  return `
(function(){
  if (window.__webmcpTakeover) return;
  window.__webmcpTakeover = true;
  const HIT = /new primary client|connection killed|connection terminated/i;
  function show(){
    if (document.getElementById("webmcp-takeover")) return;
    const d = document.createElement("div");
    d.id = "webmcp-takeover";
    d.setAttribute("role","dialog");
    d.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#0a0a0c;color:#e8e8e8;font:13px/1.45 -apple-system,system-ui,sans-serif;flex-direction:column;gap:14px;text-align:center;padding:24px";
    d.innerHTML = "<p style=\\"margin:0;max-width:28em\\">This desktop is open in another tab. Selkies allows one viewer.</p><button type=\\"button\\" style=\\"background:#fff;color:#111;border:0;border-radius:8px;padding:8px 16px;font:inherit;cursor:pointer\\">Use this tab</button>";
    d.querySelector("button").onclick = function(){ location.reload(); };
    document.documentElement.appendChild(d);
  }
  function scan(){
    const t = document.body && document.body.innerText;
    if (t && HIT.test(t)) show();
  }
  const obs = new MutationObserver(scan);
  function arm(){
    obs.observe(document.documentElement, { childList:true, subtree:true, characterData:true });
    scan();
  }
  if (document.body) arm();
  else document.addEventListener("DOMContentLoaded", arm);
})();
`;
}

export function selkiesFpsScript(): string {
  return `
(function(){
  if (window.__webmcpFps) return;
  window.__webmcpFps = true;
  const id = decodeURIComponent((location.pathname.match(/\\/desktops\\/([^/]+)/)||[])[1]||"");
  let frames = 0, prevQ = 0, last = performance.now(), el = null, hooked = false, got = false;
  function video(){ return document.querySelector("video"); }
  function onRVFC(){
    const v = video();
    if (v !== el) return;
    frames++;
    got = true;
    if (v && v.requestVideoFrameCallback) v.requestVideoFrameCallback(onRVFC);
  }
  function arm(){
    const v = video();
    if (v !== el) { el = v; hooked = false; prevQ = 0; }
    if (v && v.requestVideoFrameCallback && !hooked) {
      hooked = true;
      v.requestVideoFrameCallback(onRVFC);
    }
  }
  setInterval(function(){
    arm();
    const now = performance.now();
    const dt = Math.max(0.001, (now-last)/1000);
    last = now;
    const v = video();
    let fps = frames / dt;
    frames = 0;
    if (v && v.getVideoPlaybackQuality) {
      const n = v.getVideoPlaybackQuality().totalVideoFrames;
      if (!got) fps = (n - prevQ) / dt;
      prevQ = n;
    }
    got = false;
    if (!id || !v) return;
    try {
      window.parent.postMessage({ source:"webmcp", type:"fps", id:id, fps:Math.round(fps) }, location.origin);
    } catch(e){}
  }, 500);
  arm();
})();
`;
}

export function injectSelkiesCapture(html: string): string {
  const tag = `<script>${selkiesCaptureScript()}</script><script>${selkiesTakeoverScript()}</script><script>${selkiesFpsScript()}</script>`;
  if (html.includes("</body>")) return html.replace("</body>", `${tag}</body>`);
  return html + tag;
}
