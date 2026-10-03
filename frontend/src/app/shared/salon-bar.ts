import { Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'salon-bar',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <div class="wrap">
        <a class="brand" [routerLink]="['/t', slug()]">
          <span class="brand-mark" aria-hidden="true">a</span>
          <span>{{ name() || 'Aaina' }}</span>
        </a>
        <nav class="nav" aria-label="Salon">
          <a [routerLink]="['/t', slug(), 'consult']" routerLinkActive="active">New</a>
          <a [routerLink]="['/t', slug(), 'clients']" routerLinkActive="active">Clients</a>
          <a [routerLink]="['/t', slug(), 'agenda']" routerLinkActive="active">Due</a>
        </nav>
      </div>
    </header>
  `,
})
export class SalonBar {
  slug = input.required<string>();
  name = input<string | null | undefined>();
}
