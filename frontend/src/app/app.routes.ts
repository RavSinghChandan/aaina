import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { signedIn } from './core/auth';
import { I18n } from './core/i18n';

/** First visit: pick a language before anything else, then come back. */
const languageChosen: CanActivateFn = (_r, state) =>
  inject(I18n).chosen() || inject(Router).createUrlTree(['/language'], { queryParams: { next: state.url } });

export const routes: Routes = [
  { path: '', canActivate: [languageChosen], loadComponent: () => import('./pages/home.page').then(m => m.HomePage), title: 'Aaina' },
  { path: 'language', loadComponent: () => import('./pages/language.page').then(m => m.LanguagePage), title: 'Language · Aaina' },
  { path: 'register', canActivate: [languageChosen], loadComponent: () => import('./pages/register.page').then(m => m.RegisterPage), title: 'Register your salon · Aaina' },
  { path: 'admin', loadComponent: () => import('./pages/admin.page').then(m => m.AdminPage), title: 'Salon access · Aaina' },
  { path: 'login', loadComponent: () => import('./pages/login.page').then(m => m.LoginPage), title: 'Sign in · Aaina' },
  { path: 'start', canActivate: [languageChosen, signedIn], loadComponent: () => import('./pages/journey.page').then(m => m.JourneyPage), title: 'New customer · Aaina' },
  { path: 'customers', canActivate: [languageChosen, signedIn], loadComponent: () => import('./pages/customers.page').then(m => m.CustomersPage), title: 'Customers · Aaina' },
  { path: 'follow-ups', canActivate: [languageChosen, signedIn], loadComponent: () => import('./pages/followups.page').then(m => m.FollowUpsPage), title: 'Follow-ups · Aaina' },
  { path: 'looks/:id', loadComponent: () => import('./pages/results.page').then(m => m.ResultsPage), title: 'Looks · Aaina' },
  { path: 'looks/:id/screen', loadComponent: () => import('./pages/present.page').then(m => m.PresentPage), title: 'Big screen · Aaina' },
  { path: '**', redirectTo: '' },
];
