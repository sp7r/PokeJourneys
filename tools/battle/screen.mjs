/**
 * Shows a native-resolution canvas at the largest whole-number scale that fits, so every FireRed pixel stays square,
 * and turns taps into the options that were drawn there.
 */
export class Screen {
  /**
   * size(): [width, height] in game pixels, or null to fill the page at `scale`.
   * draw(context, regions, now): draws a frame and pushes {x, y, w, h, target} tap regions.
   */
  constructor({size, draw, onTap, onDrag, tick = () => {}, minimumScale = 1}) {
    this.size = size;
    this.onDrag = onDrag;
    this.draw = draw;
    this.onTap = onTap;
    this.tick = tick;
    this.minimumScale = minimumScale;
    this.regions = [];
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'battle-screen';
    this.context = this.canvas.getContext('2d');
    this.frame = this.frame.bind(this);
    this.canvas.addEventListener('pointerdown', event => this.pointer(event));
    if (onDrag) {
      // Dragging moves by game pixels (positive when the finger moves down).
      this.canvas.addEventListener('pointermove', event => {
        if (!event.buttons || this.lastY === undefined) return;
        const bounds = this.canvas.getBoundingClientRect();
        this.onDrag((event.clientY - this.lastY) / bounds.height * this.canvas.height);
        this.lastY = event.clientY;
      });
      this.canvas.addEventListener('pointerup', () => { this.lastY = undefined; });
    }
    window.addEventListener('resize', () => this.fit());
  }

  mount(parent) {
    parent.replaceChildren(this.canvas);
    parent.className = 'battle';
    this.fit();
    requestAnimationFrame(this.frame);
  }

  fit() {
    const ratio = window.devicePixelRatio || 1;
    const pixelsWide = Math.floor(window.innerWidth * ratio);
    const pixelsHigh = Math.floor(window.innerHeight * ratio);
    let [width, height] = this.size(pixelsWide, pixelsHigh);
    const scale = Math.max(this.minimumScale, Math.floor(Math.min(pixelsWide / width, pixelsHigh / height)));
    this.scale = scale;
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${width * scale / ratio}px`;
    this.canvas.style.height = `${height * scale / ratio}px`;
  }

  /** One frame. The next is booked first, so a failed frame can never freeze the screen; failures are kept for debugging. */
  frame(now) {
    requestAnimationFrame(this.frame);
    try {
      this.tick(now);
      this.regions = [];
      this.context.imageSmoothingEnabled = false;
      this.draw(this.context, this.regions, now);
    } catch (error) {
      const errors = (window.DomeErrors ||= []);
      if (errors.length < 20) errors.push(String(error && error.stack || error));
    }
  }

  pointer(event) {
    this.lastY = event.clientY;
    const bounds = this.canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * this.canvas.width;
    const y = (event.clientY - bounds.top) / bounds.height * this.canvas.height;
    const hit = [...this.regions].reverse().find(region => x >= region.x && y >= region.y && x < region.x + region.w && y < region.y + region.h);
    this.onTap(hit ? hit.target : null);
  }
}
