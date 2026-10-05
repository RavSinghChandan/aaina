import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Auth } from '../core/auth';
import { TopBar } from '../shared/top-bar';

@Component({
  selector: 'register-page',
  imports: [FormsModule, RouterLink, TopBar],
  template: `
    <top-bar />
    <main class="wrap narrow page">
      @if (!done()) {
        <form class="card auth stack" (ngSubmit)="submit()" novalidate>
          <p class="eyebrow">Register your salon</p>
          <h1 class="lt">Bring Aaina to your salon</h1>
          <p class="muted">Tell us about your salon. Once we approve it, you get your own space in Aaina with a tenant key and username to sign in.</p>
          <label class="field"><span class="label">Salon or business name</span><input class="input" name="business" [(ngModel)]="f.business" required maxlength="120" /></label>
          <label class="field"><span class="label">Your name</span><input class="input" name="owner" [(ngModel)]="f.owner" autocomplete="name" required maxlength="60" /></label>
          <label class="field"><span class="label">Email</span><input class="input" name="email" type="email" inputmode="email" [(ngModel)]="f.email" autocomplete="email" required maxlength="160" /></label>
          <div class="grid grid-2">
            <label class="field"><span class="label">Mobile <span class="muted small">(optional)</span></span><input class="input" name="phone" inputmode="tel" [(ngModel)]="f.phone" autocomplete="tel" maxlength="20" /></label>
            <label class="field"><span class="label">City <span class="muted small">(optional)</span></span><input class="input" name="city" [(ngModel)]="f.city" maxlength="60" /></label>
          </div>
          @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
          <button type="submit" class="btn btn-primary btn-block" [disabled]="busy() || !f.business.trim() || !f.owner.trim() || !f.email.trim()">{{ busy() ? 'Sending…' : 'Request access' }}</button>
          <p class="muted small center">Already approved? <a routerLink="/login">Sign in</a></p>
        </form>
      } @else {
        <section class="card auth stack center" role="status">
          <p class="eyebrow">Request received</p>
          <h1 class="lt">Thank you, {{ f.owner.trim() }}</h1>
          <p>We have your request for <strong>{{ f.business.trim() }}</strong>. When it is approved you will receive your <strong>tenant key</strong> and <strong>username</strong> at {{ f.email.trim() }}.</p>
          <a class="btn btn-ghost" routerLink="/login">I have my tenant key</a>
        </section>
      }
    </main>
  `,
  styles: [`.auth { margin-top: 1.5rem; } .lt { font-size: clamp(1.6rem, 5vw, 2.1rem); margin: 0; } .err { color: var(--danger); font-weight: 600; margin: 0; }`],
})
export class RegisterPage {
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
      this.error.set(s === 422 ? 'Please check the email address.' : s === 429 ? 'Too many requests. Please try again later.' : 'Could not reach Aaina. It may be waking up — try again in a few seconds.');
    } finally { this.busy.set(false); }
  }
}
