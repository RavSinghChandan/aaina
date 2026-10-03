import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home.page').then(m => m.HomePage), title: 'Aaina · find the haircut that suits you' },
  { path: 'start', loadComponent: () => import('./pages/journey.page').then(m => m.JourneyPage), title: 'Your consultation · Aaina' },
  { path: 'looks/:id', loadComponent: () => import('./pages/results.page').then(m => m.ResultsPage), title: 'Your looks · Aaina' },
  { path: 'looks/:id/screen', loadComponent: () => import('./pages/present.page').then(m => m.PresentPage), title: 'Big screen · Aaina' },
  { path: '**', redirectTo: '' },
];
