import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Auth } from '../core/auth';
import { TopBar } from '../shared/top-bar';

@Component({
  selector: 'login-page',
  imports: [FormsModule, TopBar],
  template: `
    <top-bar />
    <main class="wrap narrow page">
      <form class="card login stack" (ngSubmit)="submit()" novalidate>
        <p class="eyebrow">Sign in</p>
        <h1 class="lt">Welcome to Aaina</h1>
        <p class="muted">Free, and takes ten seconds. Signing in keeps the AI fair for everyone: each person gets {{ perDay }} consultations a day.</p>
        <label class="field"><span class="label">Your name</span>
          <input class="input" name="name" [(ngModel)]="name" autocomplete="given-name" required maxlength="60" /></label>
        <label class="field"><span class="label">Email</span>
          <input class="input" name="email" [(ngModel)]="email" type="email" inputmode="email" autocomplete="email" required maxlength="120" /></label>
        @if (needsCode()) {
          <label class="field"><span class="label">Access code</span>
            <input class="input" name="code" [(ngModel)]="code" type="password" autocomplete="current-password" maxlength="120" /></label>
        }
        @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
        <button type="submit" class="btn btn-primary btn-block" [disabled]="busy() || !name.trim() || !email.trim() || (needsCode() && !code.trim())">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
        <p class="muted small">Free to use. You stay signed in on this device for 7 days.</p>
      </form>
    </main>
  `,
  styles: [`.login { margin-top: 1.5rem; } .lt { font-size: clamp(1.6rem, 5vw, 2.1rem); margin: 0; } .err { color: var(--danger); font-weight: 600; margin: 0; }`],
})
export class LoginPage {
  private auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  name = ''; email = ''; code = '';
  readonly perDay = 10;
  needsCode = signal(false);
  constructor() { this.auth.needsCode().then(v => this.needsCode.set(v)); }
  busy = signal(false);
  error = signal<string | null>(null);

  async submit() {
    this.busy.set(true); this.error.set(null);
    try {
      await this.auth.login(this.name.trim(), this.email.trim(), this.code.trim());
      const next = this.route.snapshot.queryParamMap.get('next') || '/start';
      this.router.navigateByUrl(next.startsWith('/') ? next : '/start');
    } catch (e) {
      const status = e instanceof HttpErrorResponse ? e.status : 0;
      this.error.set(status === 401 ? 'That access code is not right.' : status === 422 ? 'Please enter a valid email address.' : status === 429 ? 'Too many attempts. Please wait a few minutes.'
        : 'Could not reach Aaina. It may be waking up — try again in a few seconds.');
    } finally { this.busy.set(false); }
  }
}
