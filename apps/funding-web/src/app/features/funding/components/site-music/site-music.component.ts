import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input
} from '@angular/core';

import { SiteMusicService } from '../../services/site-music.service.js';

@Component({
  selector: 'openg7-site-music',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.inline]': 'inline()' },
  template: `
    <button
      *ngIf="music.isAvailable()"
      type="button"
      class="site-music-toggle"
      [class.playing]="music.isPlaying()"
      [attr.aria-label]="music.musicLabel()"
      [attr.aria-pressed]="music.isPlaying()"
      [attr.title]="music.musicLabel()"
      (click)="music.toggleMusic()"
    >
      <span aria-hidden="true">{{ music.isPlaying() ? '♪' : '♬' }}</span>
    </button>
  `,
  styleUrl: './site-music.component.css'
})
export class SiteMusicComponent implements OnInit {
  readonly inline = input(false);
  readonly music = inject(SiteMusicService);

  ngOnInit(): void {
    this.music.initialize();
  }
}
