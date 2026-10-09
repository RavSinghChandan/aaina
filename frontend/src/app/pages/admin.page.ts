import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from '../core/config';
import { TopBar } from '../shared/top-bar';
import { I18n } from '../core/i18n';

interface Reg {
  id: string; business: string; owner: string; email: string; phone: string; city: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked'; tenant: string | null; username: string | null; tenant_key: string | null; created_at: string;
}
const KEY = 'aaina.admin';

/** The owner's page: approve salons and send them their tenant key + username. */
interface Ops {
  uptime_s: number; requests: number; server_error_rate: number;
  consultations: { total: number; failed: number };
  agents: { step: string; runs: number; failed: number; sources: Record<string, number>; fallback_rate: number; p50_ms: number | null; p95_ms: number | null }[];
  repairs: { sent_back: number; fixed: number };
  salons_today: Record<string, number>;
}

@Component({
  selector: 'admin-page',
  imports: [FormsModule, TopBar],
  template: `
    <top-bar [hideTabs]="true" />
    <main class="wrap page stack">
      <header><p class="eyebrow">Owner</p><h1 class="lt">Salon access</h1></header>

      @if (!unlocked()) {
        <form class="card stack narrowcard" (ngSubmit)="unlock()">
          <label class="field"><span class="label">Admin key</span>
            <input class="input" name="key" type="password" [(ngModel)]="adminKey" autocomplete="off" /></label>
          @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
          <button type="submit" class="btn btn-primary" [disabled]="!adminKey.trim()">Open</button>
        </form>
      } @else {
        @if (issued(); as k) {
          <section class="card issued stack" role="status">
            <p class="eyebrow">Access issued · send this to {{ k.owner }}</p>
            <dl class="kv">
              <div><dt>Salon</dt><dd>{{ k.business }}</dd></div>
              <div><dt>Tenant key</dt><dd class="mono">{{ k.tenant_key }}</dd></div>
              <div><dt>Username</dt><dd class="mono">{{ k.username }}</dd></div>
              <div><dt>Sign-in link</dt><dd class="mono"><a [href]="link(k)" target="_blank" rel="noopener">{{ link(k) }}</a></dd></div>
            </dl>
            <div class="row">
              <button type="button" class="btn btn-primary btn-sm" (click)="copy(link(k))">{{ copied() ? 'Copied ✓' : 'Copy sign-in link' }}</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="copy(message(k))">Copy message</button>
              @if (k.email) { <a class="btn btn-ghost btn-sm" [href]="mailto(k)">Email it</a> }
              <button type="button" class="btn btn-ghost btn-sm" (click)="issued.set(null)">Done</button>
            </div>
          </section>
        }

        @if (ops(); as o) {
          <section class="card stack">
            <div class="row between"><h2 class="h2">Service health</h2><button type="button" class="btn btn-ghost btn-sm" (click)="loadOps()">Refresh</button></div>
            <div class="tiles">
              <div><b>{{ o.consultations.total }}</b>consultations</div>
              <div [class.bad]="o.server_error_rate > 0.01"><b>{{ pct(o.server_error_rate) }}</b>server errors</div>
              <div><b>{{ o.requests }}</b>API calls</div>
              <div><b>{{ o.repairs.sent_back }}/{{ o.repairs.fixed }}</b>AI answers repaired</div>
            </div>
            @if (o.agents.length) {
              <table class="tbl">
                <tr><th>Agent step</th><th>Runs</th><th>AI kept</th><th>Fell back</th><th>p50 ms</th><th>p95 ms</th></tr>
                @for (a of o.agents; track a.step) {
                  <tr><td>{{ a.step }}</td><td>{{ a.runs }}</td><td>{{ modelRuns(a) }}</td>
                    <td [class.bad]="a.fallback_rate > 0.1">{{ pct(a.fallback_rate) }}</td><td>{{ a.p50_ms ?? '–' }}</td><td>{{ a.p95_ms ?? '–' }}</td></tr>
                }
              </table>
            }
            <p class="muted small">Since the server started {{ uptime(o.uptime_s) }} ago.@if (salonsToday(o).length) { Salons today: @for (s of salonsToday(o); track s[0]; let last = $last) {{{ s[0] }} ({{ s[1] }}){{ last ? '' : ', ' }}} }</p>
          </section>
        }

        <section class="card stack">
          <label class="field"><span class="label">Language for sign-in links</span>
            <select class="input" [(ngModel)]="linkLang" name="ll">
              @for (l of i18n.available(); track l.code) { <option [value]="l.code">{{ l.native }} · {{ l.english }}</option> }
            </select></label>
          <p class="muted small">A salon opening its link sees Aaina in this language, and its customers' advice is written in it. They can change it any time.</p>
        </section>

        <section class="stack">
          <h2>Waiting for approval <span class="pill">{{ pending().length }}</span></h2>
          @if (!pending().length) { <p class="muted">No new requests.</p> }
          @for (r of pending(); track r.id) {
            <article class="card req">
              <div class="req-main">
                <strong>{{ r.business }}</strong>
                <span class="muted small">{{ r.owner }} · {{ r.email }}{{ r.phone ? ' · ' + r.phone : '' }}{{ r.city ? ' · ' + r.city : '' }}</span>
              </div>
              <label class="field uname"><span class="label small">Username</span>
                <input class="input" [(ngModel)]="usernames[r.id]" [name]="'u' + r.id" [placeholder]="suggest(r)" autocapitalize="off" /></label>
              <div class="row">
                <button type="button" class="btn btn-primary btn-sm" (click)="approve(r)" [disabled]="busy()">Approve</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="reject(r)" [disabled]="busy()">Reject</button>
              </div>
            </article>
          }
        </section>

        <section class="stack">
          <h2>Give access directly</h2>
          <form class="card grid grid-2 direct" (ngSubmit)="issueDirect()">
            <label class="field"><span class="label">Salon name</span><input class="input" name="db" [(ngModel)]="direct.business" /></label>
            <label class="field"><span class="label">Owner name</span><input class="input" name="do" [(ngModel)]="direct.owner" /></label>
            <label class="field"><span class="label">Email <span class="muted small">(optional)</span></span><input class="input" name="de" [(ngModel)]="direct.email" /></label>
            <label class="field"><span class="label">Username <span class="muted small">(optional)</span></span><input class="input" name="du" [(ngModel)]="direct.username" autocapitalize="off" /></label>
            <button type="submit" class="btn btn-primary" [disabled]="busy() || direct.business.trim().length < 2 || !direct.owner.trim()">Issue tenant key</button>
          </form>
        </section>

        <section class="stack">
          <h2>Salons with access <span class="pill">{{ approved().length }}</span></h2>
          @for (r of approved(); track r.id) {
            <article class="card req">
              <div class="req-main"><strong>{{ r.business }}</strong><span class="muted small">{{ r.username }} · <span class="mono">{{ r.tenant_key }}</span></span></div>
              <div class="row">
                <button type="button" class="btn btn-ghost btn-sm" (click)="copy(link(r))">Copy link</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="copy(message(r))">Copy message</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="reject(r)">Turn off</button>
              </div>
            </article>
          }
        </section>
        @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
      }
    </main>
  `,
  styles: [`
    .lt { font-size: clamp(1.6rem, 5vw, 2.2rem); margin: 0; }
    .narrowcard { max-width: 420px; }
    .err { color: var(--danger); font-weight: 600; }
    .mono { font-family: ui-monospace, Menlo, monospace; word-break: break-all; }
    .issued { border-color: var(--brand); }
    .kv { display: grid; gap: 0.5rem; margin: 0; } .kv div { display: grid; grid-template-columns: 110px 1fr; gap: 0.75rem; } .kv dt { color: var(--ink-3); font-weight: 600; } .kv dd { margin: 0; font-weight: 700; }
    .req { display: grid; grid-template-columns: 1fr 200px auto; gap: 0.9rem; align-items: center; }
    .req-main { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
    .uname { margin: 0; }
    @media (max-width: 720px) { .req { grid-template-columns: 1fr; } }
    .direct { align-items: end; }
    .between { justify-content: space-between; align-items: center; } .h2 { margin: 0; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.6rem; }
    .tiles div { background: var(--surface-2, #f6f4f1); border-radius: 12px; padding: 0.7rem; color: var(--ink-3); font-size: 0.85rem; }
    .tiles b { display: block; font-size: 1.4rem; color: var(--ink); }
    .bad, .tiles .bad b { color: var(--danger); }
    .tbl { width: 100%; border-collapse: collapse; font-size: 0.85rem; } .tbl th, .tbl td { text-align: left; padding: 0.35rem 0.3rem; border-bottom: 1px solid var(--line, #e7e2dc); }
  `],
})
export class AdminPage {
  private http = inject(HttpClient);
  readonly i18n = inject(I18n);
  linkLang = 'en';
  adminKey = read();
  unlocked = signal(false);
  rows = signal<Reg[]>([]);
  ops = signal<Ops | null>(null);
  busy = signal(false);
  error = signal<string | null>(null);
  issued = signal<(Reg & { tenant_key: string }) | null>(null);
  copied = signal(false);
  usernames: Record<string, string> = {};
  direct = { business: '', owner: '', email: '', username: '' };
  pending = computed(() => this.rows().filter(r => r.status === 'pending'));
  approved = computed(() => this.rows().filter(r => r.status === 'approved'));

