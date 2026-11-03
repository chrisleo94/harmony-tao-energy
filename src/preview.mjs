import { discardFrame } from './device.mjs';

export class Preview {
  constructor() { this.frame = null; this.data = null; }
  async publish(frame) {
    const previous = this.frame;
    this.data = frame.data;
    this.frame = frame;
    await discardFrame(previous);
  }
}
