import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Auth } from '../core/auth';
import { TopBar } from '../shared/top-bar';

@Component({
  selector: 'login-page',
  imports: [FormsModule, RouterLink, TopBar],
  template: `
    <top-bar />
    <main class="wrap narrow page">
      <form class="card auth stack" (ngSubmit)="submit()" novalidate>
        <p class="eyebrow">Salon sign in</p>
        <h1 class="lt">Welcome back</h1>
        <p class="muted">Sign in with the tenant key and username you received after your salon was approved.</p>
        <label class="field"><span class="label">Tenant key</span>
          <input class="input mono" name="tenantKey" [(ngModel)]="tenantKey" autocomplete="off" spellcheck="false" placeholder="your-salon.XXXXXXXXXXXXXXXX" required maxlength="80" /></label>
        <label class="field"><span class="label">Username</span>
          <input class="input" name="username" [(ngModel)]="username" autocomplete="username" autocapitalize="off" spellcheck="false" required maxlength="32" /></label>
        @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
        <button type="submit" class="btn btn-primary btn-block" [disabled]="busy() || !tenantKey.trim() || !username.trim()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
        <p class="muted small center">No tenant key yet? <a routerLink="/register">Register your salon</a></p>
      </form>
    </main>
  `,
  styles: [`.auth { margin-top: 1.5rem; } .lt { font-size: clamp(1.6rem, 5vw, 2.1rem); margin: 0; } .err { color: var(--danger); font-weight: 600; margin: 0; } .mono { font-family: ui-monospace, Menlo, monospace; letter-spacing: 0.02em; }`],
})
export class LoginPage {
  private auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  tenantKey = ''; username = '';
  busy = signal(false);
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
      await this.auth.login(this.tenantKey.trim(), this.username.trim());
      const next = this.route.snapshot.queryParamMap.get('next') || '/start';
      this.router.navigateByUrl(next.startsWith('/') ? next : '/start');
    } catch (e) {
      const s = e instanceof HttpErrorResponse ? e.status : 0;
      this.error.set(s === 401 ? 'Tenant key or username is not right.' : s === 403 ? 'This access has been turned off. Please contact Aaina.'
        : s === 429 ? 'Too many attempts. Please wait a few minutes.' : 'Could not reach Aaina. It may be waking up — try again in a few seconds.');
    } finally { this.busy.set(false); }
  }
}
