import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { AgendaItem } from '../core/models';
import { SalonStore } from '../core/salon.store';
import { SalonBar } from '../shared/salon-bar';

@Component({
  selector: 'agenda-page',
  imports: [SalonBar, RouterLink, DatePipe],
  template: `
    <salon-bar [slug]="slug()" [name]="store.salon()?.name" />
    <main class="wrap narrow page stack">
      <div><p class="eyebrow">Follow-ups</p><h2>Who is due</h2></div>
      <div class="chips" role="group" aria-label="Time range">
        @for (d of [7, 14, 30]; track d) { <button class="chip" [class.on]="days() === d" (click)="setDays(d)">Next {{ d }} days</button> }
      </div>
      @if (items(); as items) {
        @if (items.length) {
          @for (g of groups(); track g.date) {
            <section>
              <h3 class="day">{{ g.date | date: 'EEEE, d MMM' }}</h3>
              <ul class="list card flat">
                @for (i of g.items; track $index) {
                  <li class="item">
                    <div><strong>{{ i.customer.name || 'Client' }}</strong> — {{ i.title }}<div class="muted small">{{ i.detail }}</div></div>
                    <div class="row">
                      @if (i.customer.phone) { <a class="btn btn-brand btn-sm" [href]="wa(i)" target="_blank" rel="noopener">WhatsApp</a> }
                      <a class="btn btn-ghost btn-sm" [routerLink]="['/t', slug(), 'clients', i.customer.id]">Profile</a>
                    </div>
                  </li>
                }
              </ul>
            </section>
          }
        } @else { <p class="muted center">No one is due in this period.</p> }
      } @else { <div class="skeleton" style="height:240px"></div> }
    </main>
  `,
  styles: [`.day { margin: 8px 0; } .list.card { padding: 4px 16px; } .item { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }`],
})
export class AgendaPage implements OnInit {
  slug = input.required<string>();
  store = inject(SalonStore);
  private api = inject(Api);
  days = signal(14);
  items = signal<AgendaItem[] | null>(null);
  groups = computed(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const i of this.items() ?? []) map.set(i.date, [...(map.get(i.date) ?? []), i]);
    return [...map.entries()].map(([date, items]) => ({ date, items }));
  });
  ngOnInit() { this.store.load(this.slug()); this.load(); }
  setDays(d: number) { this.days.set(d); this.load(); }
  async load() { this.items.set(null); this.items.set(await this.api.agenda(this.slug(), this.days())); }
  wa(i: AgendaItem) {
    const phone = (i.customer.phone ?? '').replace(/\D/g, '');
    const intl = phone.length === 10 ? '91' + phone : phone;
    const text = `Hi ${i.customer.name ?? ''}! A gentle reminder from ${this.store.salon()?.name ?? 'your salon'}: ${i.title}. ${i.detail} Reply to book a slot.`;
    return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
  }
}
