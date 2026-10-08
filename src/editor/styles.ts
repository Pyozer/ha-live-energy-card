import { css } from 'lit';

export const editorStyles = css`
  :host {
    display: block;
  }
  .devices {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .devices-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 500;
    padding: 4px 2px;
  }
  .devices-title ha-icon {
    color: var(--secondary-text-color);
  }
  .count {
    font-size: 12px;
    color: var(--secondary-text-color);
    background: var(--secondary-background-color);
    border-radius: 10px;
    padding: 1px 8px;
  }
  .empty {
    color: var(--secondary-text-color);
    font-size: 14px;
    padding: 4px 2px;
  }
  .device {
    border: 1px solid var(--divider-color);
    border-radius: 12px;
    overflow: hidden;
  }
  .device.expanded {
    border-color: var(--primary-color);
  }
  .device-head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 4px 4px 12px;
  }
  .device-head > ha-icon {
    color: var(--secondary-text-color);
    flex: none;
  }
  .device-title {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    background: none;
    border: none;
    padding: 4px 8px;
    color: var(--primary-text-color);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .device-title span,
  .device-title small {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .device-title small {
    color: var(--secondary-text-color);
    font-size: 12px;
  }
  .device-body {
    padding: 4px 12px 12px;
    border-top: 1px solid var(--divider-color);
  }
  .add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    align-self: flex-start;
    padding: 8px 14px;
    border-radius: 18px;
    border: 1px solid var(--divider-color);
    background: transparent;
    color: var(--primary-color);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .import {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin-bottom: 16px;
  }
  .import-status {
    font-size: 13px;
    color: var(--secondary-text-color);
  }
  .import-status.error {
    color: var(--error-color, #db4437);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .members {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 8px 10px 20px;
    border-top: 1px solid var(--divider-color);
  }
  .issues {
    margin-bottom: 16px;
    padding: 10px 14px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--warning-color, #ff9500) 12%, transparent);
    font-size: 13px;
  }
  .issues-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
  }
  .issues ha-svg-icon,
  .device-head .warning {
    color: var(--warning-color, #ff9500);
    flex: none;
  }
  .issues ul {
    margin: 6px 0 0;
    padding: 0 0 0 32px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .issues li {
    display: flex;
    flex-direction: column;
  }
  .issues .where {
    color: var(--secondary-text-color);
  }
  .issues code {
    font-size: 12px;
    word-break: break-all;
  }
  .add:hover {
    background: color-mix(in srgb, var(--primary-color) 8%, transparent);
  }
`;
