import { Component, computed, inject, input } from '@angular/core';
import { I18n } from '../core/i18n';
import { DatePipe, KeyValuePipe, TitleCasePipe } from '@angular/common';

/**
 * Renders any agent's output from the `ui.view` in its manifest.
 * New agents reuse these views - no new Angular code per feature.
 */
@Component({
  selector: 'output-view',
  imports: [DatePipe, KeyValuePipe, TitleCasePipe],
  template: `
    @switch (view()) {
      @case ('facts') {
        <div class="facts">
          @if (data()?.face_shape) {
            <div class="fact big"><span class="muted small">{{ t()('out.faceShape') }}</span><strong>{{ t()('form.self_report.face_shape.' + data().face_shape, null, data().face_shape) }}</strong></div>
          }
          @if (data()?.hair) {
            <div class="fact"><span class="muted small">{{ t()('out.hair') }}</span><strong>{{ t()('out.density.' + data().hair.density, null, data().hair.density) }} · {{ t()('form.self_report.hair_type.' + data().hair.type, null, data().hair.type) }} · {{ t()('form.hair_length_now.' + data().hair.length, null, data().hair.length) }}</strong></div>
          }
          @if (data()?.skin?.type && data().skin.type !== 'unknown') {
            <div class="fact"><span class="muted small">{{ t()('out.skin') }}</span><strong>{{ t()('form.self_report.skin_type.' + data().skin.type, null, data().skin.type) }}</strong></div>
          }
        </div>
        @if (concerns().length) { <div class="chips mt">@for (c of concerns(); track c) { <span class="pill">{{ c }}</span> }</div> }
        @if (data()?.notes && i18n.lang() === 'en') { <p class="muted small mt">{{ data().notes }}</p> }
      }
      @case ('routine') {
        @for (block of routineBlocks(); track block.key) {
          <section class="rblock">
            <h3>{{ block.title }}</h3>
            <ol class="steps">
              @for (s of block.items; track $index) {
                <li><span class="step">{{ s.step }}</span>@if (s.why) {<span class="why">{{ s.why }}</span>}</li>
              }
            </ol>
          </section>
        }
        @if (data()?.products?.length) {
          <section class="rblock">
            <h3>{{ t()('out.lookFor') }}</h3>
            <ul class="list">
              @for (p of data().products; track $index) {
                <li><strong>{{ p.type }}</strong> — {{ p.look_for }} <span class="muted small">· {{ p.why }}</span></li>
              }
            </ul>
          </section>
        }
        @if (data()?.styling) { <p class="tip"><strong>{{ t()('out.styling') }}</strong> {{ data().styling }}</p> }
        @if (data()?.note) { <p class="muted small">{{ data().note }}</p> }
      }
      @case ('profile') {
        @if (data()?.headline) { <p class="headline">{{ data().headline }}</p> }
        <div class="pgrid">
          @for (sec of profileSections(); track sec.key) {
            @if (sec.items.length) {
              <div class="pcell"><span class="muted small">{{ sec.title }}</span>
                <div class="chips">@for (i of sec.items; track i) { <span class="pill">{{ i }}</span> }</div>
              </div>
            }
          }
        </div>
      }
      @case ('timeline') {
        <ol class="tl">
          @for (e of data()?.events ?? []; track $index) {
            <li [class]="'k-' + e.kind">
              <span class="dot" aria-hidden="true"></span>
              <div><strong>{{ t()('kind.' + e.kind, null, e.title) }}</strong><span class="muted small"> · {{ e.date | date: 'EEE d MMM' }}</span>
                <div class="muted small">{{ e.detail }}</div></div>
            </li>
          }
        </ol>
      }
      @default {
        <dl class="kv">
          @for (kv of (data() ?? {}) | keyvalue; track kv.key) {
            <dt>{{ kv.key }}</dt><dd>{{ asText(kv.value) }}</dd>
          }
        </dl>
      }
    }
  `,
  styles: [`
    .mt { margin-top: 12px; }
    .facts { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
    .fact { background: var(--soft); border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
    .fact.big strong { font-size: 1.3rem; }
    .rblock + .rblock { margin-top: 18px; }
    .steps { margin: 0; padding-left: 0; list-style: none; counter-reset: s; }
    .steps li { counter-increment: s; position: relative; padding: 10px 0 10px 40px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; }
    .steps li:last-child { border-bottom: 0; }
    .steps li::before { content: counter(s); position: absolute; left: 0; top: 10px; width: 28px; height: 28px; border-radius: 50%; background: var(--soft); display: grid; place-items: center; font-weight: 800; font-size: .8rem; }
    .step { font-weight: 600; }
    .why { color: var(--ink-3); font-size: .875rem; }
    .tip { background: color-mix(in srgb, var(--brand) 9%, #fff); border-radius: 14px; padding: 12px 14px; margin-top: 14px; }
    .headline { font-family: var(--serif); font-size: 1.25rem; }
    .pgrid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .pcell { display: flex; flex-direction: column; gap: 8px; }
    .tl { list-style: none; margin: 0; padding: 0; position: relative; }
    .tl::before { content: ''; position: absolute; left: 9px; top: 6px; bottom: 6px; width: 2px; background: var(--line); }
    .tl li { position: relative; padding: 8px 0 14px 34px; }
    .tl .dot { position: absolute; left: 2px; top: 12px; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 3px solid var(--brand); }
    .tl .k-trim .dot { background: var(--brand); }
    .kv { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0; }
    .kv dt { font-weight: 700; } .kv dd { margin: 0; color: var(--ink-2); }
  `],
})
export class OutputView {
  readonly i18n = inject(I18n);
  readonly t = this.i18n.t;
  view = input.required<string>();
  data = input<any>();

  concerns = computed(() => [
    ...(this.data()?.hair?.visible_concerns ?? []), ...(this.data()?.skin?.visible_concerns ?? []),
  ].map((c: string) => c.replace(/_/g, ' ')));

  routineBlocks = computed(() => {
    const d = this.data() ?? {};
    const labels: Record<string, string> = { morning: this.t()('out.morning'), night: this.t()('out.night'), daily: this.t()('out.daily'), weekly: this.t()('out.weekly'), monthly: this.t()('out.monthly') };
    return Object.keys(labels).filter(k => Array.isArray(d[k]) && d[k].length).map(k => ({ key: k, title: labels[k], items: d[k] }));
  });

  profileSections = computed(() => {
    const d = this.data() ?? {};
    const pick = (k: string) => (Array.isArray(d[k]) ? d[k] : d[k] ? [d[k]] : []).map((x: string) => String(x).replace(/_/g, ' '));
    return [
      { key: 'style', title: this.t()('out.style'), items: pick('style_personality') },
      { key: 'work', title: this.t()('out.work'), items: pick('profession_fit') },
      { key: 'maint', title: this.t()('out.maint'), items: pick('maintenance_appetite') },
      { key: 'life', title: this.t()('out.life'), items: pick('lifestyle') },
      { key: 'likes', title: this.t()('out.likes'), items: pick('likes') },
      { key: 'dislikes', title: this.t()('out.avoid'), items: pick('dislikes') },
      { key: 'care', title: this.t()('out.care'), items: pick('care_priorities') },
      { key: 'limits', title: this.t()('results.keepInMind'), items: pick('constraints') },
    ];
  });

  asText(v: unknown): string { return typeof v === 'string' ? v : JSON.stringify(v); }
}
