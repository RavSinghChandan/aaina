import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './config';
import { AgendaItem, Consultation, CustomerRow, Meta, TenantPublic } from './models';

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private url = (p: string) => `${API_BASE}/api${p}`;
  private metaCache?: Promise<Meta>;

  meta(): Promise<Meta> { return (this.metaCache ??= firstValueFrom(this.http.get<Meta>(this.url('/meta')))); }
  health() { return firstValueFrom(this.http.get<{ status: string; ai: boolean }>(this.url('/health'))); }
  tenant(slug: string) { return firstValueFrom(this.http.get<TenantPublic>(this.url(`/t/${slug}`))); }
  createTenant(body: any, adminKey?: string) {
    const headers = adminKey ? new HttpHeaders({ 'x-admin-key': adminKey }) : undefined;
    return firstValueFrom(this.http.post<{ slug: string; name: string; url: string }>(this.url('/tenants'), body, { headers }));
  }
  startConsultation(slug: string, body: any) {
    return firstValueFrom(this.http.post<{ id: string; status: string }>(this.url(`/t/${slug}/consultations`), body));
  }
  consultation(slug: string, id: string) { return firstValueFrom(this.http.get<Consultation>(this.url(`/t/${slug}/consultations/${id}`))); }
  choose(slug: string, id: string, styleId: string) {
    return firstValueFrom(this.http.post<Consultation>(this.url(`/t/${slug}/consultations/${id}/choose`), { style_id: styleId }));
  }
  customers(slug: string, q = '') { return firstValueFrom(this.http.get<CustomerRow[]>(this.url(`/t/${slug}/customers`), { params: q ? { q } : {} })); }
  customer(slug: string, id: string) { return firstValueFrom(this.http.get<any>(this.url(`/t/${slug}/customers/${id}`))); }
  eraseCustomer(slug: string, id: string) { return firstValueFrom(this.http.delete<void>(this.url(`/t/${slug}/customers/${id}`))); }
  agenda(slug: string, days = 14) { return firstValueFrom(this.http.get<AgendaItem[]>(this.url(`/t/${slug}/agenda`), { params: { days } })); }
}
