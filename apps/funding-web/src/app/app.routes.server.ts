import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: '',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'fonds-des-batisseurs',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'ecosystem',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'support',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'music',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'boutique',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'batisseurs',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'commanditaires',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'fonds-des-batisseurs/a-propos',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'fonds-des-batisseurs/transparence',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'en',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'en/fonds-des-batisseurs',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'en/ecosystem',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'en/support',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'en/music',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'en/boutique',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'en/batisseurs',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'en/commanditaires',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'en/fonds-des-batisseurs/a-propos',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'en/fonds-des-batisseurs/transparence',
    renderMode: RenderMode.Prerender
  },
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];
