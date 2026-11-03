import { GAME_IDS, gameCatalog, type GameID } from '../games/catalog';
import './background-picker.css';

export interface BackgroundSelection {
  gameID: GameID;
  onChange: (value: string) => void;
}

export function BackgroundPicker({ gameID, onChange }: BackgroundSelection) {
  return <label className="background-picker"><span>背景</span><select aria-label="選擇遊戲背景" value={gameID} onChange={event => onChange(event.target.value)}>
    {GAME_IDS.map(id => <option key={id} value={id}>{gameCatalog[id].name}</option>)}
  </select></label>;
}
