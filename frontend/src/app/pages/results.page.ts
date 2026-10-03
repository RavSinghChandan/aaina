import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Consultation, Meta, StyleOption } from '../core/models';
import { SalonStore } from '../core/salon.store';
import { OutputView } from '../shared/output-view';
import { SalonBar } from '../shared/salon-bar';

@Component({
  selector: 'results-page',
  imports: [RouterLink, SalonBar, OutputView],
  template: `
    <salon-bar [slug]="slug()" [name]="store.salon()?.name" />
    <main class="wrap page stack">
      @if (c(); as c) {
        <header class="spread">
          <div>
            <p class="eyebrow">{{ c.customer.name ? c.customer.name + "'s looks" : 'Your looks' }}</p>
            <h2>{{ rec()?.summary || 'Three cuts chosen for you' }}</h2>
          </div>
          <div class="row">
            <a class="btn btn-ghost btn-sm" [routerLink]="['/t', slug(), 'c', id(), 'present']">Big screen</a>
            <a class="btn btn-ghost btn-sm" [href]="whatsappLink()" target="_blank" rel="noopener">Send on WhatsApp</a>
          </div>
        </header>

        <section class="looks" aria-label="Recommended haircuts">
          @for (o of options(); track o.style_id; let i = $index) {
            <article class="look card" [class.chosen]="chosen() === o.style_id">
              <div class="pv">
                @if (preview(o.style_id); as src) { <img [src]="src" [alt]="'Preview of ' + o.name" loading="lazy" /> }
                <span class="rank">{{ i === 0 ? 'Best match' : '#' + (i + 1) }}</span>
                <span class="score" [attr.aria-label]="o.match_score + ' percent match'">{{ o.match_score }}%</span>
              </div>
              <div class="body stack">
                <h3>{{ o.name }}</h3>
                <p>{{ o.why }}</p>
                <div class="chips">@for (s of o.suits; track s) { <span class="pill brand">{{ s }}</span> }</div>
                <dl class="meta">
                  <div><dt>Upkeep</dt><dd>{{ o.maintenance }}</dd></div>
                  <div><dt>Trim every</dt><dd>{{ o.trim_weeks }} wks</dd></div>
                  <div><dt>Styling</dt><dd>{{ o.styling_minutes }} min</dd></div>
                </dl>
                @if (o.watch_out) { <p class="watch small"><strong>Keep in mind:</strong> {{ o.watch_out }}</p> }
                <details class="stylist">
                  <summary>For your stylist</summary>
                  <p><strong>How to cut:</strong> {{ o.how_to_ask }}</p>
                  @if (o.styling_tip) { <p class="muted small"><strong>Styling at home:</strong> {{ o.styling_tip }}</p> }
                </details>
                <button class="btn btn-block" [class.btn-primary]="chosen() !== o.style_id" [class.btn-brand]="chosen() === o.style_id"
                        [disabled]="choosing()" (click)="choose(o)">{{ chosen() === o.style_id ? '✓ Chosen' : 'Choose this look' }}</button>
              </div>
            </article>
          }
        </section>

        <nav class="tabs" role="tablist" aria-label="More for you">
          @for (t of tabs(); track t.step) {
            <button role="tab" class="tab" [class.on]="tab() === t.step" [attr.aria-selected]="tab() === t.step" (click)="tab.set(t.step)">{{ t.title }}</button>
          }
        </nav>
        @if (currentTab(); as t) {
          <section class="card" role="tabpanel">
            <output-view [view]="t.view" [data]="c.outputs[t.step]" />
          </section>
        }
        <p class="muted small center">Grooming guidance, not medical advice. {{ aiNote() }}</p>
        <div class="center"><a class="btn btn-ghost" [routerLink]="['/t', slug(), 'consult']">New consultation</a></div>
      } @else if (error()) {
        <div class="card center"><h2>Not found</h2><p class="muted">{{ error() }}</p></div>
      } @else { <div class="skeleton" style="height:420px"></div> }
    </main>
  `,
  styles: [`
    .looks { display: grid; grid-auto-flow: column; grid-auto-columns: 86%; gap: 14px; overflow-x: auto; scroll-snap-type: x mandatory; padding: 4px 2px 12px; margin: 0 -16px; padding-left: 16px; padding-right: 16px; }
    .look { scroll-snap-align: center; padding: 0; overflow: hidden; display: flex; flex-direction: column; }
    @media (min-width: 900px) { .looks { grid-auto-flow: row; grid-template-columns: repeat(3, 1fr); overflow: visible; margin: 0; padding: 4px 0; } }
    .look.chosen { border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 30%, transparent), var(--shadow); }
    .pv { position: relative; background: #0b1a05; aspect-ratio: 1 / 1; }
    @media (min-width: 900px) { .pv { aspect-ratio: 4 / 5; } }
    .pv img { width: 100%; height: 100%; object-fit: cover; object-position: center 30%; }
    .rank { position: absolute; top: 12px; left: 12px; background: #fff; border-radius: 999px; padding: 4px 10px; font-weight: 800; font-size: .78rem; }
    .score { position: absolute; top: 12px; right: 12px; background: var(--brand); color: #fff; border-radius: 999px; padding: 4px 10px; font-weight: 800; font-size: .85rem; }
    .body { padding: 16px; flex: 1; display: flex; flex-direction: column; }
    .body .btn { margin-top: auto; }
    .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0; }
    .meta div { background: var(--soft); border-radius: 12px; padding: 8px 10px; }
    .meta dt { font-size: .72rem; color: var(--ink-3); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
    .meta dd { margin: 0; font-weight: 700; text-transform: capitalize; }
    .watch { background: #FFF7ED; border-radius: 12px; padding: 10px 12px; color: #7C2D12; }
    .stylist summary { cursor: pointer; font-weight: 700; min-height: 44px; display: flex; align-items: center; }
    .tabs { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
    .tab { flex: none; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 1.5px solid var(--line); background: #fff; font-weight: 700; color: var(--ink-2); cursor: pointer; }
    .tab.on { background: var(--ink); color: #fff; border-color: var(--ink); }
  `],
})
export class ResultsPage implements OnInit {
  slug = input.required<string>();
  id = input.required<string>();
  store = inject(SalonStore);
  private api = inject(Api);

