/** Adapters supply public event identities only, never cards, votes or hidden roles. */
export interface SoundCueState { revision: number; events: string[]; attention?: string; }
export interface GameSoundInput { G?: SoundCueState; matchID: string; playerID?: string; enabled?: boolean; connected?: boolean; }
export type SoundAdapter = (G: any, playerID?: string) => SoundCueState | undefined;
const silent = () => ({ reveals: 0, ownTurn: false });

export class GameSoundTracker {
  private previous?: GameSoundInput;
  private announced = new Set<string>();
  update(input: GameSoundInput) {
    const { G, matchID, playerID, enabled = true, connected = true } = input;
    if (!G || !enabled || !connected) { this.previous = undefined; this.announced.clear(); return silent(); }
    const prior = this.previous;
    if (!prior?.G || prior.matchID !== matchID || prior.playerID !== playerID) {
      this.previous = input; this.announced.clear();
      if (G.attention) this.announced.add(G.attention);
      return silent();
    }
    if (G.revision < prior.G.revision || G.events.length < prior.G.events.length
      || prior.G.events.some((event, index) => G.events[index] !== event)) return silent();
    const result = { reveals: G.events.length - prior.G.events.length,
      ownTurn: !!G.attention && G.attention !== prior.G.attention && !this.announced.has(G.attention) };
    if (G.attention) this.announced.add(G.attention);
    this.previous = input;
    return result;
  }
}
