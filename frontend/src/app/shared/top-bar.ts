import { Component, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Auth } from '../core/auth';

@Component({
  selector: 'top-bar',
  imports: [RouterLink],
  template: `
    <header class="topbar">
      <div class="wrap">
        <a class="brand" routerLink="/" aria-label="Aaina home"><span class="brand-mark" aria-hidden="true">a</span><span>Aaina</span></a>
        <div class="tb-right">
          @if (auth.name(); as n) {
            <span class="tb-user">Hi, {{ n }}</span>
            <button type="button" class="btn btn-ghost btn-sm" (click)="signOut()">Sign out</button>
          }
          @if (action(); as a) { <a class="btn btn-ghost btn-sm" [routerLink]="a.link">{{ a.label }}</a> }
        </div>
      </div>
    </header>
  `,
  styles: [`.tb-right { display: flex; align-items: center; gap: 0.5rem; } .tb-user { font-size: 0.85rem; color: var(--ink-3); font-weight: 600; } @media (max-width: 420px) { .tb-user { display: none; } }`],
})
export class TopBar {
  action = input<{ label: string; link: string } | null>(null);
  readonly auth = inject(Auth);
  private router = inject(Router);
  signOut() { this.auth.logout(); this.router.navigate(['/']); }
}
