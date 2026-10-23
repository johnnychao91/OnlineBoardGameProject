import { RoleGallery, type RoleGalleryEntry } from './RoleGallery';
import signalImage from './assets/art/ink-cipher-card.png';
import coverImage from './assets/art/ink-cover.png';
import pulseImage from './assets/art/ink-silent-pulse.png';

const entries: readonly RoleGalleryEntry[] = [
  {
    id: 'signal', name: '訊號牌', image: signalImage,
    category: '牌面 · 1～100 的數字訊號', tone: 'neutral', sampleNumber: 55,
    description: '每個頻段使用 1～100 的不重複訊號洗牌發放，全隊要由小到大傳送。你只能傳送自己手中最小的一張，不能透露數字或暗示時機。圖中的 55 是牌面範例，不是任何玩家的手牌。',
  },
  {
    id: 'cover', name: '掩護', image: coverImage,
    category: '道具 · 全隊共用資源', tone: 'friendly',
    description: '每次出現順序錯誤，全隊失去 1 點掩護，並棄掉所有被跳過的較小訊號。同一次漏掉多張也只扣 1 點；掩護歸零立即失敗。完成第 3、6、9 頻段可補充 1 點，最多持有 6 點。',
  },
  {
    id: 'pulse', name: '靜默脈衝', image: pulseImage,
    category: '道具 · 全隊共用資源', tone: 'friendly',
    description: '傳送期間可提議使用。全員同意後消耗 1 次，讓每位有牌的特務公開棄掉自己最小的一張，不扣掩護；任一人拒絕則不消耗。完成第 2、5、8 頻段可補充 1 次，最多持有 3 次。',
  },
];

export function CipherRulesGallery() {
  return <RoleGallery entries={entries} idPrefix="cipher-guide" />;
}
