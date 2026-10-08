import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { I18n } from '../core/i18n';
import { Speech } from '../core/speech';
import { TopBar } from '../shared/top-bar';

/** Pick a language by its own script; no English needed. */
@Component({
  selector: 'language-page',
  imports: [TopBar],
  template: `
    <top-bar [hideTabs]="true" />
    <main class="wrap page narrow">
      <h1 class="lt">🌐 {{ t()('common.chooseLanguage') }}</h1>
      @if (i18n.lang() !== 'en') { <p class="muted">Choose your language</p> }
      <div class="langs">
        @for (l of i18n.available(); track l.code) {
          <button type="button" class="lng" [class.on]="i18n.chosen() && l.code === i18n.lang()" (click)="pick(l.code)" [attr.lang]="l.code">
            <span class="native">{{ l.native }}</span>@if (l.code !== 'en') {<span class="en">{{ l.english }}</span>}
          </button>
        }
      </div>
    </main>
  `,
  styles: [`
    .lt { font-family: var(--font); font-size: 1.7rem; font-weight: 800; }
    .langs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 18px; }
    .lng { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-height: 92px; border-radius: var(--radius); border: 1.5px solid var(--line); background: #fff; box-shadow: var(--shadow); cursor: pointer; }
    .lng.on { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 8%, #fff); }
    .native { font-size: 1.6rem; font-weight: 800; color: var(--ink); }
    .en { font-size: .85rem; font-weight: 600; color: var(--ink-3); }
  `],
})
export class LanguagePage {
  readonly i18n = inject(I18n);
  readonly t = this.i18n.t;
  private speech = inject(Speech);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  async pick(code: string) {
    await this.i18n.set(code);
    this.speech.say(this.t()('common.languageSet'));
    this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('next') || '/');
  }
}
