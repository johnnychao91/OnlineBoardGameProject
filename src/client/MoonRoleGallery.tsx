import { MOON_FACTIONS, MOON_ROLES, type MoonRole } from '../games/moon/rules';
import { RoleGallery } from './RoleGallery';
import villager from './assets/art/moon/villager.webp';
import seer from './assets/art/moon/seer.webp';
import witch from './assets/art/moon/witch.webp';
import hunter from './assets/art/moon/hunter.webp';
import guard from './assets/art/moon/guard.webp';
import idiot from './assets/art/moon/idiot.webp';
import wolf from './assets/art/moon/wolf.webp';
import wolfKing from './assets/art/moon/wolf-king.webp';
import whiteWolfKing from './assets/art/moon/white-wolf-king.webp';
import ghostRider from './assets/art/moon/ghost-rider.webp';

const images: Record<MoonRole, string> = {
  villager, seer, witch, hunter, guard, idiot,
  wolf, 'wolf-king': wolfKing, 'white-wolf-king': whiteWolfKing, 'ghost-rider': ghostRider,
};

export function MoonRoleGallery() {
  return <RoleGallery idPrefix="moon-guide" entries={(Object.keys(images) as MoonRole[]).map(id => ({
    id, name: MOON_ROLES[id].name, image: images[id], description: MOON_ROLES[id].description,
    category: `陣營 · ${MOON_FACTIONS[MOON_ROLES[id].faction]}`,
    tone: MOON_ROLES[id].faction === 'town' ? 'friendly' : 'hostile',
  }))} />;
}
