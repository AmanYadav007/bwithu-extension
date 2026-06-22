import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  setAlwaysOnTop: (alwaysOnTop: boolean) => ipcRenderer.send("set-always-on-top", alwaysOnTop),
  getAlwaysOnTop: () => ipcRenderer.invoke("get-always-on-top"),
  onShortcutToggle: (callback: () => void) => {
    ipcRenderer.on("shortcut-toggle", () => callback());
  },
});
