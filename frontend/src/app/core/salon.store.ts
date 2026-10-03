import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api.service';
import { TenantPublic } from './models';

/** The current salon, and its branding applied as CSS variables. */
@Injectable({ providedIn: 'root' })
export class SalonStore {
  private api = inject(Api);
  readonly salon = signal<TenantPublic | null>(null);
  readonly error = signal<string | null>(null);

  async load(slug: string): Promise<TenantPublic | null> {
    if (this.salon()?.slug === slug) return this.salon();
    this.error.set(null);
    try {
      const t = await this.api.tenant(slug);
      this.salon.set(t);
      const root = document.documentElement.style;
      root.setProperty('--brand', t.branding.primary || '#0F766E');
      root.setProperty('--brand-2', t.branding.accent || '#14B8A6');
      return t;
    } catch (e: any) {
      this.salon.set(null);
      this.error.set(e?.status === 404 ? 'We could not find this salon.' : 'The salon is not reachable right now. Please try again.');
      return null;
    }
  }
}
