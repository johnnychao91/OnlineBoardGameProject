import { RoleGallery, type RoleGalleryEntry } from './RoleGallery';
import engineerImage from './assets/art/ink-engineer.png';
import saboteurImage from './assets/art/ink-saboteur.png';
import stableImage from './assets/art/ink-stable-equipment.png';
import repairImage from './assets/art/ink-repair-module.png';
import hazardImage from './assets/art/ink-reactor-crisis.png';

const entries: readonly RoleGalleryEntry[] = [
  {
    id: 'engineer', name: '維修員', image: engineerImage,
    category: '角色 · 維修員陣營', tone: 'friendly',
    description: '在期限內找齊全部 N 張維修模組，維修員陣營立即獲勝。你的身分整局固定；你只能查看自己的身分與設備組成，不能看到暗牌的實際位置。',
  },
  {
    id: 'saboteur', name: '干擾者', image: saboteurImage,
    category: '角色 · 干擾者陣營', tone: 'hostile',
    description: '反應爐危機被揭開，或第四輪的檢修額度用盡仍未找齊全部維修模組，干擾者陣營即獲勝。你可以藉由宣稱與討論影響檢修選擇，但也不知道暗牌的實際位置。',
  },
  {
    id: 'stable', name: '穩定設備', image: stableImage,
    category: '設備 · 檢修牌', tone: 'neutral',
    description: '開局共有 4N−1 張。翻開後不增加維修進度，但仍消耗一次檢修額度；牌面留在原位置，讓全員查看。',
  },
  {
    id: 'repair', name: '維修模組', image: repairImage,
    category: '設備 · 維修目標', tone: 'friendly',
    description: '開局共有 N 張。每揭開一張，維修進度增加 1；全部找齊時，維修員陣營立即獲勝。已揭開的模組不會在換輪時重新發放。',
  },
  {
    id: 'hazard', name: '反應爐危機', image: hazardImage,
    category: '設備 · 危險牌', tone: 'hostile',
    description: '整局只有 1 張。一旦被檢修揭開，任務立即結束，干擾者陣營獲勝；未揭開時會和其他剩餘設備一起重新洗勻發放。',
  },
];

export function StationRulesGallery() {
  return <RoleGallery entries={entries} idPrefix="station-guide" />;
}