  constructor() { if (this.adminKey) this.unlock(); }

  private headers() { return new HttpHeaders({ 'x-admin-key': this.adminKey.trim() }); }

  async unlock() {
    this.error.set(null);
    try {
      this.rows.set(await firstValueFrom(this.http.get<Reg[]>(`${API_BASE}/api/admin/registrations`, { headers: this.headers() })));
      this.unlocked.set(true);
      this.loadOps();
      try { sessionStorage.setItem(KEY, this.adminKey.trim()); } catch { /* private mode */ }
    } catch (e) {
      this.unlocked.set(false);
      this.error.set(e instanceof HttpErrorResponse && e.status === 401 ? 'That admin key is not right.' : 'Could not reach Aaina. It may be waking up — try again.');
    }
  }

  suggest(r: Reg) { return (r.email.split('@')[0] || r.owner).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20); }

  async loadOps() {
    try { this.ops.set(await firstValueFrom(this.http.get<Ops>(`${API_BASE}/api/admin/ops`, { headers: this.headers() }))); }
    catch { /* optional panel; approvals still work */ }
  }
  pct(x: number) { return `${Math.round(x * 1000) / 10}%`; }
  modelRuns(a: Ops['agents'][number]) { return Object.entries(a.sources).filter(([k]) => !['offline', 'offline-fallback', 'image', 'none'].includes(k)).reduce((n, [, v]) => n + v, 0); }
  salonsToday(o: Ops) { return Object.entries(o.salons_today); }
  uptime(s: number) { return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${Math.round(s / 3600)} h`; }

  async approve(r: Reg) { await this.act(`/api/admin/registrations/${r.id}/approve`, { username: (this.usernames[r.id] || '').trim() }); }
  async reject(r: Reg) { await this.act(`/api/admin/registrations/${r.id}/reject`, {}, false); }
  async issueDirect() {
    await this.act('/api/admin/issue', { business: this.direct.business.trim(), owner: this.direct.owner.trim(), email: this.direct.email.trim(), username: this.direct.username.trim() });
    this.direct = { business: '', owner: '', email: '', username: '' };
  }

  private async act(path: string, body: object, showIssued = true) {
    this.busy.set(true); this.error.set(null);
    try {
      const res = await firstValueFrom(this.http.post<any>(`${API_BASE}${path}`, body, { headers: this.headers() }));
      if (showIssued && res.tenant_key) { this.issued.set(res); this.copied.set(false); }
      await this.unlock();
    } catch (e) {
      const d = e instanceof HttpErrorResponse ? e.error?.detail : null;
      this.error.set(typeof d === 'string' ? d : 'That did not work. Please try again.');
    } finally { this.busy.set(false); }
  }

  /** One-click sign-in: the key sits after #, so it is never sent to a server. */
  link(k: { tenant_key: string | null; username: string | null }) {
    return `${location.origin}/login#k=${encodeURIComponent(k.tenant_key || '')}&u=${encodeURIComponent(k.username || '')}&l=${this.linkLang}`;
  }
  message(k: { owner: string; business: string; tenant_key: string | null; username: string | null }) {
    return `Hi ${k.owner}, your salon ${k.business} is ready on Aaina.\n\nOne-click sign-in: ${this.link(k)}\n\nOr sign in at ${location.origin}/login with\nTenant key: ${k.tenant_key}\nUsername: ${k.username}`;
  }
  mailto(k: Reg) { return `mailto:${k.email}?subject=${encodeURIComponent('Your Aaina access')}&body=${encodeURIComponent(this.message(k))}`; }
  async copy(text: string) { try { await navigator.clipboard.writeText(text); this.copied.set(true); } catch { /* clipboard blocked */ } }
}

function read(): string { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } }
