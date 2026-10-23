export interface RoleGalleryEntry {
  id: string;
  name: string;
  image: string;
  faction: string;
  description: string;
  tone: 'friendly' | 'hostile';
}

/** Public rulebook artwork and descriptions, independent of any room or seat. */
export function RoleGallery({ entries, idPrefix }: { entries: readonly RoleGalleryEntry[]; idPrefix: string }) {
  return <div className="rules-role-gallery">
    {entries.map(role => <article className="rules-role-card" data-tone={role.tone} key={role.id} aria-labelledby={`${idPrefix}-${role.id}`}>
      <div className="rules-role-portrait"><img src={role.image} alt={`${role.name}角色插畫`} width={1254} height={1254} loading="lazy" decoding="async" /></div>
      <div className="rules-role-copy"><h3 id={`${idPrefix}-${role.id}`}>{role.name}</h3><p className="rules-role-faction">初始陣營 · {role.faction}</p><p>{role.description}</p></div>
    </article>)}
  </div>;
}
