import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { GAME_IDS } from '../games/catalog';
import layers from './assets/art/source-layers/manifest.json';
import { mediaFor, mediaGames } from './media-art';

it('assigns each source pair and its original to separate sections under exactly one game', () => {
  expect(mediaGames.map(game => game.id)).toEqual(['endless-bar', ...GAME_IDS]);
  const galleries = mediaGames.map(game => mediaFor(game.id));
  expect(galleries.every(gallery => gallery.subject.length && gallery.background.length)).toBe(true);
  const sources = new Set(galleries.flatMap(gallery => gallery.composite.map(asset => asset.filename)));
  expect(sources.size).toBe(layers.length);
  for (const { path, source } of layers) {
    const matches = galleries.filter(gallery => gallery.composite.some(asset => source.endsWith('/assets/' + asset.filename)));
    expect(matches, path).toHaveLength(1);
    expect(matches[0].subject.some(asset => asset.filename === 'art/source-layers/' + path + '/subject.webp'), path).toBe(true);
    expect(matches[0].background.some(asset => asset.filename === 'art/source-layers/' + path + '/background.webp'), path).toBe(true);
  }
  expect(mediaFor('baker-street').subject.some(asset => asset.filename === 'baker/objects/boot.webp')).toBe(true);
  expect(mediaFor('baker-street').background.some(asset => asset.filename === 'baker/boot-paper.webp')).toBe(true);
});

it('catalogs every image file in the frontend and public asset directories once', () => {
  const all = mediaGames.flatMap(game => Object.values(mediaFor(game.id)).flat());
  const fromDisk = (directory: string) => readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(file => file.isFile() && /\.(?:avif|jpe?g|png|svg|webp)$/i.test(file.name))
    .map(file => relative(directory, join(file.parentPath, file.name)).replaceAll('\\', '/'));
  const expected = [...fromDisk('src/client/assets'), ...fromDisk('public')].sort();
  expect(all.map(asset => asset.filename).sort()).toEqual(expected);
});
