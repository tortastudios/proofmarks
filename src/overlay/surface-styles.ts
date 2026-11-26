import { css } from './css';
/** The review surface: the card with its overview, details and settings views, the line tabs, and the phone's sheet. */
export const surfaceStyles = css`
  .d-sr,
  .d-sr-close {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
    /* Pulled back inside its static position, so a hidden label never makes its container scroll. */
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .d-sr-close:focus-visible {
    position: static !important;
    width: auto !important;
    height: 40px !important;
    margin: 0;
    clip-path: none;
    padding: 8px !important;
  }
  .card {
    padding: 14px;
  }
  .card.dock-card {
    padding: 14px;
  }
  .panel[data-slot^='bottom'] .card.dock-card {
    padding-bottom: 14px;
  }
  .card header {
    margin: -4px 0 14px;
    min-height: 40px;
  }
  .card header .d-rule {
    width: auto;
    min-width: 0;
    height: auto;
    min-height: 40px;
    padding: 0 4px;
    margin-left: -4px;
    text-align: left;
    color: var(--mark);
    font:
      500 21px/1.2 ProofmarksHand,
      cursive;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 5px;
    text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
  }
  .card .proof-content {
    gap: 14px;
    padding: 0;
  }
  .card .rule-check {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .proof-pair {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .proof-version p {
    margin: 0 !important;
    font-size: 14px;
    line-height: 1.5;
  }
  .proof-version del {
    color: var(--muted);
    text-decoration-thickness: 1px;
  }
  .proof-version ins {
    text-decoration: none;
  }
  .proof-content .copy-note {
    margin: 14px 0 0;
  }
  .card .actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .card .actions button {
    min-height: 40px;
  }
  .card .proof-status {
    margin: 0;
  }
  .card .proof-status[data-status='dismissed'] {
    color: var(--muted);
  }
  .card .actions [data-action='revert'] {
    flex: none;
  }
  .card .d-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 14px -8px -6px;
  }
  .d-footer button {
    min-width: 40px;
    min-height: 40px;
  }
  .d-footer .proof-position {
    height: 40px;
    width: auto;
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .d-footer [data-step] {
    font-size: 22px;
  }
  .card[data-following='true'] {
    pointer-events: auto;
  }
  .card[data-following='true'] .d-rule {
    pointer-events: none;
  }
  .card[data-following='true'] .actions-shell,
  .card[data-following='true'] .d-footer {
    display: none;
  }
  .card[data-following='true'] header button {
    visibility: visible;
  }
  .card[data-following='true'] .d-sr-close {
    display: none;
  }
  .card .meta-info {
    margin: 0;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  .card .meta-info strong {
    display: flex;
    flex: none;
  }
  .meta-info strong {
    display: inline;
  }
  .meta-info strong span {
    display: none;
  }
  .meta-info svg {
    width: 15px;
    height: 15px;
    margin-right: 6px;
  }
  .meta-info > span {
    display: inline;
    font-size: 11px;
    color: var(--muted);
  }
  .d-deep {
    scroll-margin: 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .d-deep > header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
  }
  .card .d-deep h2 {
    font:
      500 16px/1.4 system-ui,
      sans-serif;
    color: var(--paper);
    white-space: normal;
  }
  .card .d-deep header button {
    min-width: 40px;
    width: 40px;
    height: 40px;
    font-size: 24px;
  }
  .d-deep > button {
    padding-inline: 0;
    text-align: left;
    min-height: 40px;
    font-size: 13px;
  }
  .d-muted,
  .d-settings p {
    font-size: 12px;
    color: var(--muted);
    margin: 0;
  }
  .d-deep > button:not(.d-nav):not(.d-switch-row) {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .d-nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-right: 2px;
    border-top: 1px solid #ffffff14;
    border-radius: 0;
  }
  .d-settings {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .d-settings h3,
  .why-content h4 {
    font:
      500 11px/1.5 system-ui,
      sans-serif;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 6px;
    letter-spacing: 0.04em;
  }
  .d-settings button,
  .d-settings a {
    font-size: 13px;
    min-height: 40px;
  }
  .d-settings a {
    color: var(--paper);
  }
  .d-switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0;
    gap: 12px;
    font-size: 13px;
  }
  .d-switch {
    width: 30px;
    height: 18px;
    border-radius: 12px;
    padding: 3px;
    background: #ffffff24;
    flex: none;
  }
  .d-switch:before {
    content: '';
    display: block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--muted);
    transform: translateX(0);
    transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  [aria-checked='true'] > .d-switch {
    background: var(--paper);
  }
  [aria-checked='true'] > .d-switch:before {
    background: var(--ink);
    transform: translateX(12px);
  }
  .d-segments {
    display: flex;
    padding: 3px;
    margin-top: 12px;
    background: #ffffff0b;
    border-radius: 7px;
  }
  .d-segments button {
    flex: 1;
    padding: 4px;
    color: var(--muted);
  }
  .d-segments [aria-pressed='true'] {
    background: #ffffff14;
    color: var(--paper);
  }
  .why-content p {
    font-size: 13px;
    line-height: 1.55;
    margin: 0 0 16px;
  }
  .why-content .record-meta {
    font-size: 11px;
    color: var(--muted);
    margin-top: 18px;
  }
  .why-content .signal-row {
    margin-top: 12px;
  }
  .panel[data-expanded='true'] > .header {
    visibility: visible;
  }
  .panel[data-expanded='true'] .pill-surface,
  .panel[data-expanded='true'] .pill-mark:before {
    background: transparent;
  }
  .card .d-deep .record-title {
    font:
      500 25px/1.2 ProofmarksHand,
      cursive;
    color: var(--mark);
    margin: 0 0 4px;
    text-transform: none;
    letter-spacing: normal;
  }
  .label {
    background: transparent;
  }
  .d-surface-shadow {
    position: fixed;
    pointer-events: none;
    z-index: 2147481999;
    border-radius: var(--surface-radius);
    box-shadow: var(--surface-shadow);
    opacity: 0;
    transition: opacity 80ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .d-surface-shadow[data-open='true'] {
    opacity: 1;
    transition-delay: 130ms;
    transition-duration: 100ms;
  }

  .header .pill .pill-close {
    display: none;
  }
  .header .pill .pill-count {
    padding: 0 14px 0 2px;
    min-width: 0;
  }
  .header .pill .pill-mark {
    min-width: 44px;
  }
  .panel .header .pill-content {
    gap: 0;
  }
  .mobile-sheet {
    max-height: 78dvh;
    padding: 0 14px max(8px, env(safe-area-inset-bottom));
  }
  .mobile-sheet .sheet-card {
    padding: 14px 0;
  }
  .sheet-handle {
    height: 44px;
    min-height: 44px;
    width: 100%;
    font-size: 0;
    position: sticky;
    top: 0;
    background: var(--ink);
    z-index: 2;
  }
  .sheet-handle:before {
    content: '';
    display: block;
    width: 40px;
    height: 4px;
    background: #ffffff33;
    border-radius: 2px;
    margin: auto;
  }
  .mobile-sheet .sheet-card .actions-shell {
    position: static;
  }
  .mobile-sheet .d-deep header button {
    display: block;
  }
  .mobile-sheet .card .d-sr-close {
    display: block;
  }
  .mobile-sheet .actions button {
    flex: 1;
  }
  @media (max-width: 700px), (pointer: coarse) {
    .d-footer button,
    .d-deep button,
    .d-settings button,
    .card .actions button,
    .card header .d-rule {
      min-height: 44px;
    }
    .card .d-footer button {
      min-width: 44px;
    }
    .card .d-deep header button {
      min-width: 44px;
    }
    .d-deep {
      gap: 14px;
    }
  }
  /* The outer surface clips once; fixed rows never share the body scrollport. */
  .panel {
    max-height: var(--panel-max-height, calc(100dvh - 100px));
    overflow: visible;
    border-radius: var(--surface-radius);
    background: transparent;
    box-shadow: none;
  }
  .dock-surface {
    clip-path: none;
    border-radius: 0;
  }
  .panel[data-expanded='false']:not([data-animating]) .dock-surface {
    display: none;
  }
  .card.dock-card,
  .card[data-fixed='true'],
  .mobile-sheet .sheet-card {
    display: flex;
    flex-direction: column;
    max-height: var(--panel-max-height, calc(78dvh - 44px));
    overflow: hidden;
    padding: 14px 14px 0;
    border-radius: 0;
    min-height: 0;
  }
  .card > header,
  .card .d-deep > header {
    flex: none;
    display: flex;
    align-items: center;
    margin: -14px -14px 10px;
    padding: 0;
    min-height: 44px;
    gap: 0;
  }
  .card header .d-rule {
    flex: 1;
    min-width: 0;
    padding: 0 14px;
    margin: 0;
    font-size: 21px;
  }
  .card header .d-rule:focus-visible {
    outline-offset: 2px;
  }
  .card .surface-logo,
  .card .d-deep .surface-logo {
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
    min-height: 44px;
    min-width: 44px;
    padding: 11px;
    position: static;
    order: initial;
  }
  .surface-logo svg {
    display: block;
    width: 22px;
    height: 22px;
  }
  .card .d-deep h2 {
    flex: 1;
    margin: 0;
  }
  .card .d-deep {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .card .d-view-body {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 14px;
  }
  .card .proof-content {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .card .actions-shell {
    flex: none;
  }
  .card .d-footer {
    order: 3;
    flex: none;
    min-height: 46px;
    height: 46px;
    margin: 14px -14px 0;
    gap: 0;
  }
  .card .d-footer button {
    height: 44px;
    min-height: 44px;
  }
  .card .d-footer .proof-position {
    flex: 1;
  }
  .card[data-view]:not([data-view='proof']) .d-footer [data-step] {
    display: none;
  }
  .d-view-body > button,
  .d-view-body > [data-rewrite-all] > button {
    padding-inline: 0;
    text-align: left;
    min-height: 40px;
    font-size: 13px;
  }
  .d-view-body > [data-rewrite-all] {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .d-view-body > [data-rewrite-all]:empty {
    display: none;
  }
  .d-view-body > [data-rewrite-all] > p {
    margin: 0;
  }
  .d-view-body > [data-rewrite-all] > button.primary {
    background: var(--paper);
    color: var(--ink);
    padding-inline: 16px;
    text-decoration: none;
  }
  .d-view-body > button:not(.d-nav):not(.d-switch-row),
  .d-view-body > [data-rewrite-all] > button,
  .d-settings section > button:not(.d-switch-row):not(.d-rule-open) {
    padding-inline: 0;
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .mobile-sheet {
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 0 14px max(8px, env(safe-area-inset-bottom));
    border-radius: var(--surface-radius) var(--surface-radius) 0 0;
  }
  .sheet-handle {
    position: static;
    flex: none;
  }
  .mobile-sheet .sheet-card {
    max-height: calc(78dvh - 52px);
    padding: 14px 0 0;
  }
  .mobile-sheet .card > header,
  .mobile-sheet .card .d-deep > header {
    margin: -14px 0 10px;
    padding: 0;
  }
  .mobile-sheet .card header .sheet-logo {
    position: static;
    display: block;
  }
  .mobile-sheet .d-deep header button {
    min-width: 44px;
  }
  .card .completion-undo {
    min-height: 40px;
  }
  .mobile-sheet .completion-undo {
    min-height: 44px;
  }
  /* Content-sized feedback; the original control hit boxes and layout stay intact. */
  .card .d-view-body {
    margin-inline: -12px;
    padding-inline: 12px;
  }
  .mobile-sheet .sheet-card {
    overflow: visible;
  }
  /* Hover fills come and go with the pointer, at once; only a press eases. */
  .card button:not(.d-rule):not(.primary) {
    position: relative;
    isolation: isolate;
    background: transparent;
    transition: scale 0.16s ease-out;
  }
  .card button:not(.d-rule):not(.primary)::before {
    content: '';
    position: absolute;
    z-index: -1;
    pointer-events: none;
    left: 50%;
    top: 50%;
    width: min(calc(100% - 8px), var(--control-ink-width, 32px));
    height: 32px;
    transform: translate(-50%, -50%);
    border-radius: 999px;
  }
  .card button:not(.d-rule):not(.primary):focus-visible {
    outline: 0;
  }
  .card button:not(.d-rule):not(.primary):focus-visible::before {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }
  /* A text link's fill frames its text, 12px either side (--control-ink-width is the text plus 24px). */
  .card .d-view-body > button:not(.primary):not(.d-rule)::before,
  .card .d-view-body > [data-rewrite-all] > button:not(.primary)::before,
  .card .d-settings section > button:not(.primary):not(.d-rule)::before {
    width: var(--control-ink-width, 32px);
    left: -12px;
    transform: translateY(-50%);
  }
  /* A row's fill is the whole row, since the whole row is the control: switches, rule rows, Settings and agents. */
  .card .d-deep button.d-switch-row:not(.primary):not(.d-rule)::before,
  .card .d-deep button.d-nav:not(.primary):not(.d-rule)::before,
  .card .d-deep button.d-rule-open:not(.primary):not(.d-rule)::before {
    left: -8px;
    width: calc(100% + 16px);
    height: calc(100% - 8px);
    transform: translateY(-50%);
  }
  .card button:not(.d-sr-close) {
    position: relative;
  }
  .card button:not(.d-sr-close)::after {
    content: '';
    position: absolute;
    pointer-events: auto;
    left: 50%;
    top: 50%;
    width: max(100%, 44px);
    height: max(100%, 44px);
    transform: translate(-50%, -50%);
  }
  .card[data-following='true'] button::after {
    pointer-events: none;
  }
  .card button:active {
    transform: none;
    scale: 0.97;
  }
  .card .d-rule:active {
    scale: 1;
  }
  .card .d-rule:focus-visible {
    outline: 0;
    text-decoration-thickness: 2px;
    text-decoration-color: currentColor;
  }
  .card[data-fixed='true'] {
    max-height: calc(100dvh - 24px);
  }
  .card:not(.dock-card):not(.sheet-card) {
    border-radius: var(--surface-radius);
    box-shadow: var(--surface-shadow);
  }
  .card .d-segments [aria-pressed='true'] {
    background: #ffffff14;
  }
  .card button:not(.primary):not(.d-rule):active::before {
    background: oklch(0.31 0.01 70);
  }
  @media (hover: hover) and (pointer: fine) {
    .card button:not(.primary):hover {
      background: transparent;
    }
    .card button:not(.primary):not(.d-rule):hover::before,
    .card .d-segments [aria-pressed='true'] {
      background: #ffffff14;
    }
    .card button:not(.primary):not(.d-rule):active::before {
      background: oklch(0.31 0.01 70);
    }
    .card .d-rule:hover {
      background: transparent;
      text-decoration-thickness: 2px;
      text-decoration-color: currentColor;
    }
    .card .primary:hover {
      background: #e7e1d5;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .card button,
    .card button::before {
      transition: none !important;
    }
    .card button:active {
      scale: 1;
    }
    .d-surface-shadow,
    .d-switch:before {
      transition: none !important;
    }
  }
  /* A decision is one line in the same row: the written status, then Undo as a button, in Accept's shape (a
     6px-cornered rectangle the row's height) with a soft fill that brightens on hover. */
  .card .actions[data-decided='true'] {
    height: 40px;
    min-height: 40px;
    gap: 10px;
  }
  .card .actions[data-decided='true'] .proof-status {
    flex: none;
    margin: 0;
    font-size: 13px;
  }
  .card .actions[data-decided='true'] [data-action='revert'] {
    flex: none;
    min-width: 44px;
    height: 40px;
    font-size: 13px;
    padding-inline: 16px;
  }
  .card .actions[data-decided='true'] [data-action='revert']::before {
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    transform: none;
    border-radius: 6px;
    background: #ffffff14;
  }
  @media (hover: hover) and (pointer: fine) {
    .card .actions[data-decided='true'] [data-action='revert']:hover::before {
      background: #ffffff24;
    }
  }
  @media (max-width: 700px), (pointer: coarse) {
    .card .actions[data-decided='true'],
    .card .actions[data-decided='true'] [data-action='revert'] {
      height: 44px;
      min-height: 44px;
    }
  }
  /* Back owns a full cell; its focus ink cannot overlap the title. */
  .card[data-view='settings'] .d-deep > header {
    gap: 8px;
  }
  .card[data-view='settings'] .d-deep > header > button:not(.surface-logo) {
    flex: 0 0 44px;
    min-width: 44px;
    width: 44px;
  }
  .card .d-deep > header h2 {
    min-width: 0;
  }
  .card .actions .ask-rewrite {
    flex: none;
    white-space: nowrap;
    text-align: left;
    font-size: 13px;
    padding: 6px 16px;
  }
  .card .rewrite-warning,
  .card .rewrite-prompt {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
  }
  /* Preserve the mobile row's existing two-line footprint and its Dismiss cell. */
  @media (max-width: 700px), (pointer: coarse) {
    .mobile-sheet .actions:has(> .ask-rewrite:not([hidden])) {
      min-height: 60.8px;
    }
    .mobile-sheet .card .actions .ask-rewrite {
      flex: none;
      max-width: none;
      white-space: nowrap;
      line-height: 16px;
    }
  }
  /* Phones draw no margin notes; with the sheet open, only its proof stays marked. */
  .marks [data-finding-group] {
    transition: opacity 0.15s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .marks [data-quiet='true'] {
    opacity: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .marks [data-finding-group] {
      transition: none;
    }
  }
  /* Proofs sharing a line label: hovering the label unfolds its line's proofs and fades the rest of the page's marks. */
  .marks [data-dim='true'] {
    opacity: 0.15;
  }
  .line-menu {
    position: absolute;
    z-index: 3;
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 2px 12px 6px 7px;
    margin: -2px 0 0 -7px;
    background: #fffdf8;
    border-radius: 8px;
    box-shadow:
      0 1px 2px #0000000f,
      0 8px 24px #0000001f;
    animation: line-menu-in 0.12s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .line-menu .line-name {
    border: 0;
    background: none;
    padding: 3px 0;
    font:
      500 23px/1.1 ProofmarksHand,
      cursive;
    color: var(--mark);
    text-align: left;
    cursor: pointer;
    text-underline-offset: 4px;
  }
  .line-menu .line-name:hover,
  .line-menu .line-name:focus-visible {
    text-decoration: underline;
  }
  @keyframes line-menu-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .line-menu {
      animation: none;
    }
  }
  /* The list-to-card morph surface: scaled and faded by the compositor; the card shows no fill of its own until it lands. */
  .morph-surface {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 2147482000;
    transform-origin: 0 0;
    will-change: transform;
    pointer-events: none;
    background: var(--ink);
    border-radius: var(--surface-radius);
    box-shadow: var(--surface-shadow);
  }
  .morph-cream {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: #fffdf8;
    will-change: opacity;
  }
  .card[data-morphing] {
    background: transparent !important;
    border-color: transparent !important;
    box-shadow: none !important;
  }
  /* While the card's height animates (between proofs, views or versions), nothing inside it shows a scrollbar; scroll position is kept. */
  [data-reshaping],
  [data-reshaping] .proof-content,
  [data-reshaping] .d-view-body {
    overflow: hidden !important;
  }
  .line-tabs[data-tucking] .line-tab {
    opacity: 0;
  }
  .tab-ghosts {
    position: fixed;
    inset: 0;
    z-index: 2147482001;
    pointer-events: none;
  }
  .tab-ghost {
    position: fixed;
  }
  .ghost-mover {
    position: absolute;
    inset: 0;
    will-change: transform;
  }
  /* One shadow for cap and body together, matching the tab's own. */
  .ghost-shape {
    position: absolute;
    inset: 0;
    filter: drop-shadow(-2px 2px 4px #0000001a);
  }
  .ghost-cap,
  .ghost-body {
    position: absolute;
    top: 0;
    bottom: 0;
    background: #fffdf8;
    border: 1px solid #0000001a;
    will-change: transform;
  }
  .ghost-cap {
    left: 0;
    border-right: 0;
    border-radius: 9px 0 0 9px;
  }
  .ghost-body {
    right: 0;
    border-left: 0;
    transform-origin: 100% 50%;
  }
  .tab-ghost[data-selected] :is(.ghost-cap, .ghost-body) {
    background: var(--ink);
    border-color: oklch(0.3 0.01 70);
  }
  .ghost-clip {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .ghost-name {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    white-space: nowrap;
    font:
      500 19px/1 ProofmarksHand,
      cursive;
    color: var(--mark);
    will-change: transform;
  }
  .ghost-rest {
    will-change: opacity;
  }
  .tab-ghost[data-selected] .ghost-name {
    color: var(--ink-mark);
  }
  /* Each tab is a full-height row (its share of the gap included), so moving between tabs never leaves the strip. */
  .line-tabs {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 2147481999;
    width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    pointer-events: none;
  }
  .line-tab {
    pointer-events: auto;
    display: flex;
    justify-content: flex-end;
    min-width: 0;
    min-height: 0;
    padding: 2px 0;
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--mark);
    cursor: pointer;
    font:
      500 19px/1 ProofmarksHand,
      cursive;
  }
  .tab-chip {
    display: flex;
    align-items: center;
    height: 30px;
    width: 30px;
    padding-left: var(--lead, 10px);
    border: 1px solid #0000001a;
    border-right: 0;
    border-radius: 9px 0 0 9px;
    background: #fffdf8;
    box-shadow: -2px 2px 8px #0000001a;
    overflow: hidden;
    white-space: nowrap;
    /* Keep letter and chip changes in the same frame so the letter stays readable. */
    transition: width 0.18s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .tab-first,
  .tab-rest {
    flex: none;
  }
  .tab-rest {
    opacity: 0;
    transition: opacity 0.1s;
  }
  .line-tab[aria-selected='true'] {
    color: var(--ink-mark);
  }
  .line-tab[aria-selected='true'] .tab-chip {
    background: var(--ink);
    border-color: oklch(0.3 0.01 70);
  }
  /* Only the tab under the pointer unfolds; its neighbours stay put. */
  .line-tab:hover .tab-chip,
  .line-tab:focus-visible .tab-chip {
    width: var(--full, 110px);
  }
  .line-tab:hover .tab-rest,
  .line-tab:focus-visible .tab-rest {
    opacity: 1;
    transition-delay: 0.03s;
  }
  .line-tab:focus-visible {
    outline: none;
  }
  .line-tab:focus-visible .tab-chip {
    outline: 2px solid var(--mark);
    outline-offset: -3px;
  }
  @media (prefers-reduced-motion: reduce) {
    .tab-chip,
    .tab-rest {
      transition: none;
    }
  }

  .d-agent-row {
    text-align: left;
    min-height: 44px;
    padding: 6px 0;
  }
  .d-agent-copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .d-agent-delivery {
    font-size: 12px;
    color: var(--muted);
  }
  .d-settings button.d-rule-open {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
    text-align: left;
  }
  .d-rule-page p {
    font-size: 13px;
    line-height: 1.55;
    color: var(--paper);
  }
  /* The rule page's calls on this site, with Reset when its line has moved. */
  .d-learned {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  /* Reset's fill is centered on the word, at the word's width. */
  .card .d-learned button.d-learned-reset:not(.primary)::before {
    width: var(--control-ink-width, 32px);
  }
  .d-settings button.d-learned-reset {
    flex: none;
    font-size: 12px;
    color: var(--muted);
    text-decoration: underline;
    text-underline-offset: 4px;
    padding: 0;
    min-height: 32px;
  }
  .card .rewrite-target {
    align-self: flex-start;
    font-size: 12px;
    color: var(--muted);
    text-decoration: underline;
    text-underline-offset: 4px;
    padding: 0;
    min-height: 32px;
  }

  @media (max-width: 700px), (pointer: coarse) {
    .d-settings button.d-learned-reset {
      min-height: 44px;
    }
    .card .rewrite-target {
      min-height: 44px;
    }
  }
  /* Rewrite versions sit in the header beside the rule: ‹ 2/3 › and a refresh icon for Try another. A hover preview stays read-only. */
  .version-tools {
    display: flex;
    align-items: center;
    margin-left: auto;
    flex: none;
  }
  .card header .version-tools:not([hidden]) ~ .surface-logo {
    margin-left: 6px !important;
  }
  .card[data-following='true'] .version-tools {
    display: none;
  }
  .version-nav {
    display: flex;
    align-items: center;
    flex: none;
  } /* Every item in the row is centred on one line: icons by their box, the count by its digits (trimmed to cap height). */
  .card .version-tools button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    min-width: 32px;
    padding: 0;
    font-size: 18px;
    line-height: 1;
  }
  .version-label {
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    padding: 0 2px;
    white-space: nowrap;
    text-box: trim-both cap alphabetic;
  }
  .card .version-tools .try-another {
    color: var(--muted);
  }
  .card .version-tools .try-another:not(:disabled):hover {
    color: var(--paper);
  }
  .version-tools svg {
    display: block;
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .queue-line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 10px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted);
  }
  .card .queue-line button {
    font-size: 12px;
    min-height: 32px;
    padding-inline: 8px;
    margin-left: auto;
  }
  @media (max-width: 700px), (pointer: coarse) {
    .card .queue-line button {
      min-height: 44px;
      height: 44px;
    }
    .card .version-tools button {
      width: 44px;
      min-width: 44px;
    }
  }
`;
