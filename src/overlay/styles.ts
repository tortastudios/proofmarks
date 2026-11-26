import { css } from './css';

export const proofmarksStyles = css`
  .badge {
    position: relative;
    display: flex;
    gap: 4px;
    align-items: center;
    font-variant-numeric: tabular-nums;
  }
  .count,
  .outgoing {
    display: inline-block;
    width: var(--count-width, 2ch);
    text-align: right;
  }
  .outgoing {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
  }
  .pill-clip {
    position: absolute;
    inset: 0;
    border-radius: 22px;
    overflow: hidden;
  }
  .pill-surface {
    position: absolute;
    inset: 4px;
    border-radius: 18px;
    background: #24201c;
    pointer-events: none;
  }
  .pill-content {
    position: relative;
    display: flex;
    align-items: center;
    width: max-content;
    height: 44px;
    white-space: nowrap;
  }
  .header .pill button {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    min-width: 44px;
    height: 44px;
    border: 0;
    background: transparent;
    color: #f7f3eb;
    padding: 0;
    font-size: 12px;
    touch-action: none;
  }
  .header .pill-mark {
    width: 44px;
    border-radius: 22px;
  }
  .pill-mark::before {
    content: '';
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    background: #24201c;
  }
  .pill-mark svg {
    position: relative;
    width: 22px;
    height: 22px;
    pointer-events: none;
  }
  .pill[data-circle='true'] .pill-mark::before {
    background: #24201c;
  }
  .header .pill-count {
    padding: 0 6px;
    min-width: 58px;
  }
  .header .pill .pill-close {
    width: 44px;
    font-size: 22px;
  }
  .pill[data-circle='true'] .pill-count,
  .pill[data-circle='true'] .pill-close {
    opacity: 0;
    pointer-events: none;
  }
  .pill[data-panel='true'] .pill-close {
    visibility: hidden;
  }
  .pill button:focus-visible {
    outline: 2px solid #f7f3eb;
    outline-offset: -5px;
  }
  .notification-dot {
    position: absolute;
    top: 3.272px;
    left: 28.728px;
    width: 12px;
    height: 12px;
    border: 2px solid #24201c;
    border-radius: 50%;
    background: #ff3c02;
    pointer-events: none;
  }
  .badge {
    gap: 4px;
    line-height: 18px;
  }
  .count,
  .outgoing {
    width: 2ch;
    text-align: right;
  }
  .pill[data-circle='false'] .notification-dot {
    display: none;
  }
  .marks {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 0;
    z-index: 20;
    pointer-events: none;
  }
  .arrow {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }
  .passage {
    position: absolute;
    pointer-events: none;
    background: transparent;
  }
  .rect {
    position: absolute;
    pointer-events: none;
    background: transparent;
  }
  .label {
    position: absolute;
    pointer-events: auto;
    border: 0;
    background: #f7f3ebed;
    font:
      500 25px/1.05 ProofmarksHand,
      cursive;
    color: var(--mark);
    text-align: left;
    padding: 4px 7px;
    width: 148px;
  }
  .rough-annotation {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
    pointer-events: none;
  }
  .rough-annotation path {
    animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1) !important;
  }
  .pill-close svg {
    position: absolute;
    width: 20px;
    height: 20px;
    pointer-events: none;
  }
  .shortcuts-help {
    position: fixed;
    z-index: 2147482003;
    width: 280px;
    max-width: calc(var(--layout-width) - 24px);
    padding: 16px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid #ffffff20;
    border-radius: var(--surface-radius);
    box-shadow: 0 12px 36px #0003;
    pointer-events: auto;
  }
  .shortcuts-help h2 {
    font-size: 14px;
    margin: 0 28px 14px 0;
  }
  .shortcuts-help > button {
    position: absolute;
    right: 6px;
    top: 5px;
    font-size: 20px;
  }
  .shortcuts-help p {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    font-size: 11px;
    margin: 10px 0;
  }
  .shortcuts-help kbd {
    font:
      11px ui-monospace,
      monospace;
    color: var(--muted);
    white-space: nowrap;
  }
  .label[data-offscreen='true'],
  .arrow[data-offscreen='true'] {
    visibility: hidden;
    pointer-events: none;
  }
  @keyframes rough-notation-dash {
    to {
      stroke-dashoffset: 0;
    }
  }
  :host {
    --surface-radius: 14px;
    --surface-shadow: 0 1px 3px #0002, 0 8px 20px -6px #0004, 0 24px 48px -18px #0005;
    --ink: #24201c;
    --paper: #f7f3eb;
    --muted: oklch(0.76 0.015 70);
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 0;
    pointer-events: none;
    color: var(--paper);
    font:
      14px/1.45 system-ui,
      sans-serif;
    color-scheme: dark;
  }
  * {
    box-sizing: border-box;
  }
  [hidden] {
    display: none !important;
  }
  button {
    touch-action: manipulation;
    cursor: pointer;
    min-height: 32px;
    min-width: 32px;
    font: inherit;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 6px;
    padding: 6px 10px;
  }
  button:disabled {
    cursor: default;
    color: var(--muted);
    opacity: 0.65;
  }
  button:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: -3px;
  }
  button:active {
    transform: translateY(1px);
  }
  .panel {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 2147482000;
    width: 330px;
    max-width: calc(var(--layout-width) - 20px);
    min-height: 46px;
    max-height: calc(100dvh - 100px);
    overflow: hidden;
    pointer-events: auto;
    background: var(--ink);
    border-radius: var(--surface-radius);
    box-shadow: var(--surface-shadow);
    will-change: transform;
  }
  .panel[data-expanded='false']:not([data-animating]) {
    background: transparent;
    box-shadow: none;
  }
  .header {
    height: 46px;
    position: absolute;
    inset: 0;
    z-index: 2;
  }
  .header {
    pointer-events: none;
  }
  .header .pill {
    pointer-events: auto;
  }
  .header .pill {
    position: relative;
    display: block;
    height: 44px;
    min-height: 44px;
    padding: 0;
    border: 0;
    border-radius: 22px;
    overflow: visible;
    color: var(--paper);
    background: transparent;
    touch-action: none;
    user-select: none;
    position: absolute;
    left: 0;
    top: var(--badge-y, 0px);
    transform: none;
    cursor: grab;
  }
  .panel[data-slot$='right'] .pill {
    left: auto;
    right: 2px;
  }
  .panel[data-slot$='center'] .pill {
    left: calc(50% - 1px);
    transform: translateX(-50%);
  }
  .panel[data-dragging='true'] .pill {
    cursor: grabbing;
  }
  .marks [data-status^='accepted'] .rect,
  .marks [data-status^='accepted'] .arrow path {
    opacity: 0.45;
  }
  .marks [data-active='true'] .label {
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .label:focus-visible {
    outline-color: var(--mark);
  }
  .card {
    position: absolute;
    z-index: 2147482000;
    right: 16px;
    top: 155px;
    width: 330px;
    max-width: calc(var(--layout-width) - 20px);
    max-height: calc(100dvh - 100px);
    overflow: auto;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid oklch(0.3 0.01 70);
    border-radius: var(--surface-radius);
    padding: 14px;
    pointer-events: auto;
    box-shadow: var(--surface-shadow);
  }
  .card.dock-card {
    z-index: 1;
    background: transparent;
    position: relative !important;
    inset: auto !important;
    transform: none !important;
    width: 330px;
    max-width: 100%;
    border: 0;
    box-shadow: none;
  }
  .card header {
    display: flex;
    align-items: center;
    gap: 2px;
    position: relative;
    margin: 8px 0;
    min-height: 44px;
    flex-wrap: nowrap;
  }
  .card h2 {
    flex: 1;
    min-width: 0;
    font:
      500 20px/1.2 ProofmarksHand,
      cursive;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0;
    color: var(--mark);
  }
  .card header button {
    font-size: 22px;
    padding: 0;
    width: 28px;
    min-width: 28px;
    height: 44px;
    min-height: 44px;
    flex: none;
  }
  .card header button:last-child {
    font-size: 18px;
  }
  .proof-position {
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    height: 44px;
    min-width: 42px;
    flex: none;
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    margin: 0 5px;
  }
  .panel[data-slot^='bottom'] .card.dock-card {
    padding-bottom: 52px;
  }
  .meta-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted);
  }
  .meta-info strong {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    color: var(--paper);
  }
  .meta-info svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .proof-content {
    position: relative;
  }
  .card[data-fixed='true'],
  .card[data-following='true'] {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .card[data-fixed='true'] .proof-content,
  .card[data-following='true'] .proof-content {
    min-height: 0;
    overflow: auto;
  }
  .card[data-fixed='true'] header,
  .card[data-fixed='true'] .actions-shell,
  .card[data-following='true'] header,
  .card[data-following='true'] .actions-shell {
    flex-shrink: 0;
  }
  .card h3 {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 14px 0 5px;
    color: var(--muted);
    font-weight: 500;
  }
  .card p {
    font-size: 13px;
    line-height: 1.5;
    margin: 4px 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .card .original {
    color: var(--muted);
  }
  .card .note {
    font-size: 12px;
    color: var(--muted);
    white-space: normal;
    margin-top: 12px;
  }
  .card .proof-empty {
    padding: 24px 0;
    font-size: 18px;
  }
  .proof-outgoing {
    position: absolute;
    top: 94px;
    left: 14px;
    right: 14px;
    pointer-events: none;
  }
  .proof-status {
    color: var(--muted);
    font-size: 12px;
    margin-right: auto;
  }
  .proof-status[data-status^='accepted'] {
    color: oklch(0.8 0.06 177);
  }
  .card[data-following='true'] {
    position: fixed;
    left: 0;
    top: 0;
    right: auto;
    max-height: calc(100dvh - 24px);
    pointer-events: none;
    will-change: transform;
  }
  .card[data-following='true'] header button,
  .card[data-following='true'] .proof-position {
    visibility: hidden;
  }
  .card[data-fixed='true'] {
    position: fixed;
    left: 0;
    top: 0;
    right: auto;
    max-height: calc(100dvh - 24px);
    will-change: transform;
  }
  .actions-shell {
    height: 0;
    visibility: hidden;
    overflow: hidden;
  }
  .action-content {
    padding-top: 14px;
  }
  .actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .actions button {
    font-size: 13px;
  }
  .actions .primary {
    background: var(--paper);
    color: var(--ink);
    padding-inline: 16px;
  }
  .action-reason {
    color: var(--muted);
  }
  .toast {
    position: fixed;
    z-index: 2147482001;
    max-width: calc(var(--layout-width) - 20px);
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--ink);
    color: var(--paper);
    border-radius: 8px;
    padding: 4px 8px;
    font-size: 12px;
    pointer-events: auto;
    box-shadow: 0 6px 22px #0003;
  }
  .toast button {
    text-decoration: underline;
  }
  .mobile-sheet {
    position: fixed;
    z-index: 2147482002;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 55svh;
    max-height: 55dvh;
    overflow: auto;
    overscroll-behavior: contain;
    pointer-events: auto;
    background: var(--ink);
    color: var(--paper);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -6px 28px #0003;
    padding: 0 12px max(12px, env(safe-area-inset-bottom));
    -webkit-tap-highlight-color: transparent;
  }
  .sheet-handle {
    display: block;
    margin: auto;
    width: 80px;
    height: 44px;
    min-height: 44px;
    touch-action: none;
    padding: 0;
    color: var(--muted);
  }
  .sheet-close {
    position: absolute;
    right: 8px;
    top: 0;
    font-size: 20px;
    z-index: 2;
  }
  .mobile-sheet .sheet-card {
    position: static !important;
    transform: none !important;
    width: 100%;
    max-width: none;
    max-height: none;
    border: 0;
    box-shadow: none;
    padding: 8px 0 0;
    overflow: visible;
  }
  .sheet-card p {
    font-size: 15px;
  }
  .sheet-card h2 {
    font-size: 22px;
  }
  .sheet-card header > button:last-child {
    display: none;
  }
  .sheet-card .actions-shell {
    position: sticky;
    bottom: 0;
    background: var(--ink);
    height: auto !important;
  }
  .sheet-card .actions button {
    min-height: 48px;
    flex: 1;
    font-size: 16px;
  }
  :host([data-sheet-open]) .toast {
    display: none;
  }
  @media (hover: hover) and (pointer: fine) {
    .card button:not(.primary):hover,
    .toast button:hover {
      background: oklch(0.31 0.01 70);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .rough-annotation path {
      animation: none !important;
    }
  }
  @media (max-width: 700px), (pointer: coarse) {
    button {
      min-width: 44px;
      min-height: 44px;
    }
    .card header button {
      min-width: 44px;
    }
    .label {
      min-width: 0;
      width: 16px;
      height: 56px;
      font-size: 0;
      border-radius: 0;
      text-align: center;
      background: transparent;
      border: 0;
      padding: 0;
    }
    .label::after {
      content: '';
      position: absolute;
      right: 3px;
      top: 26px;
      width: 8px;
      height: 3px;
      background: var(--mark);
    }
    .label:focus-visible {
      outline-offset: -3px;
    }
    .card kbd {
      display: none;
    }
  }
  /* Stable shell and retained dock geometry: completion never swaps layout layers. */
  .panel,
  .panel[data-expanded='false']:not([data-animating]) {
    background: transparent;
    box-shadow: none;
  }
  .dock-surface {
    position: absolute;
    inset: 0;
    background: var(--ink);
    pointer-events: none;
    clip-path: inset(4px 4px 4px 4px round 18px);
  }
  /* Paint ink behind the button so its inset keyboard focus ring stays visible. */
  .panel .pill-mark::before,
  .panel .pill[data-circle='true'] .pill-mark::before {
    background: transparent;
  }
  .card.dock-card[hidden] {
    display: block !important;
    visibility: hidden;
    pointer-events: none;
  }
  .pill[data-muted='true'] .pill-mark {
    color: var(--muted);
  }

  .proof-tooltip {
    position: fixed;
    z-index: 2147483000;
    pointer-events: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    box-sizing: border-box;
    padding: 4px 6px;
    border: 0;
    border-radius: 6px;
    background: #0d0d0d;
    color: #fff;
    font:
      500 10px/12px Inter,
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      sans-serif;
    white-space: nowrap;
    width: max-content;
    max-width: calc(var(--layout-width) - 16px);
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow:
      0 2px 2px -1px rgba(0, 0, 0, 0.12),
      0 4px 4px -2px rgba(0, 0, 0, 0.12),
      0 8px 8px -4px rgba(0, 0, 0, 0.12),
      0 16px 16px -8px rgba(0, 0, 0, 0.12),
      0 24px 24px -12px rgba(0, 0, 0, 0.12);
  }
  .proof-tooltip-key {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    color: rgb(255 255 255 / 0.64);
    font: inherit;
  }

  .card .proof-empty {
    padding: 12px 0 0;
  }
  .completion {
    height: 232px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
  }
  .completion-art {
    height: 160px;
    width: 100%;
    display: grid;
    place-items: center;
    flex: none;
  }
  .completion-sign {
    position: relative;
    width: 210px;
    height: 158px;
  }
  .completion-pilcrow {
    position: absolute;
    width: 102px;
    height: 102px;
    left: 28px;
    top: 0;
    color: var(--paper);
    overflow: visible;
  }
  .completion-sign-check {
    position: absolute;
    width: 66px;
    height: 64px;
    left: 122px;
    top: 36px;
    color: #a7c9b9;
    overflow: visible;
  }
  .completion-caption {
    position: absolute;
    bottom: 0;
    width: 100%;
    font:
      30px/1.2 ProofmarksHand,
      cursive;
  }
  .completion-equivalent {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .completion-undo {
    min-height: 40px !important;
    font-size: 12px;
    min-height: 36px;
  }
  .completion-badge-check {
    position: absolute;
    top: 3px;
    left: 27px;
    width: 16px;
    height: 16px;
    color: #b7d2c5;
    background: var(--ink);
    border-radius: 50%;
    pointer-events: none;
  }
  .completion-badge-check svg {
    display: block;
    width: 16px;
    height: 16px;
  }
  .sheet-card .completion {
    height: 248px;
  }

  [data-severity='warning'] .rect,
  [data-severity='warning'] .passage,
  [data-severity='warning'] .arrow {
    opacity: 0.55;
  }
  .record-scores {
    margin-top: 20px;
    border-top: 1px solid #ffffff18;
  }

  .signal-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 10px;
    margin-top: 12px;
    font-size: 11px;
    color: var(--muted);
  }
  .signal-value {
    font-variant-numeric: tabular-nums;
  }
  .signal-track {
    position: relative;
    grid-column: 1/-1;
    height: 5px;
    background: #ffffff18;
    border-radius: 1px;
  }
  .signal-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: #f7f3eb8c;
  }
  .signal-tick {
    position: absolute;
    top: -3px;
    width: 1px;
    height: 11px;
    background: var(--paper);
  }

  .card .proof-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 4px 0 8px;
  }
  .card .proof-content p {
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .card .proof-content .rule-check {
    font-size: 12px;
    color: var(--muted);
    white-space: normal;
    text-wrap: pretty;
  }
  .proof-pair {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .proof-version {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .card .proof-pair h3 {
    font-size: 12px;
    line-height: 1.5;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--muted);
    margin: 0;
  }
  .card .proof-pair .original {
    color: var(--muted);
  }
  .card .proof-content .note {
    font-size: 12px;
    line-height: 1.5;
    white-space: normal;
    color: var(--paper);
    text-wrap: pretty;
  }
  .card .proof-content .copy-note {
    color: var(--muted);
  }
  @media (max-width: 700px), (pointer: coarse) {
    .card .proof-content p {
      font-size: 15px;
    }
    .card .proof-content .rule-check,
    .card .proof-content .note,
    .card .proof-pair h3 {
      font-size: 12px;
    }
  }
`;
