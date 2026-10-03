import { Component, HostListener, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Consultation, StyleOption } from '../core/models';
import { SalonStore } from '../core/salon.store';

@Component({
  selector: 'present-page',
  imports: [RouterLink],
  template: `
    <div class="stage">
      <header class="bar">
        <span class="salon">{{ store.salon()?.name }}</span>
        <div class="row">
          <button class="btn btn-sm ghost" (click)="fullscreen()">Full screen</button>
          <a class="btn btn-sm ghost" [routerLink]="['/t', slug(), 'c', id()]">Close</a>
        </div>
      </header>
      <h1>{{ name() ? name() + ', which one feels like you?' : 'Which one feels like you?' }}</h1>
      <div class="three">
        @for (o of options(); track o.style_id; let i = $index) {
          <button class="opt" [class.on]="focus() === i" (click)="focus.set(i)" [attr.aria-pressed]="focus() === i">
            @if (preview(o.style_id); as src) { <img [src]="src" [alt]="o.name" /> }
            <span class="num">{{ i + 1 }}</span>
            <span class="nm">{{ o.name }}</span>
            <span class="sc">{{ o.match_score }}% match</span>
          </button>
        }
      </div>
      @if (options()[focus()]; as o) { <p class="why">{{ o.why }}</p> }
      <p class="hint">Use ← → or tap a look</p>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #0E0C0A; color: #fff; }
    .stage { min-height: 100vh; padding: 16px clamp(16px, 4vw, 48px) 32px; display: flex; flex-direction: column; gap: 16px; }
    .bar { display: flex; justify-content: space-between; align-items: center; }
    .salon { font-weight: 800; opacity: .8; }
    .ghost { background: rgba(255,255,255,.08); color: #fff; border-color: rgba(255,255,255,.2); }
    h1 { color: #fff; text-align: center; font-size: clamp(1.6rem, 3.6vw, 3rem); margin: 8px 0; }
    .three { display: grid; gap: clamp(10px, 2vw, 28px); grid-template-columns: repeat(3, 1fr); flex: 1; align-items: center; }
    @media (max-width: 640px) { .three { grid-template-columns: 1fr; } }
    .opt { position: relative; border: 3px solid transparent; border-radius: 24px; overflow: hidden; padding: 0; background: #1a1714; cursor: pointer; color: #fff; text-align: left; transition: transform .25s, border-color .25s, opacity .25s; opacity: .62; }
    .opt.on { border-color: var(--brand); transform: scale(1.03); opacity: 1; }
    .opt img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; }
    .num { position: absolute; top: 14px; left: 14px; width: 40px; height: 40px; border-radius: 50%; background: #fff; color: #000; display: grid; place-items: center; font-weight: 800; font-size: 1.2rem; }
    .nm { display: block; padding: 14px 16px 2px; font-weight: 800; font-size: clamp(1.1rem, 1.8vw, 1.6rem); }
    .sc { display: block; padding: 0 16px 16px; opacity: .75; }
    .why { text-align: center; font-size: clamp(1rem, 1.6vw, 1.4rem); max-width: 60ch; margin: 0 auto; opacity: .9; }
    .hint { text-align: center; opacity: .45; font-size: .9rem; }
  `],
})
export class PresentPage implements OnInit {
  slug = input.required<string>();
  id = input.required<string>();
  store = inject(SalonStore);
  private api = inject(Api);
  c = signal<Consultation | null>(null);
  focus = signal(0);
  options = computed<StyleOption[]>(() => this.c()?.outputs?.['recommendation']?.options ?? []);
  name = computed(() => this.c()?.customer?.name ?? null);

  async ngOnInit() {
    this.store.load(this.slug());
    this.c.set(await this.api.consultation(this.slug(), this.id()));
    const chosen = this.options().findIndex(o => o.style_id === this.c()?.chosen_style_id);
    if (chosen >= 0) this.focus.set(chosen);
  }
  preview(id: string) { return (this.c()?.outputs?.['previews']?.previews ?? []).find((p: any) => p.style_id === id)?.image ?? null; }
  @HostListener('window:keydown', ['$event']) key(e: KeyboardEvent) {
    const n = this.options().length || 1;
    if (e.key === 'ArrowRight') this.focus.update(i => (i + 1) % n);
    if (e.key === 'ArrowLeft') this.focus.update(i => (i - 1 + n) % n);
  }
  fullscreen() { document.documentElement.requestFullscreen?.().catch(() => {}); }
}
