// PNG chunks contain a CRC-32 of the chunk type and payload.
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc;
});
export const PNG_STRIP_HEIGHT = 512;

function pngChunk(type: string, data: Uint8Array) {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < chunk.length - 4; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ chunk[i]) & 255];
  view.setUint32(chunk.length - 4, crc ^ 0xffffffff);
  return chunk;
}

/** Encode one opaque PNG using bounded canvas readbacks and a single zlib stream. */
export async function encodeStripPng(width: number, height: number, draw: (top: number, height: number) => ImageData) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 2; // RGB
  const parts: BlobPart[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header)];
  const stride = width * 3 + 1;
  let top = 0;
  const scanlines = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      // Give input and painting a chance between canvas readbacks.
      await new Promise(resolve => setTimeout(resolve, 0));
      const count = Math.min(PNG_STRIP_HEIGHT, height - top);
      const { data } = draw(top, count);
      const filtered = new Uint8Array(count * stride);
      let pixel = 0;
      for (let row = 0; row < count; row++) {
        let offset = row * stride;
        filtered[offset++] = 1; // Sub filter, one predictor per RGB channel.
        let red = 0, green = 0, blue = 0;
        for (let x = 0; x < width; x++, pixel += 4) {
          filtered[offset++] = data[pixel] - red;
          filtered[offset++] = data[pixel + 1] - green;
          filtered[offset++] = data[pixel + 2] - blue;
          red = data[pixel];
          green = data[pixel + 1];
          blue = data[pixel + 2];
        }
      }
      controller.enqueue(filtered);
      top += count;
      if (top === height) controller.close();
    },
  });
  const compressed = scanlines.pipeThrough(new CompressionStream('deflate')).getReader();
  while (true) {
    const { value, done } = await compressed.read();
    if (done) break;
    parts.push(pngChunk('IDAT', value));
  }
  parts.push(pngChunk('IEND', new Uint8Array(0)));
  return new Blob(parts, { type: 'image/png' });
}
