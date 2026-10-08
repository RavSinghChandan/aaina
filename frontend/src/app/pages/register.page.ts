import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Auth } from '../core/auth';
import { TopBar } from '../shared/top-bar';
import { I18n } from '../core/i18n';

@Component({
  selector: 'register-page',
  imports: [FormsModule, RouterLink, TopBar],
  template: `
    <top-bar />
    <main class="wrap narrow page">
      @if (!done()) {
        <form class="card auth stack" (ngSubmit)="submit()" novalidate>
          <p class="eyebrow">{{ t()('home.register') }}</p>
          <h1 class="lt">{{ t()('reg.title') }}</h1>
          <p class="muted">{{ t()('reg.lead') }}</p>
          <label class="field"><span class="label">{{ t()('reg.business') }}</span><input class="input" name="business" [(ngModel)]="f.business" required maxlength="120" /></label>
          <label class="field"><span class="label">{{ t()('reg.owner') }}</span><input class="input" name="owner" [(ngModel)]="f.owner" autocomplete="name" required maxlength="60" /></label>
          <label class="field"><span class="label">{{ t()('reg.email') }}</span><input class="input" name="email" type="email" inputmode="email" [(ngModel)]="f.email" autocomplete="email" required maxlength="160" /></label>
          <div class="grid grid-2">
            <label class="field"><span class="label">{{ t()('reg.phone') }} <span class="muted small">({{ t()('common.optional') }})</span></span><input class="input" name="phone" inputmode="tel" [(ngModel)]="f.phone" autocomplete="tel" maxlength="20" /></label>
            <label class="field"><span class="label">{{ t()('reg.city') }} <span class="muted small">({{ t()('common.optional') }})</span></span><input class="input" name="city" [(ngModel)]="f.city" maxlength="60" /></label>
          </div>
          @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
          <button type="submit" class="btn btn-primary btn-block" [disabled]="busy() || !f.business.trim() || !f.owner.trim() || !f.email.trim()">{{ busy() ? t()('common.wait') : t()('reg.send') }}</button>
          <p class="muted small center">{{ t()('reg.approved') }} <a routerLink="/login">{{ t()('home.signIn') }}</a></p>
        </form>
      } @else {
        <section class="card auth stack center" role="status">
          <p class="eyebrow">{{ t()('reg.received') }}</p>
          <h1 class="lt">{{ t()('reg.thanks', { name: f.owner.trim() }) }}</h1>
          <p>{{ t()('reg.next', { salon: f.business.trim(), email: f.email.trim() }) }}</p>
          <a class="btn btn-ghost" routerLink="/login">{{ t()('reg.haveKey') }}</a>
        </section>
      }
    </main>
  `,
  styles: [`.auth { margin-top: 1.5rem; } .lt { font-size: clamp(1.6rem, 5vw, 2.1rem); margin: 0; } .err { color: var(--danger); font-weight: 600; margin: 0; }`],
})
export class RegisterPage {
  readonly t = inject(I18n).t;
  private auth = inject(Auth);
  f = { business: '', owner: '', email: '', phone: '', city: '' };
  busy = signal(false);
  done = signal(false);
  error = signal<string | null>(null);

  async submit() {
    this.busy.set(true); this.error.set(null);
    try {
      await this.auth.register({ business: this.f.business.trim(), owner: this.f.owner.trim(), email: this.f.email.trim(), phone: this.f.phone.trim(), city: this.f.city.trim() });
      this.done.set(true);
    } catch (e) {
      const s = e instanceof HttpErrorResponse ? e.status : 0;
      this.error.set(this.t()(s === 422 ? 'reg.badEmail' : s === 429 ? 'login.tooMany' : 'common.netFail'));
    } finally { this.busy.set(false); }
  }
}
