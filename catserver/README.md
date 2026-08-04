# CAT server

## Linux tray requirements

The Linux system-tray icon uses GTK3 and AppIndicator. Install the runtime
packages before running the CAT server:

```sh
sudo apt install libgtk-3-0 libappindicator3-1
```

`libayatana-appindicator3-1` can be used instead where it provides the
AppIndicator compatibility library. Desktop environments must expose a StatusNotifier/AppIndicator host for the icon to appear.

For development builds, install `libgtk-3-dev` and `libappindicator3-dev`.
