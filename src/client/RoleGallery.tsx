export interface RoleGalleryEntry {
  id: string;
  name: string;
  image: string;
  category: string;
  description: string;
  tone: 'friendly' | 'hostile' | 'neutral';
  /** A public example printed over a blank card illustration, never a dealt card. */
  sampleNumber?: number;
}

/** Public rulebook artwork and descriptions, independent of any room or seat. */
export function RoleGallery({ entries, idPrefix }: { entries: readonly RoleGalleryEntry[]; idPrefix: string }) {
  return <div className="rules-role-gallery">
    {entries.map(role => <article className="rules-role-card" data-tone={role.tone} key={role.id} aria-labelledby={`${idPrefix}-${role.id}`}>
      <div className="rules-role-portrait">
        {role.sampleNumber === undefined
          ? <img src={role.image} alt={`${role.name}插畫`} width={1254} height={1254} loading="lazy" decoding="async" />
          : <div className="rules-signal-example" role="img" aria-label={`${role.name}範例：${role.sampleNumber}`}>
            <img src={role.image} alt="" width={1024} height={1536} loading="lazy" decoding="async" />
            <span className="rules-signal-number" aria-hidden="true">{role.sampleNumber}</span>
          </div>}
      </div>
      <div className="rules-role-copy"><h3 id={`${idPrefix}-${role.id}`}>{role.name}</h3><p className="rules-role-faction">{role.category}</p><p>{role.description}</p></div>
    </article>)}
  </div>;
}
