import { useState } from "react";

function Frame({ id, src }: { id: string; src: string }) {
  const [offline, setOffline] = useState(false);
  return (
    <div className="desktop-frame">
      {offline ? (
        <div className="desktop-offline">desktop offline</div>
      ) : (
        <iframe
          title={id}
          src={src}
          onError={() => setOffline(true)}
        />
      )}
    </div>
  );
}

export function Desktops() {
  return (
    <div className="desktops">
      <Frame id="nova" src="/desktops/nova/" />
      <Frame id="forge" src="/desktops/forge/" />
    </div>
  );
}
