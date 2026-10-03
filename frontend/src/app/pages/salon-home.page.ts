import { Component, OnInit, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { AgendaItem } from '../core/models';
import { SalonStore } from '../core/salon.store';
import { SalonBar } from '../shared/salon-bar';

@Component({
  selector: 'salon-home',
  imports: [RouterLink, SalonBar, DatePipe],
  template: `
    <salon-bar [slug]="slug()" [name]="store.salon()?.name" />
    <main class="wrap page stack">
      @if (store.error()) { <div class="card center"><h2>Hmm.</h2><p class="muted">{{ store.error() }}</p><a class="btn btn-ghost" routerLink="/">Back to Aaina</a></div> }
      @else if (store.salon(); as s) {
        <section class="welcome">
          <p class="eyebrow">{{ s.settings.city || 'Welcome' }}</p>
          <h1>{{ s.name }}</h1>
          <p class="lead">{{ s.branding.tagline }}</p>
          <a class="btn btn-primary big" [routerLink]="['/t', slug(), 'consult']">Start a consultation</a>
          <p class="muted small">{{ s.ai ? 'AI photo analysis is on.' : 'Running in offline mode — answers drive the analysis.' }}
            · {{ s.usage.this_month }} of {{ s.usage.limit }} consultations this month</p>
        </section>
        <section class="grid grid-2">
          <a class="card tile" [routerLink]="['/t', slug(), 'agenda']">
            <h3>Due this week</h3>
            @if (due().length) { <p class="muted">{{ due().length }} reminders — next: {{ due()[0].customer.name || 'a client' }}, {{ due()[0].title }} ({{ due()[0].date | date: 'd MMM' }})</p> }
            @else { <p class="muted">No one is due yet. Reminders appear after consultations.</p> }
          </a>
          <a class="card tile" [routerLink]="['/t', slug(), 'clients']"><h3>Clients</h3><p class="muted">Profiles, past looks and care calendars.</p></a>
        </section>
      } @else { <div class="skeleton" style="height:220px"></div> }
    </main>
  `,
  styles: [`.welcome { padding: 12px 0 8px; } .lead { color: var(--ink-2); font-size: 1.1rem; } .big { min-height: 60px; padding: 0 32px; font-size: 1.1rem; margin: 8px 0 12px; } .tile { text-decoration: none; display: block; } .tile:hover { border-color: var(--ink-3); }`],
})
export class SalonHomePage implements OnInit {
  slug = input.required<string>();
  store = inject(SalonStore);
  private api = inject(Api);
  due = signal<AgendaItem[]>([]);

  async ngOnInit() {
    if (await this.store.load(this.slug())) {
      this.api.agenda(this.slug(), 7).then(a => this.due.set(a)).catch(() => {});
    }
  }
}
