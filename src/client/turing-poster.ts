import type { TuringState } from '../games/turing/game';
import type { PosterOptions } from './game-types';
const clean = (value: string, limit: number) => Array.from(value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/https?:\/\/\S+/gi, '…').replace(/\s+/g, ' ').trim()).slice(0, limit).join('');

/** Whitelist public fields; never consult private answers, numbers or future questions. */
export function buildTuringPosterModel({ G: state, info, step, totalSteps }: PosterOptions) {
  const G = state as TuringState;
  const latest = G.revealed.at(-1);
  const nameOf = (id: string) => clean(info.players.find(p => String(p.id) === id)?.name ?? '受測者', 28);
  return {
    round: G.round, integrity: G.integrity, maxIntegrity: G.maxIntegrity,
    prompt: clean(G.question?.prompt ?? '準備進行人性校準', 200),
    low: clean(G.question?.low ?? '', 50), high: clean(G.question?.high ?? '', 50),
    examiner: nameOf(G.examinerID), sequence: G.revealed.map(({ number, error }) => ({ number, error })),
    latest: latest ? { name: nameOf(latest.playerID), number: latest.number, error: latest.error, answer: clean(G.answers[latest.playerID] ?? '', 160) } : null,
    result: G.status === 'finished' ? G.winner === 'humans' ? '人性校準完成 · 全隊成功' : '容錯耗盡 · 下次重新校準' : '檢測進行中',
    step, totalSteps,
  };
}
export async function createTuringPoster(options: PosterOptions): Promise<Blob> {
  const model = buildTuringPosterModel(options);
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('此瀏覽器無法建立戰報。');
  const font = 'system-ui,"Microsoft JhengHei",sans-serif';
  const text = (value: string, x: number, y: number, size = 26, color = '#dce9df') => { ctx.fillStyle = color; ctx.font = `600 ${size}px ${font}`; ctx.fillText(value, x, y); };
  const lines = (value: string, x: number, y: number, width: number, size: number, count: number, color = '#dce9df') => {
    ctx.font = `600 ${size}px ${font}`; let line = '', row = 0;
    for (const ch of Array.from(value)) {
      if (ctx.measureText(line + ch).width > width) { text(line, x, y + row * size * 1.6, size, color); row += 1; line = ''; if (row >= count) { text('…', x + width - size * 2, y + (row - 1) * size * 1.6, size, color); return; } }
      line += ch;
    }
    if (line) text(line, x, y + row * size * 1.6, size, color);
  };
  const box = (x: number, y: number, w: number, h: number, color = '#1b3338') => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); ctx.strokeStyle = '#688279'; ctx.strokeRect(x, y, w, h); };
  ctx.fillStyle = '#101e25'; ctx.fillRect(0, 0, 1080, 1350);
  ctx.strokeStyle = '#25443f'; for (let x = 30; x < 1080; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1350); ctx.stroke(); }
  text('HUMANITY CALIBRATION / 公開檢測戰報', 64, 80, 20, '#bdcda2');
  text('圖靈測試', 64, 180, 72); text('機器讀得懂文字，我們讀得懂彼此。', 68, 234, 28, '#a8c0bb');
  box(64, 274, 952, 116); text(`第 ${model.round} 輪 / 5`, 92, 322, 28); text(`容錯 ${model.integrity} / ${model.maxIntegrity}`, 650, 322, 28, '#a8ead4');
  lines(`檢測員：${model.examiner}`, 92, 365, 850, 22, 1);
  box(64, 420, 952, 264); text('本輪題目', 90, 464, 21, '#bdcda2'); lines(model.prompt, 90, 514, 900, 30, 3);
  lines(`1：${model.low}　→　10：${model.high}`, 90, 652, 900, 20, 1, '#a8c0bb');
  box(64, 714, 952, 310); text('剛剛揭曉的這一張', 90, 758, 21, '#bdcda2');
  if (model.latest) { const latest = model.latest; text(String(latest.number), 90, 890, 100, latest.error ? '#ff9aab' : '#9ae6d0'); lines(latest.name, 265, 810, 720, 30, 1); lines(latest.answer, 265, 858, 710, 26, 3); text(latest.error ? '順序下降 · 容錯 −1' : '已公開強度', 90, 993, 23, latest.error ? '#ff9aab' : '#9ae6d0'); }
  else { text('所有強度仍在等待揭曉。', 92, 843, 34); text('未公開答案與數字不會放入戰報。', 92, 917, 24, '#a8c0bb'); }
  text('揭曉順序', 65, 1070, 23, '#a8c0bb');
  model.sequence.forEach((entry, i) => { box(64 + i * 117, 1092, 99, 64, entry.error ? '#593743' : '#24453e'); text(String(entry.number), 96 + i * 117, 1136, 32, entry.error ? '#ffb2bb' : '#c0f4de'); });
  text(model.result, 64, 1220, 32); text('捷寶桌遊室', 64, 1300, 23); text(`復盤 ${model.step} / ${model.totalSteps}`, 770, 1300, 20, '#a8c0bb');
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('戰報產生失敗，請重試。')), 'image/png'));
}
