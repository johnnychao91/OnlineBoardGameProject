import { useId, useState } from 'react';
import './snapshot-layout.css';

export function useInspectedPlayer(playerIDs: string[]) {
  const [selectedID, setSelectedID] = useState(playerIDs[0] ?? '');
  // Saved frames can contain different occupied seats. Never inspect a missing seat.
  return [playerIDs.includes(selectedID) ? selectedID : playerIDs[0] ?? '', setSelectedID] as const;
}

export function SnapshotPlayerSelect({ playerIDs, value, onChange, nameOf, label }: {
  playerIDs: string[]; value: string; onChange: (id: string) => void;
  nameOf: (id: string) => string; label: string;
}) {
  const id = useId();
  return <div className="snapshot-player-select">
    <label htmlFor={id}>{label}</label>
    <select id={id} value={value} onChange={event => onChange(event.target.value)}>
      {playerIDs.map(playerID => <option key={playerID} value={playerID}>{nameOf(playerID)}</option>)}
    </select>
  </div>;
}
