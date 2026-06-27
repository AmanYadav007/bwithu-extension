import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electron", {
    setAlwaysOnTop: (alwaysOnTop) => ipcRenderer.send("set-always-on-top", alwaysOnTop),
    getAlwaysOnTop: () => ipcRenderer.invoke("get-always-on-top"),
    onShortcutToggle: (callback) => {
        ipcRenderer.on("shortcut-toggle", () => callback());
    },
});
