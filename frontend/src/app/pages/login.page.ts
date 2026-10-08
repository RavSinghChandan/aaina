import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Auth } from '../core/auth';
import { TopBar } from '../shared/top-bar';
import { I18n } from '../core/i18n';

@Component({
  selector: 'login-page',
  imports: [FormsModule, RouterLink, TopBar],
  template: `
    <top-bar />
    <main class="wrap narrow page">
      <form class="card auth stack" (ngSubmit)="submit()" novalidate>
        <p class="eyebrow">{{ t()('login.eyebrow') }}</p>
        <h1 class="lt">{{ t()('login.title') }}</h1>
        <p class="muted">{{ t()('login.lead') }}</p>
        <label class="field"><span class="label">{{ t()('login.key') }}</span>
          <input class="input mono" name="tenantKey" [(ngModel)]="tenantKey" autocomplete="off" spellcheck="false" placeholder="your-salon.XXXXXXXXXXXXXXXX" required maxlength="80" /></label>
        <label class="field"><span class="label">{{ t()('login.username') }}</span>
          <input class="input" name="username" [(ngModel)]="username" autocomplete="username" autocapitalize="off" spellcheck="false" required maxlength="32" /></label>
        @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
        <button type="submit" class="btn btn-primary btn-block" [disabled]="busy() || !tenantKey.trim() || !username.trim()">{{ busy() ? (waking() ? t()('login.waking') : t()('common.wait')) : t()('home.signIn') }}</button>
        <p class="muted small center">{{ t()('login.noKey') }} <a routerLink="/register">{{ t()('home.register') }}</a></p>
      </form>
    </main>
  `,
  styles: [`.auth { margin-top: 1.5rem; } .lt { font-size: clamp(1.6rem, 5vw, 2.1rem); margin: 0; } .err { color: var(--danger); font-weight: 600; margin: 0; } .mono { font-family: ui-monospace, Menlo, monospace; letter-spacing: 0.02em; }`],
})
export class LoginPage {
  private auth = inject(Auth);
  readonly t = inject(I18n).t;
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  tenantKey = ''; username = '';
  busy = signal(false);
  waking = signal(false);
  error = signal<string | null>(null);

  /** A sign-in link (/login#k=<tenant key>&u=<username>) fills the form and signs in. The part after # never reaches a server. */
  constructor() {
    const hash = new URLSearchParams((typeof location !== 'undefined' ? location.hash : '').replace(/^#/, ''));
    const k = hash.get('k'), u = hash.get('u');
    if (k && u) {
      this.tenantKey = k; this.username = u;
      history.replaceState(null, '', location.pathname + location.search);   // drop the key from the address bar
      this.submit();
    }
  }

  async submit() {
    this.busy.set(true); this.error.set(null);
    try {
      // the free server sleeps when idle: keep trying for about a minute while it wakes up
      for (let attempt = 0; ; attempt++) {
        try { await this.auth.login(this.tenantKey.trim(), this.username.trim()); break; }
        catch (e) {
          const st = e instanceof HttpErrorResponse ? e.status : 0;
          if (![0, 502, 503, 504].includes(st) || attempt >= 14) throw e;
          this.waking.set(true);
          await new Promise(r => setTimeout(r, 4000));
        }
      }
      const next = this.route.snapshot.queryParamMap.get('next') || '/';
      this.router.navigateByUrl(next.startsWith('/') ? next : '/');
    } catch (e) {
      const s = e instanceof HttpErrorResponse ? e.status : 0;
      this.error.set(this.t()(s === 401 ? 'login.wrong' : s === 403 ? 'login.off' : s === 429 ? 'login.tooMany' : 'common.netFail'));
    } finally { this.busy.set(false); this.waking.set(false); }
  }
}
