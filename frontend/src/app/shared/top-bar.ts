import { Component, inject, input } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Auth } from '../core/auth';
import { I18n } from '../core/i18n';
import { Speech } from '../core/speech';

/** Header on every page: brand, read-aloud, language; and, for a signed-in salon, the three big tabs. */
@Component({
  selector: 'top-bar',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="topbar" data-noread>
      <div class="wrap">
        <a class="brand" routerLink="/" aria-label="Aaina"><span class="brand-mark" aria-hidden="true">a</span><span>Aaina</span></a>
        <div class="tb-right">
          @if (speech.supported) {
            <button type="button" class="tb-btn listen" (click)="listen()" [attr.aria-label]="t()(speech.speaking() ? 'common.stop' : 'common.listen')">
              <span aria-hidden="true">{{ speech.speaking() ? '⏹' : '🔊' }}</span><span class="lbl">{{ t()(speech.speaking() ? 'common.stop' : 'common.listen') }}</span>
            </button>
          }
          <a class="tb-btn lang" routerLink="/language" [attr.aria-label]="t()('common.language')"><span aria-hidden="true">🌐</span> {{ i18n.current()?.native ?? 'English' }}</a>
        </div>
      </div>
      @if (auth.session(); as s) {
        <div class="wrap salon"><span>💈 {{ s.tenantName }}</span><button type="button" class="link" (click)="signOut()">{{ t()('common.signOut') }}</button></div>
      }
    </header>
    @if (auth.session() && !hideTabs()) {
      <nav class="tabbar" data-noread aria-label="Aaina">
        <a routerLink="/start" routerLinkActive="on"><span aria-hidden="true">✂️</span>{{ t()('nav.new') }}</a>
        <a routerLink="/customers" routerLinkActive="on"><span aria-hidden="true">👥</span>{{ t()('nav.customers') }}</a>
        <a routerLink="/follow-ups" routerLinkActive="on"><span aria-hidden="true">📅</span>{{ t()('nav.followUps') }}</a>
      </nav>
    }
  `,
  styles: [`
    .tb-right { display: flex; align-items: center; gap: 8px; }
    .tb-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border-radius: 999px; font-weight: 700; font-size: .95rem; text-decoration: none; cursor: pointer; }
    .listen { background: var(--ink); color: #fff; border: 0; }
    .lang { background: #fff; border: 1.5px solid var(--line); color: var(--ink); }
    @media (max-width: 440px) { .listen .lbl { display: none; } .listen { width: 44px; padding: 0; justify-content: center; font-size: 1.15rem; } .brand span:last-child { font-size: 1.05rem; } }
    .salon { display: flex; justify-content: space-between; align-items: center; height: auto !important; padding-bottom: 8px; font-weight: 700; color: var(--ink-3); font-size: .9rem; }
    .link { background: none; border: 0; color: var(--brand); font-weight: 700; cursor: pointer; min-height: 36px; font: inherit; }
    .tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; display: grid; grid-template-columns: repeat(3, 1fr); background: #fff; border-top: 1px solid var(--line); padding: 6px 6px calc(6px + env(safe-area-inset-bottom)); box-shadow: 0 -8px 24px -16px rgba(0,0,0,.25); }
    .tabbar a { display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 60px; justify-content: center; border-radius: 14px; text-decoration: none; color: var(--ink-3); font-weight: 700; font-size: .82rem; }
    .tabbar a span { font-size: 1.5rem; line-height: 1.1; }
    .tabbar a.on { color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, #fff); }
  `],
})
export class TopBar {
  /** Kept for pages that pass an action; the tab bar now covers navigation. */
  action = input<{ label: string; link: string } | null>(null);
  hideTabs = input(false);
  readonly auth = inject(Auth);
  readonly i18n = inject(I18n);
  readonly speech = inject(Speech);
  readonly t = this.i18n.t;
  private router = inject(Router);

  listen() {
    if (this.speech.speaking()) this.speech.stop();
    else this.speech.readElement(document.querySelector('main'));
  }
  signOut() { this.auth.logout(); this.router.navigate(['/']); }
}
