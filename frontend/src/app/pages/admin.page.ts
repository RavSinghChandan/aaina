import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from '../core/config';
import { TopBar } from '../shared/top-bar';

interface Reg {
  id: string; business: string; owner: string; email: string; phone: string; city: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked'; tenant: string | null; username: string | null; tenant_key: string | null; created_at: string;
}
const KEY = 'aaina.admin';

/** The owner's page: approve salons and send them their tenant key + username. */
@Component({
  selector: 'admin-page',
  imports: [FormsModule, TopBar],
  template: `
    <top-bar />
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
            </dl>
            <div class="row">
              <button type="button" class="btn btn-primary btn-sm" (click)="copy(message(k))">{{ copied() ? 'Copied ✓' : 'Copy message to send' }}</button>
              @if (k.email) { <a class="btn btn-ghost btn-sm" [href]="mailto(k)">Email it</a> }
              <button type="button" class="btn btn-ghost btn-sm" (click)="issued.set(null)">Done</button>
            </div>
          </section>
        }

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
                <button type="button" class="btn btn-ghost btn-sm" (click)="copy(message(r))">Copy</button>
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
  `],
})
export class AdminPage {
  private http = inject(HttpClient);
  adminKey = read();
  unlocked = signal(false);
  rows = signal<Reg[]>([]);
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
      try { sessionStorage.setItem(KEY, this.adminKey.trim()); } catch { /* private mode */ }
    } catch (e) {
      this.unlocked.set(false);
      this.error.set(e instanceof HttpErrorResponse && e.status === 401 ? 'That admin key is not right.' : 'Could not reach Aaina. It may be waking up — try again.');
    }
  }

  suggest(r: Reg) { return (r.email.split('@')[0] || r.owner).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20); }

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

  message(k: { owner: string; business: string; tenant_key: string | null; username: string | null }) {
    return `Hi ${k.owner}, your salon ${k.business} is ready on Aaina.\n\nSign in at https://aaina-ai.vercel.app/login\nTenant key: ${k.tenant_key}\nUsername: ${k.username}`;
  }
  mailto(k: Reg) { return `mailto:${k.email}?subject=${encodeURIComponent('Your Aaina access')}&body=${encodeURIComponent(this.message(k))}`; }
  async copy(text: string) { try { await navigator.clipboard.writeText(text); this.copied.set(true); } catch { /* clipboard blocked */ } }
}

function read(): string { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } }
