import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';

@Component({
  selector: 'onboard-page',
  imports: [FormsModule, RouterLink],
  template: `
    <header class="topbar"><div class="wrap"><a class="brand" routerLink="/"><span class="brand-mark">a</span><span>Aaina</span></a></div></header>
    <main class="wrap narrow page stack">
      @if (!created()) {
        <div><p class="eyebrow">Set up your salon</p><h2>Your salon on Aaina in one minute</h2></div>
        <form class="card stack" (ngSubmit)="submit()">
          <label class="field"><span class="label">Salon name</span>
            <input class="input" name="name" [(ngModel)]="name" (ngModelChange)="suggestSlug()" required placeholder="e.g. Glow Unisex Salon" /></label>
          <label class="field"><span class="label">Your Aaina link</span>
            <input class="input" name="slug" [(ngModel)]="slug" required pattern="[a-z0-9-]{3,48}" />
            <span class="hint">aaina.app/t/{{ slug || 'your-salon' }} · lowercase letters, numbers and hyphens</span></label>
          <label class="field"><span class="label">City</span><input class="input" name="city" [(ngModel)]="city" placeholder="e.g. Pune" /></label>
          <div class="field"><span class="label">You style</span>
            <div class="chips">
              @for (a of audiences; track a.v) {
                <button type="button" class="chip" [class.on]="audience === a.v" (click)="audience = a.v">{{ a.l }}</button>
              }
            </div></div>
          <label class="field"><span class="label">Brand colour</span>
            <input class="input color" type="color" name="color" [(ngModel)]="color" /></label>
          <details><summary class="muted small">Admin key (only if your Aaina server has one)</summary>
            <input class="input" name="key" [(ngModel)]="adminKey" type="password" autocomplete="off" /></details>
          @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
          <button class="btn btn-primary btn-block" [disabled]="busy() || !name || !slug">{{ busy() ? 'Creating…' : 'Create my salon' }}</button>
        </form>
      } @else {
        <div class="card stack center">
          <p class="eyebrow">You're live</p>
          <h2>{{ created()!.name }}</h2>
          <p class="muted">Share this link with your team, or open it on the salon tablet.</p>
          <a class="link" [routerLink]="created()!.url">{{ origin }}{{ created()!.url }}</a>
          <a class="btn btn-primary" [routerLink]="created()!.url">Open my salon</a>
        </div>
      }
    </main>
  `,
  styles: [`.color { padding: 6px; height: 52px; } .err { color: var(--danger); font-weight: 600; } .link { font-weight: 700; word-break: break-all; } details summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; }`],
})
export class OnboardPage {
  private api = inject(Api);
  name = ''; slug = ''; city = ''; audience = 'all'; color = '#0F766E'; adminKey = '';
  audiences = [{ v: 'women', l: 'Women' }, { v: 'men', l: 'Men' }, { v: 'all', l: 'Everyone' }];
  busy = signal(false); error = signal<string | null>(null);
  created = signal<{ name: string; url: string } | null>(null);
  origin = location.origin;
  private slugTouched = false;

  suggestSlug() {
    if (this.slugTouched) return;
    this.slug = this.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  }

  async submit() {
    this.busy.set(true); this.error.set(null);
    try {
      const res = await this.api.createTenant({
        slug: this.slug, name: this.name,
        branding: { primary: this.color, accent: this.color },
        settings: { city: this.city || null, audience: [this.audience] },
      }, this.adminKey || undefined);
      this.created.set({ name: res.name, url: res.url });
    } catch (e: any) {
      this.error.set(e?.status === 409 ? 'That link is taken — try another.' : e?.status === 401 ? 'Admin key required.' : e?.error?.detail?.[0]?.msg ?? 'Could not create the salon. Please try again.');
    } finally { this.busy.set(false); }
  }
}
