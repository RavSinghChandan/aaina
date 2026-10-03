import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'top-bar',
  imports: [RouterLink],
  template: `
    <header class="topbar">
      <div class="wrap">
        <a class="brand" routerLink="/" aria-label="Aaina home"><span class="brand-mark" aria-hidden="true">a</span><span>Aaina</span></a>
        @if (action(); as a) { <a class="btn btn-ghost btn-sm" [routerLink]="a.link">{{ a.label }}</a> }
      </div>
    </header>
  `,
})
export class TopBar {
  action = input<{ label: string; link: string } | null>(null);
}
