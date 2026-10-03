import { Component, OnInit, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { SalonStore } from '../core/salon.store';
import { OutputView } from '../shared/output-view';
import { SalonBar } from '../shared/salon-bar';

@Component({
  selector: 'client-page',
  imports: [SalonBar, RouterLink, DatePipe, OutputView],
  template: `
    <salon-bar [slug]="slug()" [name]="store.salon()?.name" />
    <main class="wrap narrow page stack">
      @if (cu(); as cu) {
        <div><p class="eyebrow">Client</p><h2>{{ cu.name || 'Unnamed client' }}</h2><p class="muted">{{ cu.phone || 'No mobile on file' }}</p></div>
        @if (cu.calendar) { <section class="card"><h3>Care calendar</h3><output-view view="timeline" [data]="cu.calendar" /></section> }
        <section class="card">
          <h3>Consultations</h3>
          <ul class="list">
            @for (c of cu.consultations; track c.id) {
              <li class="spread"><span>{{ c.created_at | date: 'd MMM y, h:mm a' }} @if (c.chosen_style_id) {<span class="pill brand">{{ c.chosen_style_id }}</span>}</span>
                <a class="btn btn-ghost btn-sm" [routerLink]="['/t', slug(), 'c', c.id]">Open</a></li>
            }
          </ul>
        </section>
        <section class="card flat stack">
          <h3>Privacy</h3>
          <p class="muted small">Consent given {{ cu.consent?.at | date: 'd MMM y' }}. Erasing removes this client and every consultation for good.</p>
          <button class="btn btn-danger" (click)="erase()">Erase this client's data</button>
        </section>
      } @else { <div class="skeleton" style="height:300px"></div> }
    </main>
  `,
})
export class ClientPage implements OnInit {
  slug = input.required<string>();
  id = input.required<string>();
  store = inject(SalonStore);
  private api = inject(Api);
  private router = inject(Router);
  cu = signal<any>(null);
  async ngOnInit() { this.store.load(this.slug()); this.cu.set(await this.api.customer(this.slug(), this.id())); }
  async erase() {
    if (!confirm('Erase this client and all their consultations? This cannot be undone.')) return;
    await this.api.eraseCustomer(this.slug(), this.id());
    this.router.navigate(['/t', this.slug(), 'clients']);
  }
}
