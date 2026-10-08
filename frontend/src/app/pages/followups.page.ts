import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth';
import { I18n } from '../core/i18n';
import { AgendaItem } from '../core/models';
import { TopBar } from '../shared/top-bar';

const KIND_ICON: Record<string, string> = { trim: '✂️', spa: '💆', facial: '🧖', routine: '🧴', 'check-in': '👋' };

/** Who is due for what in the next two weeks, with a one-tap WhatsApp reminder. */
@Component({
  selector: 'followups-page',
  imports: [DatePipe, RouterLink, TopBar],
  template: `
    <top-bar />
    <main class="wrap page narrow stack">
      <h1 class="pt">📅 {{ t()('follow.title') }}</h1>
      <p class="muted">{{ t()('follow.lead') }}</p>
      @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
      @if (loading()) { <div class="skeleton" style="height:180px"></div> }
      @else if (!items().length) {
        <div class="card center"><p class="big" aria-hidden="true">🗓️</p><p>{{ t()('follow.empty') }}</p><a class="btn btn-brand" routerLink="/start">✂️ {{ t()('home.newCustomer') }}</a></div>
      } @else {
        @for (g of groups(); track g.date) {
          <section>
            <h2 class="day">{{ g.date | date: 'EEEE d MMM' }}</h2>
            <ul class="items">
              @for (i of g.items; track $index) {
                <li class="card flat">
                  <span class="ic" aria-hidden="true">{{ icon(i.kind) }}</span>
                  <div class="txt"><strong>{{ i.customer.name || t()('customers.noName') }}</strong><span class="muted small">{{ t()('kind.' + i.kind, null, i.title) }}</span></div>
                  @if (i.customer.phone) {
                    <a class="btn btn-brand btn-sm" [href]="whatsapp(i)" target="_blank" rel="noopener" data-noread>💬 {{ t()('follow.remind') }}</a>
                  }
                </li>
              }
            </ul>
          </section>
        }
      }
    </main>
  `,
  styles: [`
    .pt { font-family: var(--font); font-size: 1.6rem; font-weight: 800; margin: 0; }
    .day { font-size: 1.05rem; margin: 8px 0; }
    .items { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .items li { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
    .ic { font-size: 1.8rem; width: 48px; height: 48px; display: grid; place-items: center; background: var(--soft); border-radius: 14px; flex: none; }
    .txt { flex: 1; display: flex; flex-direction: column; }
    .big { font-size: 3rem; margin: 0; }
    .err { color: var(--danger); font-weight: 600; }
  `],
})
export class FollowUpsPage implements OnInit {
  private api = inject(Api);
  private auth = inject(Auth);
  readonly t = inject(I18n).t;
  items = signal<AgendaItem[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  groups = computed(() => {
    const out: { date: string; items: AgendaItem[] }[] = [];
    for (const i of this.items()) {
      const g = out.find(x => x.date === i.date);
      g ? g.items.push(i) : out.push({ date: i.date, items: [i] });
    }
    return out;
  });

  async ngOnInit() {
    try { this.items.set(await this.api.agenda(14)); } catch { this.error.set(this.t()('common.netFail')); }
    finally { this.loading.set(false); }
  }
  icon(kind: string) { return KIND_ICON[kind] ?? '✨'; }
  /** The reminder is written in the app's language, from the salon, ready to send. */
  whatsapp(i: AgendaItem) {
    const digits = (i.customer.phone ?? '').replace(/\D/g, '');
    const to = digits.length === 10 ? '91' + digits : digits;
    const text = this.t()('follow.message', { name: i.customer.name || '', what: this.t()('kind.' + i.kind, null, i.title), salon: this.auth.tenantName() || 'Aaina' });
    return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
  }
}
