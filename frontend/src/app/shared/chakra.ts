import { Component, computed, input, output } from '@angular/core';

export interface ChakraStep { id: string; label: string; }

/**
 * The journey as a wheel. Each outer segment is one step: done steps fill in,
 * the current one glows, the rest wait. During the reveal the spokes turn and
 * the inner beads light up as each AI agent finishes.
 */
@Component({
  selector: 'chakra',
  template: `
    <svg viewBox="0 0 320 320" [class.spin]="spinning()" [class.finished]="finished()" role="img" [attr.aria-label]="aria()">
      <!-- outer step ring -->
      @for (s of segs(); track s.id; let i = $index) {
        <g class="seg" [class.done]="s.state === 'done'" [class.now]="s.state === 'now'" [class.tap]="s.state === 'done' && !spinning()"
           (click)="s.state === 'done' && !spinning() && pick.emit(i)">
          <path [attr.d]="s.d" />
          <text [attr.x]="s.tx" [attr.y]="s.ty" text-anchor="middle" dominant-baseline="central">{{ s.state === 'done' ? '✓' : i + 1 }}</text>
          <title>{{ i + 1 }}. {{ s.label }}</title>
        </g>
      }

      <!-- spokes: 24, like the Ashoka chakra -->
      <g class="spokes">
        <circle cx="160" cy="160" r="104" class="rim" />
        @for (a of spokes; track a) {
          <line x1="160" y1="160" [attr.x2]="160 + 104 * cos(a)" [attr.y2]="160 + 104 * sin(a)" />
        }
      </g>

      <!-- inner beads: one per AI agent -->
      @for (b of beadPos(); track b.id) {
        <circle [class]="'bead ' + b.status" [attr.cx]="b.x" [attr.cy]="b.y" r="7"><title>{{ b.label }}</title></circle>
      }

      <circle cx="160" cy="160" r="58" class="hub" />
      <text x="160" y="154" text-anchor="middle" class="big">{{ hubBig() }}</text>
      <text x="160" y="185" text-anchor="middle" class="sub">{{ hubSmall() }}</text>
    </svg>
  `,
  styles: [`
    :host { display: block; aspect-ratio: 1; }
    svg { width: 100%; height: 100%; overflow: visible; }
    .seg path { fill: var(--line); stroke: var(--paper); stroke-width: 3; transition: fill .4s; }
    .seg text { font-size: 15px; font-weight: 800; fill: var(--ink-3); pointer-events: none; }
    .seg.done path { fill: var(--brand); }
    .seg.done text { fill: #fff; }
    .seg.now path { fill: var(--gold); animation: glow 1.6s ease-in-out infinite; }
    .seg.now text { fill: var(--ink); }
    .seg.tap { cursor: pointer; }
    .seg.tap:hover path { fill: color-mix(in srgb, var(--brand) 80%, #000); }
    @keyframes glow { 50% { opacity: .62; } }
    .spokes { transform-origin: 160px 160px; }
    .spokes line { stroke: var(--brand); stroke-width: 1.6; opacity: .55; }
    .rim { fill: none; stroke: var(--brand); stroke-width: 2.5; opacity: .35; }
    .spin .spokes { animation: turn 1.8s linear infinite; }
    .finished .spokes { animation: turn .9s cubic-bezier(.2, .8, .3, 1) 1; }
    @keyframes turn { to { transform: rotate(360deg); } }
    .bead { fill: #fff; stroke: var(--line); stroke-width: 2; transition: fill .3s, stroke .3s; }
    .bead.running { fill: var(--gold); stroke: var(--gold); animation: glow .9s ease-in-out infinite; }
    .bead.done { fill: var(--brand); stroke: var(--brand); }
    .bead.failed { fill: var(--warn); stroke: var(--warn); }
    .hub { fill: #fff; stroke: var(--line); stroke-width: 2; filter: drop-shadow(0 4px 10px rgba(20, 17, 15, .12)); }
    .big { font-size: 34px; font-weight: 800; fill: var(--ink); letter-spacing: -.02em; }
    .sub { font-size: 12px; font-weight: 700; fill: var(--ink-3); letter-spacing: .08em; text-transform: uppercase; }
  `],
})
export class Chakra {
  steps = input.required<ChakraStep[]>();
  current = input(0);
  beads = input<{ id: string; label: string; status: string }[]>([]);
  spinning = input(false);
  finished = input(false);
  hubText = input<{ big: string; small: string } | null>(null);
  pick = output<number>();

  readonly spokes = Array.from({ length: 24 }, (_, i) => (i * 360) / 24);
  cos = (deg: number) => Math.cos((deg * Math.PI) / 180);
  sin = (deg: number) => Math.sin((deg * Math.PI) / 180);

  segs = computed(() => {
    const n = this.steps().length || 1, gap = 2.2;
    return this.steps().map((s, i) => {
      const a0 = -90 + (i * 360) / n + gap / 2, a1 = -90 + ((i + 1) * 360) / n - gap / 2, mid = (a0 + a1) / 2;
      const state = this.finished() || i < this.current() ? 'done' : i === this.current() ? 'now' : 'todo';
      return { ...s, state, d: arc(160, 160, 116, 152, a0, a1), tx: 160 + 134 * this.cos(mid), ty: 160 + 134 * this.sin(mid) };
    });
  });
  beadPos = computed(() => {
    const b = this.beads(), n = b.length || 1;
    return b.map((x, i) => {
      const a = -90 + (i * 360) / n;
      return { ...x, x: 160 + 84 * this.cos(a), y: 160 + 84 * this.sin(a) };
    });
  });
  hubBig = computed(() => this.hubText()?.big ?? `${Math.min(this.current() + 1, this.steps().length)}`);
  hubSmall = computed(() => this.hubText()?.small ?? `/ ${this.steps().length}`);
  aria = computed(() => {
    const s = this.steps()[this.current()];
    return `Step ${this.current() + 1} of ${this.steps().length}${s ? ': ' + s.label : ''}`;
  });
}

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt = (r: number, a: number) => `${(cx + r * Math.cos(rad(a))).toFixed(2)} ${(cy + r * Math.sin(rad(a))).toFixed(2)}`;
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${pt(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${pt(r1, a1)} L ${pt(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${pt(r0, a0)} Z`;
}
