type Props = {
  webmcpReady: boolean;
  approval: boolean;
  onTimeline: () => void;
};

export function MenuBar({ webmcpReady, approval, onTimeline }: Props) {
  return (
    <header className="menubar">
      <span className="menubar-app">webmcp-computer</span>
      <button type="button" className="menubar-item" onClick={onTimeline}>
        Action TimeLine
      </button>
      <span className="menubar-right">
        {approval ? <span className="menubar-warn">! approval</span> : null}
        <span className="menubar-extra">
          {webmcpReady ? "WebMCP  ready" : "WebMCP  missing"}
        </span>
      </span>
    </header>
  );
}
