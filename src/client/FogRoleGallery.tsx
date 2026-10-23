import { FOG_FACTIONS, FOG_ROLES, type FogRole } from '../games/fog/rules';
import { RoleGallery } from './RoleGallery';
import merlin from './assets/art/fog/merlin.webp';
import percival from './assets/art/fog/percival.webp';
import loyal from './assets/art/fog/loyal.webp';
import assassin from './assets/art/fog/assassin.webp';
import morgana from './assets/art/fog/morgana.webp';
import mordred from './assets/art/fog/mordred.webp';
import oberon from './assets/art/fog/oberon.webp';
import minion from './assets/art/fog/minion.webp';
import dawn from './assets/art/fog/lancelot-good.webp';
import sunken from './assets/art/fog/lancelot-evil.webp';

const images: Record<FogRole, string> = {
  merlin, percival, 'loyal-servant': loyal, 'good-lancelot': dawn, 'evil-lancelot': sunken,
  assassin, morgana, mordred, oberon, minion,
};

export function FogRoleGallery() {
  return <RoleGallery idPrefix="fog-guide" entries={(Object.keys(images) as FogRole[]).map(id => ({
    id, name: FOG_ROLES[id].name, image: images[id], description: FOG_ROLES[id].description,
    category: `初始陣營 · ${FOG_FACTIONS[FOG_ROLES[id].faction]}`, tone: FOG_ROLES[id].faction === 'knights' ? 'friendly' : 'hostile',
  }))} />;
}
