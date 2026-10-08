import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth';
import { warmUp } from '../core/face-measure';
import { I18n } from '../core/i18n';
import { journeySteps } from '../core/journey';
import { IntakeForm } from '../core/models';
import { Chakra } from '../shared/chakra';
import { TopBar } from '../shared/top-bar';

/** One big button for the barber; how it works in four pictures. */
@Component({
  selector: 'home-page',
  imports: [RouterLink, Chakra, TopBar],
  template: `
    <top-bar />
    <main class="wrap page">
      <section class="hero">
        <div class="copy">
          <p class="eyebrow">{{ t()('home.eyebrow') }}</p>
          <h1>{{ t()('home.title') }}</h1>
          <p class="lead muted">{{ t()('home.lead') }}</p>
          <a class="btn btn-brand go" routerLink="/start"><span aria-hidden="true">✂️</span> {{ t()('home.newCustomer') }}</a>
          @if (!auth.session()) {
            <p class="muted small">{{ t()('home.forSalons') }} <a routerLink="/register">{{ t()('home.register') }}</a> · <a routerLink="/login">{{ t()('home.signIn') }}</a></p>
          }
        </div>
        <chakra class="wheel" [steps]="steps()" [current]="-1" [hubText]="{ big: '' + steps().length, small: t()('common.steps') }" data-noread />
      </section>

      <section aria-labelledby="how">
        <h2 id="how">{{ t()('home.how') }}</h2>
        <ol class="how">
          @for (s of how; track s.icon; let i = $index) {
            <li><span class="ic" aria-hidden="true">{{ s.icon }}</span><div><strong>{{ t()(s.title) }}</strong><p class="muted small">{{ t()(s.hint) }}</p></div></li>
          }
        </ol>
      </section>
      <p class="muted small center foot">{{ t()('common.notMedical') }}</p>
    </main>
  `,
  styles: [`
    .hero { display: grid; gap: 24px; align-items: center; padding: 4px 0 24px; }
    .hero h1 { margin: 0 0 10px; font-size: clamp(1.9rem, 6vw, 3rem); }
    .lead { font-size: 1.1rem; max-width: 42ch; }
    .go { margin: 10px 0 14px; min-width: 260px; min-height: 64px; font-size: 1.15rem; }
    .wheel { width: min(300px, 80vw); margin: 0 auto; }
    @media (min-width: 900px) { .hero { grid-template-columns: 1.1fr .9fr; gap: 56px; padding: 32px 0 48px; } .wheel { width: 360px; } }
    .how { list-style: none; padding: 0; margin: 14px 0 0; display: grid; gap: 10px; }
    @media (min-width: 720px) { .how { grid-template-columns: repeat(2, 1fr); } }
    .how li { display: flex; gap: 14px; align-items: center; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 14px; }
    .how .ic { font-size: 2rem; width: 52px; height: 52px; display: grid; place-items: center; background: var(--soft); border-radius: 14px; flex: none; }
    .how p { margin: 2px 0 0; }
    .foot { margin-top: 28px; }
  `],
})
export class HomePage implements OnInit {
  private api = inject(Api);
  readonly auth = inject(Auth);
  private i18n = inject(I18n);
  readonly t = this.i18n.t;
  form = signal<IntakeForm | null>(null);
  steps = computed(() => journeySteps(this.form(), this.t(), false));
  readonly how = [
    { icon: '📷', title: 'how.photo', hint: 'how.photoHint' },
    { icon: '👆', title: 'how.taps', hint: 'how.tapsHint' },
    { icon: '✨', title: 'how.looks', hint: 'how.looksHint' },
    { icon: '📅', title: 'how.remind', hint: 'how.remindHint' },
  ];
  async ngOnInit() {
    warmUp();
    try { this.form.set((await this.api.meta()).forms['intake'] ?? null); } catch { /* the wheel still shows the fixed steps */ }
  }
}
