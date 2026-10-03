import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { warmUp } from '../core/face-measure';
import { journeySteps } from '../core/journey';
import { IntakeForm } from '../core/models';
import { Chakra } from '../shared/chakra';
import { TopBar } from '../shared/top-bar';

@Component({
  selector: 'home-page',
  imports: [RouterLink, Chakra, TopBar],
  template: `
    <top-bar />
    <main class="wrap page">
      <section class="hero">
        <div class="copy">
          <p class="eyebrow">Your AI mirror</p>
          <h1>Find the haircut that truly suits <em>you</em>.</h1>
          <p class="lead muted">{{ steps().length }} simple steps around one chakra. About two minutes. You see every step as it fills in.</p>
          <a class="btn btn-brand go" routerLink="/start">Start my consultation</a>
          <p class="muted small">No sign-up. Your photo is measured on your phone and never saved.</p>
        </div>
        <chakra class="wheel" [steps]="steps()" [current]="-1" [hubText]="{ big: '' + steps().length, small: 'steps' }" />
      </section>

      <section class="steps" aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol>
          @for (s of steps(); track s.id; let i = $index) {
            <li><span class="n">{{ i + 1 }}</span><div><strong>{{ s.label }}</strong><p class="muted small">{{ s.hint }}</p></div></li>
          }
        </ol>
      </section>
      <p class="muted small center foot">Grooming guidance, not medical advice.</p>
    </main>
  `,
  styles: [`
    .hero { display: grid; gap: 28px; align-items: center; padding: 8px 0 32px; }
    .hero h1 { margin: 0 0 12px; }
    .hero h1 em { color: var(--brand); font-style: italic; }
    .lead { font-size: 1.1rem; max-width: 40ch; }
    .go { margin: 8px 0 12px; min-width: 260px; }
    .wheel { width: min(320px, 82vw); margin: 0 auto; }
    @media (min-width: 900px) { .hero { grid-template-columns: 1.1fr .9fr; gap: 56px; padding: 32px 0 56px; } .wheel { width: 380px; } }
    .steps ol { list-style: none; padding: 0; margin: 16px 0 0; display: grid; gap: 10px; }
    @media (min-width: 720px) { .steps ol { grid-template-columns: repeat(2, 1fr); } }
    @media (min-width: 1000px) { .steps ol { grid-template-columns: repeat(4, 1fr); } }
    .steps li { display: flex; gap: 12px; align-items: flex-start; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 14px; }
    .steps li p { margin: 2px 0 0; }
    .n { width: 30px; height: 30px; border-radius: 50%; flex: none; display: grid; place-items: center; background: var(--brand); color: #fff; font-weight: 800; font-size: .85rem; }
    .foot { margin-top: 28px; }
  `],
})
export class HomePage implements OnInit {
  private api = inject(Api);
  form = signal<IntakeForm | null>(null);
  steps = computed(() => journeySteps(this.form()));
  async ngOnInit() {
    warmUp();
    try { this.form.set((await this.api.meta()).forms['intake'] ?? null); } catch { /* the wheel still shows the fixed steps */ }
  }
}