  c = signal<Consultation | null>(null);
  meta = signal<Meta | null>(null);
  error = signal<string | null>(null);
  choosing = signal(false);
  tab = signal<string>('');

  rec = computed(() => this.c()?.outputs?.['recommendation']);
  options = computed<StyleOption[]>(() => this.rec()?.options ?? []);
  chosen = computed(() => this.c()?.chosen_style_id ?? null);
  tabs = computed(() => {
    const m = this.meta(), c = this.c();
    if (!m || !c) return [];
    const steps = m.workflows[c.workflow]?.steps ?? [];
    return steps
      .map(s => ({ step: s.id, ui: m.ui.find(u => u.id === s.agent) }))
      .filter(x => x.ui && !x.ui.hidden && x.ui.view !== 'options' && c.outputs[x.step])
      .sort((a, b) => a.ui!.order - b.ui!.order)
      .map(x => ({ step: x.step, title: x.ui!.title, view: x.ui!.view }));
  });
  currentTab = computed(() => this.tabs().find(t => t.step === this.tab()) ?? this.tabs()[0]);
  aiNote = computed(() => {
    const src = this.c()?.steps?.['analysis']?.source;
    return src === 'claude' ? 'Photo analysed by AI.' : 'Based on your answers.';
  });
  whatsappLink = computed(() => {
    const o = this.options(); const cal = this.c()?.outputs?.['calendar'];
    const pick = o.find(x => x.style_id === this.chosen()) ?? o[0];
    const next = cal?.events?.find((e: any) => e.kind === 'trim');
    const text = `Your Aaina looks from ${this.store.salon()?.name ?? 'the salon'}:\n` +
      o.map((x, i) => `${i + 1}. ${x.name} (${x.match_score}% match)`).join('\n') +
      (pick ? `\n\nChosen: ${pick.name}` : '') + (next ? `\nNext trim: ${next.date}` : '');
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  });

  async ngOnInit() {
    this.store.load(this.slug());
    try {
      const [c, meta] = await Promise.all([this.api.consultation(this.slug(), this.id()), this.api.meta()]);
      this.c.set(c); this.meta.set(meta);
    } catch { this.error.set('This consultation does not exist or belongs to another salon.'); }
  }

  preview(styleId: string): string | null {
    return (this.c()?.outputs?.['previews']?.previews ?? []).find((p: any) => p.style_id === styleId)?.image ?? null;
  }

  async choose(o: StyleOption) {
    this.choosing.set(true);
    try { this.c.set(await this.api.choose(this.slug(), this.id(), o.style_id)); this.tab.set('calendar'); }
    finally { this.choosing.set(false); }
  }
}
