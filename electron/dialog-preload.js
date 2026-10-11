'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apiBaseDialog', {
  submit: (value) => ipcRenderer.send('api-base-dialog', { action: 'submit', value }),
  cancel: () => ipcRenderer.send('api-base-dialog', { action: 'cancel' }),
});
