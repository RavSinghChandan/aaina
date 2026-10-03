import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { PhotoSession } from '../core/photo-session';
import { Consultation, Meta, StyleOption } from '../core/models';
import { OutputView } from '../shared/output-view';
import { Chakra } from '../shared/chakra';
import { journeySteps } from '../core/journey';
import { TopBar } from '../shared/top-bar';

@Component({
  selector: 'results-page',
  imports: [RouterLink, TopBar, OutputView, Chakra],
  template: `
    <top-bar [action]="{ label: 'Start again', link: '/start' }" />
    <main class="wrap page stack">
      @if (c(); as c) {
        <header class="spread">
          <div class="done-row">
            <chakra class="done-wheel" [steps]="steps()" [current]="steps().length" [finished]="true" [hubText]="{ big: '✓', small: '' }" />
            <div>
            <p class="eyebrow">All {{ steps().length }} steps done</p>
            <h2>{{ name() ? name() + ', here are your looks' : 'Your three looks' }}</h2>
            </div>
          </div>
          <div class="row">
            <a class="btn btn-ghost btn-sm" [routerLink]="['/looks', id(), 'screen']">Big screen</a>
            <a class="btn btn-ghost btn-sm" [href]="whatsappLink()" target="_blank" rel="noopener">Send on WhatsApp</a>
          </div>
        </header>

        <div class="you card flat">
          @if (session.photo(); as ph) { <img class="you-ph" [src]="ph" alt="You today" /> }
          <div>
            <p class="eyebrow">{{ session.photo() ? 'You today' : 'About you' }}</p>
            <div class="chips">@for (t of youTags(); track t) { <span class="pill">{{ t }}</span> }</div>
            @if (rec()?.summary; as sum) { <p class="sum">{{ sum }}</p> }
          </div>
        </div>
        <section class="looks" aria-label="Recommended haircuts">
          @for (o of options(); track o.style_id; let i = $index) {
            <article class="look card" [class.chosen]="chosen() === o.style_id">
              <div class="pv" [class.photo]="kind(o.style_id) === 'photo'">
                @if (preview(o.style_id); as src) {
                  <img [src]="src" [alt]="kind(o.style_id) === 'photo' ? 'You with a ' + o.name : 'Drawing of ' + o.name" loading="lazy" />
                }
                @if (kind(o.style_id) === 'photo') { <span class="onyou">On your photo</span> }
                <span class="rank">{{ i === 0 ? 'Best match' : '#' + (i + 1) }}</span>
                <span class="score" [attr.aria-label]="o.match_score + ' percent match'">{{ o.match_score }}%</span>
              </div>
              <div class="body stack">
                <h3>{{ o.name }}</h3>
                <p class="why">{{ o.why }}</p>
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
        <div class="center"><a class="btn btn-ghost" routerLink="/start">Start a new consultation</a></div>
      } @else if (error()) {
        <div class="card center"><h2>Not found</h2><p class="muted">{{ error() }}</p></div>
      } @else { <div class="skeleton" style="height:420px"></div> }
    </main>
  `,
  styles: [`
    .done-row { display: flex; gap: 14px; align-items: center; }
    .done-wheel { width: 64px; flex: none; }
    .done-row h2 { margin: 0; }
    .done-row .eyebrow { margin: 0 0 2px; }
    .lead { font-size: 1.05rem; color: var(--ink-2); max-width: 70ch; }
    .looks { display: grid; grid-auto-flow: column; grid-auto-columns: 86%; gap: 14px; align-items: start; overflow-x: auto; scroll-snap-type: x mandatory; padding: 4px 2px 12px; margin: 0 -16px; padding-left: 16px; padding-right: 16px; }
    .look { scroll-snap-align: center; padding: 0; overflow: hidden; display: flex; flex-direction: column; }
    @media (min-width: 900px) { .looks { grid-auto-flow: row; grid-template-columns: repeat(3, 1fr); overflow: visible; margin: 0; padding: 4px 0; align-items: stretch; } }
    .look.chosen { border-color: var(--brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 30%, transparent), var(--shadow); }
    .pv { position: relative; background: #0b1a05; aspect-ratio: 1 / 1; }
    @media (min-width: 900px) { .pv { aspect-ratio: 4 / 5; } }
    .pv img { width: 100%; height: 100%; object-fit: cover; object-position: center 30%; }
    .pv.photo { aspect-ratio: 2 / 3; background: #111; }
    .pv.photo img { object-position: center top; }
    .onyou { position: absolute; left: 12px; bottom: 12px; background: rgba(0,0,0,.62); color: #fff; border-radius: 999px; padding: 4px 10px; font-weight: 700; font-size: .78rem; }
    .you { display: flex; gap: 14px; align-items: center; padding: 14px; }
    .you-ph { width: 76px; height: 76px; border-radius: 50%; object-fit: cover; object-position: center 25%; flex: none; border: 3px solid var(--card); box-shadow: 0 0 0 2px var(--brand); }
    .you .eyebrow { margin: 0 0 6px; }
    .you .sum { margin: 8px 0 0; color: var(--ink-2); font-size: .95rem; }
    .why { font-size: 1.02rem; line-height: 1.45; margin: 0; }
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
  id = input.required<string>();
  private api = inject(Api);
  session = inject(PhotoSession);
  name = computed(() => this.c()?.customer?.name?.trim() || null);
  youTags = computed(() => {
    const a = this.c()?.outputs?.['analysis'];
    if (!a) return [];
    const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
    const colour = (a.features ?? []).find((f: string) => / hair \(from your photo\)$/.test(f))?.replace(' (from your photo)', '');
    return [
      a.face_shape && `${cap(a.face_shape === 'oblong' ? 'long' : a.face_shape)} face`,
      colour,
      a.hair?.length && `${cap(a.hair.length)} length`,
      a.beard?.present && 'Beard',
    ].filter(Boolean) as string[];
  });

  c = signal<Consultation | null>(null);
  meta = signal<Meta | null>(null);
  error = signal<string | null>(null);
  choosing = signal(false);
  tab = signal<string>('');
  steps = computed(() => {
    const m = this.meta();
    return journeySteps(m?.forms['intake'] ?? null);
  });

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
    const steps = this.c()?.steps ?? {};
    const ai = ['recommendation', 'hair_care'].some(k => !['offline', 'offline-fallback', undefined].includes(steps[k]?.source as any));
    const photo = steps['analysis']?.source && !['offline', 'offline-fallback'].includes(steps['analysis'].source!);
    return photo ? 'Photo and recommendations by AI.' : ai ? 'Recommendations by AI, based on your answers.' : 'Based on your answers.';
  });
  whatsappLink = computed(() => {
    const o = this.options(); const cal = this.c()?.outputs?.['calendar'];
    const pick = o.find(x => x.style_id === this.chosen()) ?? o[0];
    const next = cal?.events?.find((e: any) => e.kind === 'trim');
    const text = `My Aaina looks:\n` +
      o.map((x, i) => `${i + 1}. ${x.name} (${x.match_score}% match)`).join('\n') +
      (pick ? `\n\nChosen: ${pick.name}` : '') + (next ? `\nNext trim: ${next.date}` : '');
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  });

  async ngOnInit() {
    try {
      const [c, meta] = await Promise.all([this.api.consultation(this.id()), this.api.meta()]);
      this.c.set(c); this.meta.set(meta);
    } catch { this.error.set('We could not find these looks. They may have been removed.'); }
  }

  kind(styleId: string): string {
    return (this.c()?.outputs?.['previews']?.previews ?? []).find((p: any) => p.style_id === styleId)?.kind ?? 'drawing';
  }

  preview(styleId: string): string | null {
    return (this.c()?.outputs?.['previews']?.previews ?? []).find((p: any) => p.style_id === styleId)?.image ?? null;
  }

  async choose(o: StyleOption) {
    this.choosing.set(true);
    try { this.c.set(await this.api.choose(this.id(), o.style_id)); this.tab.set('calendar'); }
    finally { this.choosing.set(false); }
  }
}
