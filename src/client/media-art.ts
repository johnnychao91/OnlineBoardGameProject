import { GAME_IDS, gameCatalog } from '../games/catalog';
import type { MediaID } from '../games/media-route';

const assets = import.meta.glob<string>('./assets/**/*.{avif,jpeg,jpg,png,svg,webp}', {
  eager: true, import: 'default', query: '?url&no-inline',
});
const splitFolder = 'art/source-layers/';

export const mediaGames = [{ id: 'endless-bar' as const, name: '未央酒肆' },
  ...GAME_IDS.map(id => ({ id, name: gameCatalog[id].name }))];
export const mediaSections = [
  { id: 'subject', name: '透明主體' },
  { id: 'background', name: '背景' },
  { id: 'composite', name: '原始牌面' },
  { id: 'other', name: '牌框、標誌與其他美術' },
] as const;
type SectionID = typeof mediaSections[number]['id'];
type MediaAsset = { url: string; name: string; filename: string };
type MediaSections = Record<SectionID, MediaAsset[]>;

const folders: Record<MediaID, readonly string[]> = {
  'endless-bar': ['endlessbar-logo-transparent', 'site-icon', 'art/endless-bar-tavern', 'art/home-table'],
  'space-station': ['art/ink-space-station', 'art/ink-engineer', 'art/ink-saboteur', 'art/ink-stable-equipment', 'art/ink-repair-module', 'art/ink-reactor-crisis', 'art/ink-chief-engineer', 'art/ink-reactor-savior', 'art/ink-stabilized-reactor'],
  'encrypted-call': ['art/ink-cipher-', 'art/ink-cover', 'art/ink-silent-pulse'],
  'black-fog': ['art/fog/'],
  'silver-moon': ['art/moon/'],
  'turing-test': ['art/turing/'],
  'midnight-post': ['post/'],
  'baker-street': ['baker/'],
  'hundred-ghosts': ['banquet/'],
  'curtain-heist': ['heist/'],
  'firewall-breach': ['firewall/'],
  'star-workshop': ['star/'],
  'cup-echo': ['echo/', 'art/cup-echo-tavern'],
};

const standaloneSubjects = new Set([
  'endlessbar-logo-transparent', 'baker/badge', 'baker/chess-marker', 'baker/objects/boot',
  'banquet/coin', 'banquet/court', 'heist/bank', 'firewall/credit', 'echo/sealed-cup', 'echo/open-cup',
]);

const mediaAssets = new Map(Object.entries(assets).map(([path, url]) => [path.slice('./assets/'.length), url]));

function sectionFor(key: string, stem: string): SectionID {
  if (key.startsWith(splitFolder)) return key.endsWith('/background.webp') ? 'background' : 'subject';
  if (mediaAssets.has(splitFolder + stem + '/subject.webp')) return 'composite';
  const leaf = stem.split('/').at(-1)!;
  if (/^(background|city|train|lab|scene(?:-.+)?|card-paper|ink-space-station|ink-cipher-room|.*-tavern|home-table-v1)$/.test(leaf)) return 'background';
  if (standaloneSubjects.has(stem) || /^star\/tokens\//.test(stem)) return 'subject';
  if (/^art\/(?:fog\/|moon\/|turing\/(?:core|terminal)$|ink-)/.test(stem) && !/(?:ink-cipher-card|ink-cipher-room)$/.test(stem)) return 'subject';
  return 'other';
}

export function mediaFor(game: MediaID): MediaSections {
  const groups: MediaSections = { subject: [], background: [], composite: [], other: [] };
  for (const [filename, url] of mediaAssets) {
    const key = filename.startsWith(splitFolder) ? filename.slice(splitFolder.length) : filename;
    if (!folders[game].some(prefix => key.startsWith(prefix))) continue;
    const stem = key.replace(/\.[^.]+$/, '');
    const section = sectionFor(filename, stem);
    const name = filename.startsWith(splitFolder) ? stem.replace(/\/(?:subject|background)$/, '') : stem;
    groups[section].push({ url, name, filename });
  }
  if (game === 'endless-bar') {
    for (const filename of ['endless-bar-icon.svg', 'social/endless-bar-cover-v2.jpg', 'social/endless-bar-cover-v1.jpg', 'social/boardgame-cover-v1.jpg']) {
      groups.other.push({ url: '/' + filename, name: filename, filename });
    }
  }
  for (const group of Object.values(groups)) group.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return groups;
}
