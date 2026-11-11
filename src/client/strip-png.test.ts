import { crc32, inflateSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { encodeStripPng, PNG_STRIP_HEIGHT } from './strip-png';

it('encodes every strip into one valid PNG, including the partial final strip', async () => {
  const width = 2, height = PNG_STRIP_HEIGHT + 1;
  const draw = vi.fn((top: number, count: number) => ({
    data: Uint8ClampedArray.from({ length: width * count * 4 }, (_, index) =>
      [top ? 90 : 10, 20, 30, 255, 40, 50, 60, 255][index % 8]),
  } as ImageData));
  const blob = await encodeStripPng(width, height, draw);
  const png = Buffer.from(await blob.arrayBuffer());
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(width);
  expect(png.readUInt32BE(20)).toBe(height);
  expect(draw.mock.calls).toEqual([[0, PNG_STRIP_HEIGHT], [PNG_STRIP_HEIGHT, 1]]);

  const imageData: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    const end = offset + 8 + size;
    expect(png.readUInt32BE(end)).toBe(crc32(png.subarray(offset + 4, end)));
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') imageData.push(png.subarray(offset + 8, end));
    offset = end + 4;
  }
  const scanlines = inflateSync(Buffer.concat(imageData));
  expect(scanlines).toEqual(Buffer.concat([
    ...Array.from({ length: PNG_STRIP_HEIGHT }, () => Buffer.from([1, 10, 20, 30, 30, 30, 30])),
    Buffer.from([1, 90, 20, 30, 206, 30, 30]),
  ]));
});
