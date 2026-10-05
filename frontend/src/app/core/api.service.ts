import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE, SPACE } from './config';
import { Consultation, Meta } from './models';
import { Auth } from './auth';

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private auth = inject(Auth);
  private url = (p: string) => `${API_BASE}/api${p}`;
  private metaCache?: Promise<Meta>;

  meta(): Promise<Meta> { return (this.metaCache ??= firstValueFrom(this.http.get<Meta>(this.url('/meta')))); }
  /** The signed-in salon's tenant (a shared results link carries its own). */
  tenant(override?: string | null) { return override || this.auth.session()?.tenant || SPACE; }

  startConsultation(body: any) {
    return this.signedOut401(firstValueFrom(this.http.post<{ id: string; status: string }>(this.url(`/t/${this.tenant()}/consultations`), body, { headers: this.auth.headers() })));
  }
  consultation(id: string, tenant?: string | null) {
    return firstValueFrom(this.http.get<Consultation>(this.url(`/t/${this.tenant(tenant)}/consultations/${id}`), { headers: this.auth.headers() }));
  }
  choose(id: string, styleId: string, tenant?: string | null) {
    return this.signedOut401(firstValueFrom(this.http.post<Consultation>(this.url(`/t/${this.tenant(tenant)}/consultations/${id}/choose`), { style_id: styleId }, { headers: this.auth.headers() })));
  }

  /** An expired or missing sign-in clears the stored session so the app can ask again. */
  private async signedOut401<T>(p: Promise<T>): Promise<T> {
    try { return await p; } catch (e) { if (e instanceof HttpErrorResponse && e.status === 401) this.auth.logout(); throw e; }
  }
}
