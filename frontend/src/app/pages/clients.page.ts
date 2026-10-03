import { Component, OnInit, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { CustomerRow } from '../core/models';
import { SalonStore } from '../core/salon.store';
import { SalonBar } from '../shared/salon-bar';

@Component({
  selector: 'clients-page',
  imports: [SalonBar, FormsModule, RouterLink, DatePipe],
  template: `
    <salon-bar [slug]="slug()" [name]="store.salon()?.name" />
    <main class="wrap narrow page stack">
      <div class="spread"><h2>Clients</h2><a class="btn btn-primary btn-sm" [routerLink]="['/t', slug(), 'consult']">New consultation</a></div>
      <input class="input" type="search" placeholder="Search by name or mobile" [(ngModel)]="q" (ngModelChange)="search()" aria-label="Search clients" />
      @if (rows(); as rows) {
        @if (rows.length) {
          <ul class="list card flat">
            @for (r of rows; track r.id) {
              <li><a class="rowlink" [routerLink]="['/t', slug(), 'clients', r.id]">
                <span class="av" aria-hidden="true">{{ (r.name || '?').charAt(0).toUpperCase() }}</span>
                <span class="who"><strong>{{ r.name || 'Unnamed client' }}</strong><span class="muted small">{{ r.phone || 'no mobile' }} · {{ r.visits }} visit{{ r.visits === 1 ? '' : 's' }}</span></span>
                <span class="muted small">{{ r.last_visit | date: 'd MMM' }}</span>
              </a></li>
            }
          </ul>
        } @else { <p class="muted center">No clients yet. They appear after their first consultation.</p> }
      } @else { <div class="skeleton" style="height:240px"></div> }
    </main>
  `,
  styles: [`.rowlink { display: grid; grid-template-columns: 40px 1fr auto; gap: 12px; align-items: center; text-decoration: none; min-height: 44px; } .av { width: 40px; height: 40px; border-radius: 50%; background: var(--soft); display: grid; place-items: center; font-weight: 800; } .who { display: flex; flex-direction: column; } .list.card { padding: 4px 16px; }`],
})
export class ClientsPage implements OnInit {
  slug = input.required<string>();
  store = inject(SalonStore);
  private api = inject(Api);
  rows = signal<CustomerRow[] | null>(null);
  q = '';
  private t?: ReturnType<typeof setTimeout>;
  ngOnInit() { this.store.load(this.slug()); this.load(); }
  search() { clearTimeout(this.t); this.t = setTimeout(() => this.load(), 250); }
  async load() { this.rows.set(await this.api.customers(this.slug(), this.q)); }
}
