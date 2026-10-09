import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { I18n } from '../core/i18n';
import { CustomerDetail, CustomerRow } from '../core/models';
import { TopBar } from '../shared/top-bar';

/** The salon's customers: who came, how often, what they chose. Tap one to see their looks again. */
@Component({
  selector: 'customers-page',
  imports: [DatePipe, FormsModule, RouterLink, TopBar],
  template: `
    <top-bar />
    <main class="wrap page narrow stack">
      <h1 class="pt">👥 {{ t()('customers.title') }}</h1>
      <input class="input" type="search" [placeholder]="t()('customers.search')" [(ngModel)]="q" (ngModelChange)="search()" data-noread />
      @if (rows().length) { <button type="button" class="btn btn-ghost btn-sm export" (click)="exportCsv()" data-noread>⬇ {{ t()('customers.export') }}</button> }
      @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
      @if (loading()) { <div class="skeleton" style="height:180px"></div> }
      @else if (!rows().length) {
        <div class="card center empty"><p class="big" aria-hidden="true">💈</p><p>{{ t()('customers.empty') }}</p><a class="btn btn-brand" routerLink="/start">✂️ {{ t()('home.newCustomer') }}</a></div>
      } @else {
        <ul class="rows">
          @for (r of rows(); track r.id) {
            <li>
              <button type="button" class="row-btn" (click)="open(r)" [attr.aria-expanded]="openId() === r.id">
                <span class="av" aria-hidden="true">{{ (r.name || '?').charAt(0).toUpperCase() }}</span>
                <span class="who"><strong>{{ r.name || t()('customers.noName') }}</strong>
                  <span class="muted small">{{ t()('customers.visits', { n: r.visits }) }}@if (r.last_visit) { · {{ r.last_visit | date: 'd MMM' }} }</span></span>
                <span aria-hidden="true">›</span>
              </button>
              @if (openId() === r.id && detail(); as d) {
                <div class="detail">
                  @if (d.phone) { <a class="btn btn-ghost btn-sm" [href]="'tel:' + d.phone">📞 {{ d.phone }}</a> }
                  <ol class="visits">
                    @for (v of d.consultations; track v.id) {
                      <li>
                        <span>{{ v.created_at | date: 'd MMM, h:mm a' }}</span>
                        @if (v.status === 'done') { <a [routerLink]="['/looks', v.id]">{{ t()('customers.seeLooks') }} ›</a> }
                        @else { <span class="muted small">{{ v.status }}</span> }
                      </li>
                    }
                  </ol>
                </div>
              }
            </li>
          }
        </ul>
      }
    </main>
  `,
  styles: [`
    .export { align-self: flex-start; }
    .pt { font-family: var(--font); font-size: 1.6rem; font-weight: 800; margin: 0; }
    .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .rows > li { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius-sm); overflow: hidden; }
    .row-btn { width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 14px; min-height: 68px; border: 0; background: none; text-align: left; cursor: pointer; font: inherit; color: var(--ink); }
    .av { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--brand) 14%, #fff); color: var(--brand); font-weight: 800; flex: none; }
    .who { flex: 1; display: flex; flex-direction: column; }
    .detail { padding: 0 14px 14px; display: grid; gap: 8px; }
    .visits { list-style: none; padding: 0; margin: 0; }
    .visits li { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); }
    .visits a { color: var(--brand); font-weight: 700; }
    .empty .big { font-size: 3rem; margin: 0; }
    .err { color: var(--danger); font-weight: 600; }
  `],
})
export class CustomersPage implements OnInit {
  private api = inject(Api);
  readonly t = inject(I18n).t;
  q = '';
  rows = signal<CustomerRow[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  openId = signal<string | null>(null);
  detail = signal<CustomerDetail | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  ngOnInit() { this.load(); }
  search() { clearTimeout(this.timer); this.timer = setTimeout(() => this.load(), 300); }
  async load() {
    this.error.set(null);
    try { this.rows.set(await this.api.customers(this.q)); } catch { this.error.set(this.t()('common.netFail')); }
    finally { this.loading.set(false); }
  }
  async open(r: CustomerRow) {
    if (this.openId() === r.id) { this.openId.set(null); return; }
    this.openId.set(r.id); this.detail.set(null);
    try { this.detail.set(await this.api.customer(r.id)); } catch { this.error.set(this.t()('common.netFail')); }
  }

  /** The salon's customer list as a CSV file, for its own billing app or WhatsApp tool. */
  async exportCsv() {
    try {
      const csv = await this.api.customersCsv();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'aaina-customers.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { this.error.set(this.t()('common.netFail')); }
  }
}
