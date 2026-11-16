/**
 * Asset manifest. Everything in Changeover is built from primitives in
 * src/scene-assets; there are no downloaded models, textures or audio files.
 */
import { defineAssets } from '@iwsdk/core';
import dawnRoom from './scene-assets/dawn-room.scene-asset.js';
import flatDiorama from './scene-assets/flat-diorama.scene-asset.js';

export default defineAssets({
  'flat-diorama': flatDiorama,
  // Not placed in the scene: the PlaySystem builds it at dawn. Listed for asset previews.
  'dawn-room': dawnRoom,
});
