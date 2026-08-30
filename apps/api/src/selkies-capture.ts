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

export function injectSelkiesCapture(html: string): string {
  const tag = `<script>${selkiesCaptureScript()}</script>`;
  if (html.includes("</body>")) return html.replace("</body>", `${tag}</body>`);
  return html + tag;
}
