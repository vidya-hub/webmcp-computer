import type { Computer, ComputerId } from "@webmcp-computer/contract";

type Props = {
  computers: Computer[];
  selectedComputer: ComputerId | null;
  actingComputerId: ComputerId | null;
  minimized: string[];
  computersRunning: number;
  onSelect: (id: ComputerId) => void;
  onSpawn: () => void;
};

export function Dock({
  computers,
  selectedComputer,
  actingComputerId,
  minimized,
  computersRunning,
  onSelect,
  onSpawn,
}: Props) {
  return (
    <nav className="dock" aria-label="computers">
      {computers.map((c) => {
        const selected = c.id === selectedComputer;
        const acting = c.id === actingComputerId;
        const min = minimized.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            title={c.name}
            className={`dock-tile${selected ? " selected" : ""}${acting ? " acting" : ""}${min ? " min" : ""}`}
            onClick={() => onSelect(c.id as ComputerId)}
          >
            <span className="dock-glyph">{c.name.slice(0, 2)}</span>
          </button>
        );
      })}
      <button
        type="button"
        className="dock-tile dock-spawn"
        aria-label="spawn computer"
        disabled={computersRunning >= 4}
        onClick={onSpawn}
      >
        <span className="dock-plus" />
      </button>
    </nav>
  );
}
