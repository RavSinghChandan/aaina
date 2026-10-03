import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/landing.page').then(m => m.LandingPage), title: 'Aaina — the AI mirror for salons' },
  { path: 'start', loadComponent: () => import('./pages/onboard.page').then(m => m.OnboardPage), title: 'Set up your salon · Aaina' },
  { path: 't/:slug', loadComponent: () => import('./pages/salon-home.page').then(m => m.SalonHomePage), title: 'Aaina' },
  { path: 't/:slug/consult', loadComponent: () => import('./pages/consult.page').then(m => m.ConsultPage), title: 'New consultation · Aaina' },
  { path: 't/:slug/c/:id', loadComponent: () => import('./pages/results.page').then(m => m.ResultsPage), title: 'Your looks · Aaina' },
  { path: 't/:slug/c/:id/present', loadComponent: () => import('./pages/present.page').then(m => m.PresentPage), title: 'Big screen · Aaina' },
  { path: 't/:slug/clients', loadComponent: () => import('./pages/clients.page').then(m => m.ClientsPage), title: 'Clients · Aaina' },
  { path: 't/:slug/clients/:id', loadComponent: () => import('./pages/client.page').then(m => m.ClientPage), title: 'Client · Aaina' },
  { path: 't/:slug/agenda', loadComponent: () => import('./pages/agenda.page').then(m => m.AgendaPage), title: 'Who is due · Aaina' },
  { path: '**', redirectTo: '' },
];
