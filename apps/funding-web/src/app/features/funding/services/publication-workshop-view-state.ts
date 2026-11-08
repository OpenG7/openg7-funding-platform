import { Injectable, signal } from '@angular/core';

export type PublicationWorkshopSection =
  'navigation' | 'controls' | 'offer' | 'obligations' | 'contract';

/** Transient disclosure state survives refreshes; it stores no draft or private content. */
@Injectable({ providedIn: 'root' })
export class PublicationWorkshopViewState {
  private context = '';
  private readonly sections = signal<readonly PublicationWorkshopSection[]>([]);

  select(context: string): void {
    if (context === this.context) return;
    this.context = context;
    this.sections.set([]);
  }

  isOpen(section: PublicationWorkshopSection): boolean {
    return this.sections().includes(section);
  }

  toggle(section: PublicationWorkshopSection, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    if (open === this.isOpen(section)) return;
    this.sections.update((sections) =>
      open
        ? [...sections, section]
        : sections.filter((current) => current !== section)
    );
  }
}
