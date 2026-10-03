import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE, SPACE } from './config';
import { Consultation, Meta } from './models';

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private url = (p: string) => `${API_BASE}/api${p}`;
  private metaCache?: Promise<Meta>;

  meta(): Promise<Meta> { return (this.metaCache ??= firstValueFrom(this.http.get<Meta>(this.url('/meta')))); }
  startConsultation(body: any) {
    return firstValueFrom(this.http.post<{ id: string; status: string }>(this.url(`/t/${SPACE}/consultations`), body));
  }
  consultation(id: string) { return firstValueFrom(this.http.get<Consultation>(this.url(`/t/${SPACE}/consultations/${id}`))); }
  choose(id: string, styleId: string) {
    return firstValueFrom(this.http.post<Consultation>(this.url(`/t/${SPACE}/consultations/${id}/choose`), { style_id: styleId }));
  }
}
