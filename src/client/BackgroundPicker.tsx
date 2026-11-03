import { gameCatalog } from '../games/catalog';
import { BACKGROUND_IDS, type BackgroundID } from './background-preference';
import './background-picker.css';

export interface BackgroundSelection {
  gameID: BackgroundID;
  onChange: (value: string) => void;
}

export function BackgroundPicker({ gameID, onChange }: BackgroundSelection) {
  return <label className="background-picker"><span>背景</span><select aria-label="選擇遊戲背景" value={gameID} onChange={event => onChange(event.target.value)}>
    {BACKGROUND_IDS.map(id => <option key={id} value={id}>{id === 'jiebao-studio' ? '捷寶桌遊室' : gameCatalog[id].name}</option>)}
  </select></label>;
}
