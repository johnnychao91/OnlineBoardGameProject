import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { turingCards, turingCardNumber, type TuringState } from '../games/turing/game';

export interface TuringTableActions {
  place: (cardID: string, index: number) => void;
  remove: (cardID: string) => void;
  approve: () => void;
  withdraw: () => void;
}
type Props = {
  G: TuringState; ownID: string; visible: boolean; readonly: boolean;
  nameOf: (id: string) => string; actions?: TuringTableActions;
};
type DropTarget = { type: 'slot'; index: number; marker?: number } | { type: 'pool' };
type Drag = { cardID: string; pointerID: number; startX: number; startY: number; epoch: number; active: boolean };

/** A public order with locally projected card faces; no browser-generated ordering is authoritative. */
export function TuringSharedTable({ G, ownID, visible, readonly, nameOf, actions }: Props) {
  const cards = turingCards(G), ids = Object.keys(cards);
  const order = G.tableOrder ?? [];
  const pool = ids.filter(id => !order.includes(id));
  const approvals = G.orderApprovals ?? [];
  const editable = !readonly && G.status === 'sorting' && !!actions;
  const displayOrder = [...order, ...pool];
  const complete = order.length === ids.length && ids.length > 0;
  const root = useRef<HTMLElement>(null);
  const dragging = useRef<Drag | null>(null);
  const suppressClickUntil = useRef(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ cardID: string; x: number; y: number; target: DropTarget | null } | null>(null);
  useEffect(() => { setSelected(null); dragging.current = null; setDrag(null); }, [G.epoch, G.status]);
  useEffect(() => { if (!editable) { dragging.current = null; setDrag(null); } }, [editable]);

  function dropAt(x: number, y: number): DropTarget | null {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !root.current?.contains(hit)) return null;
    const slot = hit.closest<HTMLElement>('[data-turing-slot]');
    if (slot) return { type: 'slot', index: Number(slot.dataset.turingSlot) };
    const row = hit.closest<HTMLElement>('.turing-order-slots');
    if (row) {
      const slots = [...row.querySelectorAll<HTMLElement>('[data-turing-slot]')];
      if (slots.length) {
        const next = slots.findIndex(element => { const bounds = element.getBoundingClientRect(); return x <= bounds.x + bounds.width / 2; });
        const insertion = next < 0 ? slots.length : next;
        const previous = dragging.current ? order.indexOf(dragging.current.cardID) : -1;
        return { type: 'slot', index: previous >= 0 && previous < insertion ? insertion - 1 : insertion, marker: insertion };
      }
    }
    return hit.closest('[data-turing-pool]') ? { type: 'pool' } : null;
  }
  function place(cardID: string, index: number) {
    if (!editable || !cards[cardID]) return;
    const remainder = order.filter(id => id !== cardID);
    const nextIndex = Math.min(index, remainder.length);
    if (order.includes(cardID) && order.indexOf(cardID) === nextIndex) return;
    actions!.place(cardID, nextIndex);
  }
  function pointerDown(event: PointerEvent<HTMLButtonElement>, cardID: string) {
    if (!editable || event.button !== 0 || !event.isPrimary) return;
    dragging.current = { cardID, pointerID: event.pointerId, startX: event.clientX, startY: event.clientY, epoch: G.epoch, active: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = dragging.current;
    if (!current || current.pointerID !== event.pointerId || !editable) return;
    if (!current.active && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
    current.active = true;
    setSelected(current.cardID);
    setDrag({ cardID: current.cardID, x: event.clientX, y: event.clientY, target: dropAt(event.clientX, event.clientY) });
  }
  function cancelDrag() { dragging.current = null; setDrag(null); }
  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const current = dragging.current;
    if (!current || current.pointerID !== event.pointerId) return;
    const target = current.active ? dropAt(event.clientX, event.clientY) : null;
    cancelDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current.active) return;
    suppressClickUntil.current = Date.now() + 300;
    if (!editable || current.epoch !== G.epoch || !target) return;
    if (target.type === 'slot') place(current.cardID, target.index);
    else if (order.includes(current.cardID)) actions!.remove(current.cardID);
  }
  function card(cardID: string) {
    const owner = cards[cardID].playerID;
    const result = G.revealed.find(entry => entry.cardID === cardID);
    const privateNumber = visible && (readonly || owner === ownID) ? turingCardNumber(G, cardID) : undefined;
    const number = result?.number ?? (G.status === 'finished' ? turingCardNumber(G, cardID) : privateNumber);
    const revealed = !!result || G.status === 'finished';
    const label = `${nameOf(owner)}的強度牌`;
    const body = <><span className="turing-desk-owner">{nameOf(owner)}{!readonly && owner === ownID && <span className="you-label">你</span>}</span>
      <span className="turing-desk-face"><strong className="turing-desk-number">{number ?? '?'}</strong>
      <small>{revealed ? result?.error ? '順序下降 · 生命 −1' : result ? '強度已公開' : '終局公開' : number !== undefined ? readonly ? '目前視角可見' : '只有你可見' : '秘密強度'}</small></span></>;
    const className = `turing-desk-card${selected === cardID ? ' is-selected' : ''}${result?.error ? ' is-error' : ''}${revealed ? ' is-revealed' : ''}${drag?.cardID === cardID ? ' is-dragging' : ''}`;
    return editable ? <button type="button" className={className} data-card-id={cardID} aria-label={`選取${label}`} aria-pressed={selected === cardID}
      onPointerDown={event => pointerDown(event, cardID)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
      onClick={() => { if (Date.now() >= suppressClickUntil.current) setSelected(selected === cardID ? null : cardID); }}>
      {body}
    </button> : <div className={className} data-card-id={cardID} aria-label={label}>{body}</div>;
  }
  const currentSelection = selected && cards[selected] ? selected : null;
  const selectedIndex = currentSelection ? order.indexOf(currentSelection) : -1;
  return <section className={`panel turing-table turing-shared-table turing-shared-${ids.length}`} ref={root} aria-label="共同排序桌面">
    <div className="section-heading"><h2>共同排序桌面</h2><span>每人一張 · 移牌後重新同意</span>
      {editable && <div className={`turing-card-pool${drag?.target?.type === 'pool' ? ' is-drop-target' : ''}`} data-turing-pool="true" aria-label="移回待排">
        <button className="text-button" type="button" disabled={!currentSelection || selectedIndex < 0} onClick={() => currentSelection && actions!.remove(currentSelection)}>移回待排</button>
        {currentSelection && <button className="text-button" type="button" onClick={() => setSelected(null)}>取消選取</button>}
      </div>}
    </div>
    <p className="turing-table-instruction">{G.status === 'sorting' ? readonly ? '所有玩家可共同調整，待全員同意後一次揭曉。' : '邊說答案邊排牌；拖曳卡牌到想放的位置，或先點卡再選第幾位。' : G.status === 'briefing' || G.status === 'answering' ? '這是舊版進行局；完成本輪確認後即可排牌。' : '保留剛才共同決定的順序與揭曉結果。'}</p>
    <div className="turing-order-direction" aria-hidden="true"><span>低強度</span><span>→</span><span>高強度</span></div>
    <div className={`turing-order-slots turing-slots-${ids.length}`} aria-label="由左到右排列的桌面">
      {displayOrder.map((cardID, index) => <div className={`turing-order-slot${index >= order.length ? ' is-unplaced' : ''}${drag?.target?.type === 'slot' && (drag.target.marker ?? drag.target.index) === index ? ' is-drop-target' : ''}${drag?.target?.type === 'slot' && drag.target.marker === ids.length && index === ids.length - 1 ? ' is-drop-after' : ''}`} data-turing-slot={index} key={cardID}>
        <span className="turing-slot-label">{index < order.length ? `第 ${index + 1} 位${index === 0 ? ' · 最低' : complete && index === ids.length - 1 ? ' · 最高' : ''}` : '待排'}</span>
        {card(cardID)}
        {editable && <button className="turing-place-button" type="button" style={{ visibility: index > order.filter(id => id !== currentSelection).length ? 'hidden' : undefined }} disabled={!currentSelection || selectedIndex === index} onClick={() => currentSelection && place(currentSelection, index)} aria-label={`將選取的卡放到第 ${index + 1} 位`}>放第 {index + 1} 位</button>}
      </div>)}
    </div>
    {G.status === 'sorting' && <div className="turing-order-approval"><p className="small">{complete ? `尚未同意：${Object.keys(G.players).filter(id => !approvals.includes(id)).map(nameOf).join('、') || '全員已同意'}` : `還有 ${pool.length} 張牌待排。`}</p>
      <p className="small muted">調整任何卡牌位置，都會取消全員先前的同意；最後一人同意後立即揭牌。</p>
      {!readonly && <button className="button primary" type="button" disabled={!actions || !complete || !!G.redrawApprovals?.length} onClick={() => approvals.includes(ownID) ? actions?.withdraw() : actions?.approve()}>{G.redrawApprovals?.length ? '先決定是否重抽' : approvals.includes(ownID) ? '撤回同意' : '同意這個順序'}</button>}
    </div>}
    {drag && cards[drag.cardID] && <div className="turing-drag-ghost" aria-hidden="true" style={{ left: drag.x, top: drag.y }}>{nameOf(cards[drag.cardID].playerID)}<span>放到想排的位置</span></div>}
  </section>;
}
