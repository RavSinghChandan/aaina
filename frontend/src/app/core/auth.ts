import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './config';

const KEY = 'aaina.session';
interface Session { token: string; name: string; }

/** Free sign-in with a shared access code; the token is signed by the server and kept on this device. */
@Injectable({ providedIn: 'root' })
export class Auth {
  private http = inject(HttpClient);
  readonly session = signal<Session | null>(read());
  readonly name = computed(() => this.session()?.name ?? null);
  private required?: Promise<boolean>;

  isRequired(): Promise<boolean> {
    return (this.required ??= firstValueFrom(this.http.get<{ required: boolean }>(`${API_BASE}/api/auth/status`))
      .then(r => r.required).catch(() => true));               // if unsure, ask people to sign in
  }

  async login(name: string, code: string): Promise<void> {
    const r = await firstValueFrom(this.http.post<{ token: string; name: string }>(`${API_BASE}/api/auth/login`, { name, code }));
    this.set({ token: r.token, name: r.name });
  }

  logout() { this.set(null); }

  headers(): Record<string, string> {
    const t = this.session()?.token;
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  private set(s: Session | null) {
    this.session.set(s);
    try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
  }
}

function read(): Session | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

/** Consultations spend AI credit, so they need a signed-in visitor (when the server asks for it). */
export const signedIn: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth), router = inject(Router);
  if (auth.session() || !(await auth.isRequired())) return true;
  return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};
